import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { driverIdOf, driverNotInstalledCode } from "@/app/drivers/_lib/drivers.model";
import type { Engine } from "@/components/ui/engine-tag";
import type { useToast } from "@/components/ui/toast";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { allowRefusal, ApiRequestError, type ApiError, type ApiResult } from "@/lib/api/prism-api";

import { createAutoRefresh, type AutoRefreshControl } from "./auto-refresh";
import { closeDatabaseSession, openDatabaseSession } from "./database-sessions.service";
import { queryOutcomeCopy } from "./query-outcome.copy";
import { createScriptRun, finishRun, keptResultIds, platformScriptShortcut, scriptEndToast, scriptResultCap, startEntry, withEntry, withSavedResult, type ScriptChoice, type ScriptError, type ScriptRun } from "./script-run";
import { scriptRunCopy } from "./script-run.copy";
import { scriptsCopy } from "./scripts.copy";
import { gridFilterCopy } from "./grid-filter.copy";
import { sqlErrorDetails, type FilterApplied, type QueryColumn, type QueryPage, type QueryResult, type QueryRow } from "./query.schema";
import { cancelQuery, countQueryTotal, executeQuery, fetchNextPage } from "./query.service";
import { statementCount, utf16IndexOf } from "./sql-statements";
import { workbenchCopy } from "./workbench.copy";

const copy = workbenchCopy.toasts;
const resultCopy = workbenchCopy.result;
const outcomeCopy = queryOutcomeCopy.toasts;

/**
 * RN-SQL-010 (Ruling 135): o desfecho que a API diz, na extensão `outcome` do `SQL_EXECUTION_FAILED`, do comando que terminou depois de um pedido de
 * cancelamento. `canceled`: ele não terminou e nada dele ficou. `unknown`: a API não sabe se ele foi concluído. `partial`: o que ele gravou até o
 * cancelamento ficou. A tela decide por ela, e nunca pelo SQLSTATE nem pelo texto da mensagem.
 */
type CancelOutcome = "canceled" | "unknown" | "partial";

/** Um valor que a tela não conhece vira nulo: o erro aparece como erro do banco, e nunca como "Comando cancelado.". */
const cancelOutcomeSchema = z.object({ outcome: z.enum(["canceled", "unknown", "partial"]).nullish().catch(null) });

/** RN-SESSAO-005: `executed: true` no `TRANSACTION_CONTROL_NOT_SUPPORTED` diz que o comando rodou e a API desfez a transação que ele deixou aberta. */
const executedSchema = z.object({ executed: z.boolean().nullish().catch(null) });

/** O desfecho do cancelamento, ou `null` quando o erro não diz nenhum: sem a extensão, é um erro comum do banco (RN-SQL-009). */
function cancelOutcomeOf(error: ApiError): CancelOutcome | null {
  if (error.code !== "SQL_EXECUTION_FAILED") return null;
  return cancelOutcomeSchema.parse(error.extensions).outcome ?? null;
}

/** O comando recusado com `TRANSACTION_CONTROL_NOT_SUPPORTED` rodou (e o cursor anterior fechou), ou foi recusado antes de executar. */
function wasExecuted(error: ApiError): boolean {
  return error.code === "TRANSACTION_CONTROL_NOT_SUPPORTED" && executedSchema.parse(error.extensions).executed === true;
}

/** As recusas que a aba trata no lugar, pelo código. */
const codes =
  (...handled: string[]) =>
  (error: ApiError) =>
    handled.includes(error.code);

/**
 * O que o editor manda executar: o texto, como está (RN-SQL-003); onde ele começa no editor, para
 * marcar a posição do erro (RN-SQL-009); e o banco da aba, que diz como separar os comandos
 * (RN-SQL-002). Sem o banco, vale o PostgreSQL.
 */
export type RunTarget = {
  sql: string;
  offset: number;
  engine?: Engine;
  /**
   * RN-GRADE-011: o texto do campo de filtro do resultado (a condição, a ordem ou as duas), que a API junta ao comando. O texto do editor não muda, e
   * "Executar de novo" repete o comando COM o filtro, porque ele viaja aqui. Sem filtro, o campo não existe.
   */
  filter?: string;
};

/** RN-GRADE-011: a API recusou o filtro do resultado (422 `FILTER_INVALID`), sem executar nada; a frase vai ao campo, como veio. */
export type FilterRefusal = { code: "FILTER_INVALID"; message: string };

export type RowsState = {
  status: "rows";
  /**
   * Muda a cada execução, e não a cada página: é a chave da grade. A execução automática (RN-GRADE-014) que traz as mesmas colunas fica com a de antes: a
   * grade não é refeita, e a rolagem fica onde estava.
   */
  id: number;
  /**
   * O comando que deu este resultado. É ele que "executar de novo" repete: o comando viaja com as
   * linhas, e uma tentativa recusada depois (que deixa estas linhas na tela) não toma o lugar dele.
   */
  target: RunTarget;
  columns: QueryColumn[];
  /** As páginas lidas, uma depois da outra. "Carregar mais" acrescenta; as linhas que já estavam são os mesmos objetos. */
  rows: QueryRow[];
  /** As células que chegaram cortadas (RN-SQL-011): por linha do resultado, as colunas. */
  truncated: ReadonlyMap<number, ReadonlySet<number>>;
  hasMore: boolean;
  /**
   * Preenchido quando o comando gravou e devolveu linhas (RN-SQL-013): ele foi até o fim, esse é o
   * total que devolveu, e não há cursor para "carregar mais" nem o que "contar".
   */
  totalRows: number | null;
  /** O tempo do comando: o da primeira página. */
  elapsedMs: number;
  pages: number;
  loadingMore: boolean;
  cancelling: boolean;
  /** "Carregar mais" encontrou o cursor fechado (RN-SQL-007): a área de resultado oferece executar de novo. */
  cursorClosed: boolean;
  /** Só existe depois de "Contar total" (RN-SQL-006). Enquanto conta de novo, fica o de antes, até chegar o novo. */
  total: number | null;
  counting: boolean;
  /** RN-EDIT-002: o resultado da API a que estas linhas pertencem; é por ele que a edição dos Registros pergunta e grava. */
  resultId?: string | null;
  /**
   * RN-SQL-024: a sessão da API em que o resultado foi lido, e em que a edição dele pergunta e grava. A sessão que o F5 ou o filtro reabriram depois (a de
   * antes tinha caído) não conhece os resultados da anterior: a aba guardada do script responde, ao editar, que a sessão com o banco não existe mais, como
   * a sessão que caiu, e não que outro comando rodou depois dela. Sem ela (os testes), vale a sessão da aba.
   */
  sessionId?: string | null;
  /** RN-EDIT-002: o motivo de o resultado inteiro ser só leitura, quando a página já o trouxe. */
  readOnly?: string | null;
  /** RN-EDIT-009: as colunas de cada linha nova salva na aba de consulta que o banco preencheu, e cujo valor a tela não sabe. */
  generated?: ReadonlyMap<number, ReadonlySet<number>>;
  /** RN-SQL-017: depois de um Salvar da aba de consulta, a linha do resultado na API de cada linha da grade (`SavedResult.sourceRows`). */
  sourceRows?: readonly (number | null)[];
  /** RN-GRADE-011: como o filtro do resultado entrou no comando (`merged` ou `wrapped`); nulo sem filtro. */
  filterApplied?: FilterApplied | null;
};

export type AffectedState = { status: "affected"; rowsAffected: number; elapsedMs: number };

/**
 * O comando foi cancelado e nada dele ficou (RN-SQL-010): não é erro, e a área de resultado só diz que foi
 * cancelado. Quem diz é a API, com `outcome: "canceled"` (Ruling 135), e não o SQLSTATE nem o texto, que
 * mudam de banco para banco.
 */
export type CancelledState = { status: "cancelled" };

/**
 * `database`: o banco executou o comando e respondeu com erro; a mensagem dele, como veio, com o
 * SQLSTATE e a posição quando há. `connection`: a mensagem do banco para a conexão que não abriu.
 * `api`: a frase da API (`title` e `detail`) para o comando que ela não aceita (RN-SQL-003).
 * `driver`: o driver do banco da conexão não está instalado (RN-DRIVER-006); a frase é da API e a área de resultado
 * oferece "Instalar driver". Como `connection`, não é resultado de comando.
 * `errorAt` é a posição do erro no texto do editor, enquanto ele não for editado.
 */
export type ErrorState = {
  status: "error";
  source: "database" | "connection" | "api" | "driver";
  title: string;
  message: string | null;
  sqlState: string | null;
  errorAt: number | null;
  /** Só em `driver`: o driver que falta, quando a API o diz (seção 16); a tela de Drivers aponta a linha dele. */
  driverID?: string;
  /**
   * Só em `api`: o comando rodou e a API desfez a transação que ele deixou aberta (`executed`, RN-SESSAO-005). Ao contrário da recusa antes de
   * executar, é resultado de um comando aceito: ele tomou o lugar do resultado anterior, cujo cursor fechou.
   */
  executed?: true;
};

/**
 * O resultado de um comando que a API aceitou: as linhas, as linhas afetadas, ou o erro com que o
 * banco respondeu. É o que fica na tela até a API aceitar outro comando.
 */
export type ResultState = RowsState | AffectedState | CancelledState | ErrorState;

export type RunnerState =
  | { status: "idle" }
  /**
   * `previous` é o resultado que estava na tela quando o comando começou: ele continua lá até a API
   * aceitar o comando novo, e volta a ser o estado se ela não aceitar. `auto`: é a execução da atualização automática (RN-GRADE-014), que a área de
   * resultado não esmaece e que não ocupa a aba para a pessoa nem para o bloqueio por inatividade (`isPersonBusy`).
   */
  | { status: "running"; cancelling: boolean; previous: ResultState | null; auto?: true }
  | RowsState
  | AffectedState
  | CancelledState
  /** O comando não foi enviado, e a área de resultado diz por quê (RN-SQL-001: mais de um comando na seleção). */
  | { status: "notice"; message: string }
  | ErrorState;

/**
 * O estado, se ele é o resultado de um comando que a API aceitou (o cancelado também: ele rodou; e o controle de
 * transação que rodou e foi desfeito, `executed`). A frase de "N comandos", a da API para o controle de transação
 * recusado antes de executar e a mensagem da conexão que não abriu dizem por que um comando não rodou: não são
 * resultado, e a recusa seguinte ocupa o lugar delas.
 */
function resultOf(state: RunnerState): ResultState | null {
  if (state.status === "rows" || state.status === "affected" || state.status === "cancelled") return state;
  return state.status === "error" && (state.source === "database" || state.executed === true) ? state : null;
}

/**
 * Há comando em andamento na aba: executar, "carregar mais" ou "contar total" (RN-SESSAO-002). A contagem roda em conexão
 * separada, mas é "Cancelar" que a interrompe (RN-SQL-010): enquanto ela roda a aba também está ocupada. É também o que o
 * bloqueio por inatividade (RN-SEG-001) chama de comando em andamento.
 */
export function isBusyState(state: RunnerState): boolean {
  return state.status === "running" || (state.status === "rows" && (state.loadingMore || state.counting));
}

/** A execução da atualização automática (RN-GRADE-014) está em andamento. */
export function isAutoRun(state: RunnerState): boolean {
  return state.status === "running" && state.auto === true;
}

/**
 * Há um comando DA PESSOA em andamento: o que ela pediu (executar, "carregar mais", contar). É o "ocupado" da tela (os botões que viram "Cancelar", o
 * que se desabilita, as teclas que não fazem nada) e do bloqueio por inatividade (RN-SEG-001). A execução da atualização automática (RN-GRADE-014) não
 * conta: a tela não pode mudar a cada 5 s, o que a pessoa pede enquanto ela roda é atendido (o comando da pessoa toma o lugar dela; "carregar mais" e
 * contar esperam por ela), e uma consulta repetida a cada 5 s recomeçaria a contagem do bloqueio a cada execução, e o Prism nunca bloquearia.
 */
export function isPersonBusy(state: RunnerState): boolean {
  return isBusyState(state) && !isAutoRun(state);
}

/** O resultado de antes da execução automática que a pessoa interrompeu: o banco executou o comando novo, e o cursor dele fechou (RN-SQL-007). */
function withCursorClosed(result: ResultState | null): ResultState | null {
  return result?.status === "rows" && result.hasMore && !result.cursorClosed ? { ...result, cursorClosed: true } : result;
}

/** As mesmas colunas, na mesma ordem, com o mesmo tipo: a grade de antes serve às linhas novas. */
function sameColumns(a: readonly QueryColumn[], b: readonly QueryColumn[]): boolean {
  return a.length === b.length && a.every((column, index) => column.name === b[index].name && column.type === b[index].type && column.kind === b[index].kind);
}

/**
 * RN-SQL-021: as recusas da API que são do comando, e não da sessão nem da API: o script pergunta o que fazer, como no erro do banco. As outras (a sessão
 * ocupada, a conexão que não abre, a API fora do ar) param o script sem perguntar. Na conexão somente leitura, o comando que não é leitura também
 * (`CONNECTION_READ_ONLY`, RN-PROT-002).
 */
const scriptCommandRefusals = ["TRANSACTION_CONTROL_NOT_SUPPORTED", "COMMAND_NOT_ALLOWED_IN_TRANSACTION", "MULTIPLE_STATEMENTS_NOT_SUPPORTED", "CONNECTION_READ_ONLY"] as const;

/** O erro de um comando do script como as Estatísticas e a pergunta o mostram (RN-SQL-009 e 021): o do banco, como veio, ou a frase da API. */
function scriptErrorOf(error: ApiError): ScriptError {
  if (error.code !== "SQL_EXECUTION_FAILED") return { title: error.title, message: error.detail, sqlState: null };
  const outcome = cancelOutcomeOf(error);
  return { title: outcome === null || outcome === "canceled" ? resultCopy.errorTitle : outcomeCopy[outcome], message: error.detail ?? error.title, sqlState: sqlErrorDetails(error.extensions).sqlState };
}

export type QueryRunner = {
  subscribe: (listener: () => void) => () => void;
  getState: () => RunnerState;
  /**
   * Devolve a recusa do filtro do resultado (`FILTER_INVALID`), quando é ela; o resto vai à área de resultado e aos avisos, como sempre. O comando aceito
   * troca os resultados de um script (RN-SQL-020), menos com `keepScript`: o filtro do resultado do último comando do script muda só ele.
   */
  run: (target: RunTarget, options?: { keepScript?: boolean }) => Promise<FilterRefusal | void>;
  /**
   * RN-SQL-019: executa os comandos, um por vez, na ordem, na sessão da aba. O estado do script (as abas, as Estatísticas, a pergunta de erro) está em
   * `script`; o do executor fica "executando" enquanto ele roda, e no fim é o do último comando executado.
   */
  runScript: (commands: readonly RunTarget[]) => Promise<void>;
  /**
   * RN-SQL-020: "Executar este comando", de uma aba guardada do script: executa só ele, como o Ctrl+Enter nele, e troca os resultados do script pelo dele. O
   * lugar no texto é o de quando o script rodou: o texto editado depois disso não ganha a marca do erro.
   */
  runCommand: (target: RunTarget) => Promise<void>;
  /** RN-SQL-019 a 022: o script da aba (nulo sem script), e a resposta da pergunta de erro. */
  script: { subscribe: (listener: () => void) => () => void; getState: () => ScriptRun | null; decide: (choice: ScriptChoice) => void };
  /** Executa de novo o comando das linhas que estão na tela, e nunca outro: é o que o aviso de cursor fechado oferece. */
  rerun: () => Promise<void>;
  cancel: () => Promise<void>;
  /**
   * RN-GRADE-014: resolve quando não há execução automática em andamento, nem a que a pessoa interrompeu e ainda ocupa a sessão. "Exportar CSV" espera por
   * ela (as linhas e os valores completos são os do resultado novo), e levar a aba para outra janela também (`handOffTab`: a outra janela recebe a sessão
   * livre, com o resultado e o cursor que a tela mostra).
   */
  autoRunSettled: () => Promise<void>;
  loadMore: () => Promise<void>;
  countTotal: () => Promise<void>;
  /**
   * O texto do editor mudou: a posição do erro era a do texto enviado. Desfaz a marca que estiver
   * na tela, e o erro do comando que ainda roda chega sem posição.
   */
  textEdited: () => void;
  /** A sessão da aba na API, ou nula antes da primeira execução e depois de solta: a edição das células grava nela (seção 22). */
  sessionOf: () => string | null;
  /**
   * RN-EDIT-009: um Salvar da edição gravou tudo no resultado `resultId`, e a grade fica com o que foi salvo, sem executar de novo (a aba de
   * consulta). Salvar é um comando na sessão: o cursor que estava aberto fechou, e "carregar mais" dá lugar a "executar de novo". Com outro
   * resultado na tela, ou um comando em andamento, nada muda. RN-SQL-023: o resultado pode ser o de uma aba guardada do script, que fica com o que foi
   * salvo; o cursor que fecha é o do resultado do último comando, e a aba dele passa ao "executar de novo".
   */
  keepSaved: (resultId: string, saved: { rows: QueryRow[]; truncated: ReadonlyMap<number, ReadonlySet<number>>; generated: ReadonlyMap<number, ReadonlySet<number>>; sourceRows?: readonly (number | null)[] }) => void;
  /**
   * Solta a aba da sessão dela (fechar a aba, desconectar, conexão excluída) e devolve o que há
   * para encerrar na API. O que estava a caminho chega e não muda mais nada.
   */
  release: () => { sessionId: string | null; busy: boolean };
  /**
   * A atualização automática da aba (RN-GRADE-014): ligar com um intervalo, trocá-lo, desligar (o que abandona a execução dela em andamento), e as pausas que
   * a vista pede. Soltar e aposentar o executor a desligam; um comando da pessoa que não é o mesmo também, e a sessão que cai e fica caída.
   */
  autoRefresh: AutoRefreshControl;
  /**
   * Tira o executor de cena de vez (a aba fechou, o cofre bloqueou, o provedor saiu): como `release()`, e além disso ele volta ao
   * começo, sem resultado, e **recusa** `run`, `loadMore` e `countTotal` (não executa nada, não abre sessão, não avisa). Um painel que
   * ainda o segure por um instante, antes de redesenhar com o executor novo, não consegue rodar um comando órfão: que a tela não
   * mostra, que Cancelar não alcança e que o bloqueio por inatividade não vê. Não serve ao "Desconectar", que solta a sessão mas
   * continua usando o executor: ali é `release()`.
   */
  retire: () => { sessionId: string | null; busy: boolean };
};

type QueryRunnerOptions = {
  /** Nulo na aba de um script cuja conexão não existe mais (RN-SCRIPT-003): ela não executa nada até a pessoa escolher uma, e quem escolhe troca o executor. */
  connectionId: string | null;
  /** RN-ARVORE-006: outro banco do servidor da conexão, de onde a aba foi aberta; sem ele, o banco da conexão. */
  database?: string;
  queryClient: QueryClient;
  toast: ReturnType<typeof useToast>;
  /** A sessão da aba mudou: aberta na primeira execução, trocada quando cai, nula quando a API já não a tem. */
  onSession: (sessionId: string | null) => void;
  /**
   * RN-ABAS-002: a aba chegou de outra janela, com o resultado que estava na tela (parado: a aba ocupada não muda de janela) e a sessão que já tinha,
   * com o cursor aberto nela. Nada é executado: "Carregar mais" continua de onde parou.
   */
  initial?: { state: RunnerState; sessionId: string | null };
  /** O nome da aba agora (ela pode ter sido renomeada ou salva como script): o aviso do fim do script o diz (RN-SQL-020). Sem ele, o aviso não diz a aba. */
  title?: () => string | null;
};

function withTruncated(current: ReadonlyMap<number, ReadonlySet<number>>, cells: [number, number][], rowOffset: number): ReadonlyMap<number, ReadonlySet<number>> {
  if (cells.length === 0) return current;

  const next = new Map(current);
  // Os índices da API são relativos à página (seção 6).
  for (const [row, column] of cells) next.set(rowOffset + row, new Set([...(next.get(rowOffset + row) ?? []), column]));
  return next;
}

/**
 * O que uma aba executa e mostra (RN-SQL-001 a 013): a sessão dela, o comando em andamento e o
 * resultado. É um objeto fora do React, guardado pelo `WorkbenchProvider`, acima das rotas: trocar
 * de aba ou ir a Conexões não interrompe o comando nem apaga o resultado, e duas abas rodam ao
 * mesmo tempo, cada uma na sua sessão (RN-SESSAO-001).
 *
 * As chamadas passam pelo cache de mutações, como qualquer `mutationFn`: a falha que a aba não
 * trata no lugar chega ao aviso central (RN-AVISO-004). As que ela trata voltam como valor
 * (`allowRefusal`) e viram o estado da área de resultado, com o aviso próprio de cada uma.
 *
 * O resultado que está na tela só é substituído quando a API aceitou um comando novo. O que é
 * recusado antes disso (seleção com mais de um comando, nada para enviar, `SESSION_BUSY`, controle
 * de transação recusado antes de executar, API fora do ar, resposta inválida) deixa o resultado e o
 * cursor dele como estavam, e avisa.
 */
export function createQueryRunner({ connectionId, database, queryClient, toast, onSession, initial, title }: QueryRunnerOptions): QueryRunner {
  let state: RunnerState = initial?.state ?? { status: "idle" };
  const listeners = new Set<() => void>();

  let sessionId: string | null = initial?.sessionId ?? null;
  /**
   * Cresce quando a aba é solta, e quando o comando da pessoa interrompe a execução automática (RN-GRADE-014): a resposta que chegar depois não acha mais
   * quem a esperava.
   */
  let epoch = 0;
  /** `retire()` foi chamado: o executor saiu de cena e não executa mais nada. */
  let retired = false;
  /** As operações que o executor aposentado já recusou e avisou: cada uma avisa uma vez, para um laço que insista não inundar o registro. */
  const refusedWhenRetired = new Set<string>();

  /**
   * Recusar o que um executor aposentado é pedido é o certo (um painel que ainda o segure não roda comando órfão), mas calado esconderia a regressão:
   * o painel que segura o executor velho e a pessoa que aperta Ctrl+Enter sem que nada aconteça. Fica no registro do processo, e o texto não leva
   * SQL nem dado de banco, só qual operação foi recusada.
   */
  function refuse(operation: "run" | "runScript" | "loadMore" | "countTotal"): void {
    if (refusedWhenRetired.has(operation)) return;

    refusedWhenRetired.add(operation);
    console.warn(`[prism] o executor de uma aba que já saiu de cena (bloqueio, aba fechada ou conexão removida) recusou "${operation}": o painel segurou o executor velho, e nada foi enviado ao banco.`);
  }
  // A chave da grade continua a contar do resultado que veio com a aba.
  let resultId = state.status === "rows" ? state.id : 0;
  /**
   * O usuário pediu o cancelamento do que está em andamento: o comando que ainda não foi enviado não sai, e não se pede duas vezes. O
   * desfecho do comando não é decidido por isto, e sim pelo `outcome` da API (RN-SQL-010, Ruling 135).
   */
  let cancelRequested = false;
  // O aviso das células cortadas já saiu na janela de onde a aba veio.
  let truncationWarned = state.status === "rows" && state.truncated.size > 0;
  /**
   * O texto mudou depois de o comando do editor ser enviado: a posição que o banco apontar já não é a do texto na tela. Só o comando que vem do editor
   * (`run`) o zera: "executar de novo" (o F5) e a execução automática repetem o comando de quando ele foi enviado, com o lugar no texto daquele instante.
   */
  let editedSinceRun = false;
  /**
   * RN-GRADE-014: a execução automática em andamento, ou a que o comando da pessoa interrompeu e que ainda ocupa a sessão (a resposta dela e a do
   * cancelamento ainda não chegaram). O comando da pessoa, "carregar mais", contar, exportar e levar a aba para outra janela esperam por ela.
   */
  let autoBusy: Promise<void> | null = null;
  /** Os erros inesperados que o aviso central já mostrou: a rede de segurança não avisa de novo. */
  const reported = new WeakSet<object>();

  /** RN-SQL-019 a 022: o script da aba (as abas de resultado, as Estatísticas, a pergunta de erro), ou nulo. Tem os seus ouvintes: o relógio da atualização automática não precisa dele. */
  let script: ScriptRun | null = null;
  const scriptListeners = new Set<() => void>();
  let scriptSerial = 0;
  /**
   * A pergunta de erro do script espera a resposta (RN-SQL-021): quem a resolve é a tela (`decide`), a aba solta (`release`, que para o script) ou uma
   * execução nova na aba (`stopPausedScript`, que a responde "Parar").
   */
  let deciding: ((choice: ScriptChoice) => void) | null = null;
  /** O laço do script em andamento (`runScript`), para quem precisa esperar o fim dele: a execução nova que para o script parado na pergunta de erro. */
  let scriptLoop: Promise<void> | null = null;

  function publishScript(next: ScriptRun | null) {
    if (next === script) return;
    script = next;
    for (const listener of scriptListeners) listener();
  }

  /** Um comando novo foi aceito (RN-SQL-020): os resultados do script saem com o resultado que ele substitui. */
  function dropScript() {
    publishScript(null);
  }

  function set(next: RunnerState) {
    state = next;
    for (const listener of listeners) listener();
  }

  function patchRows(patch: Partial<RowsState>) {
    if (state.status === "rows") set({ ...state, ...patch });
  }

  function setSession(id: string | null) {
    sessionId = id;
    onSession(id);
  }

  /**
   * A sessão caiu e fica caída (a API já não a conhece, e ninguém a reabre agora): a atualização automática para, com a nota, e não abre outra sozinha
   * (RN-GRADE-014, RN-SESSAO-004). O comando da pessoa que a reabre e executa não chama isto: o mesmo comando (o F5) a mantém ligada.
   */
  function sessionLost() {
    setSession(null);
    autoRefresh.lost();
  }

  /**
   * RN-SESSAO-002: a sessão executa um comando por vez, e "carregar mais" é um comando. A contagem
   * deixa a aba ocupada também, para o botão de cancelar ter uma coisa só a cancelar.
   */
  const isBusy = () => isBusyState(state);

  /**
   * Tira a aba do que estava em andamento: o comando que rodava volta ao resultado que estava na
   * tela (ou ao começo, sem resultado); a página e a contagem, ao resultado como estava.
   */
  function settle() {
    if (state.status === "running") set(state.previous ?? { status: "idle" });
    else if (state.status === "rows" && (state.loadingMore || state.counting || state.cancelling)) set({ ...state, loadingMore: false, counting: false, cancelling: false });
  }

  /**
   * A rede de segurança de executar, carregar mais e contar: um erro que ninguém previu (o que não
   * é recusa da API) não deixa a aba em "Executando…" para sempre. Ela volta ao que mostrava, e o
   * aviso sai uma vez só: pelo aviso central, se o erro passou por ele, ou daqui.
   */
  async function guarded(work: () => Promise<void>): Promise<void> {
    const started = epoch;
    try {
      await work();
    } catch (error) {
      // A aba foi solta depois de este comando começar: o que estiver em andamento agora é de outro comando, e não é dele que o erro fala.
      if (started !== epoch) return;
      settle();
      if (!(typeof error === "object" && error !== null && reported.has(error))) toast.error(copy.unexpectedError);
    }
  }

  /**
   * Uma chamada da aba. `handled` diz, quando a resposta chega, se a recusa é das que a aba trata no
   * lugar; as demais lançam dentro da mutação, viram o aviso central e voltam aqui como valor, só
   * para o estado sair de "executando". Com a aba já solta, nada é avisado.
   */
  async function call<T>(request: () => Promise<ApiResult<T>>, handled: (error: ApiError) => boolean = () => false): Promise<ApiResult<T>> {
    const started = epoch;
    try {
      return await throughMutationCache(queryClient, async () => {
        const result = await request();
        // `allowRefusal` sem códigos lança a recusa que a aba não trata.
        return started !== epoch || result.ok || handled(result.error) ? result : allowRefusal(result);
      });
    } catch (error) {
      if (error instanceof ApiRequestError) return { ok: false, error: error.error };
      if (typeof error === "object" && error !== null) reported.add(error);
      throw error;
    }
  }

  /**
   * Abre a sessão da aba na primeira execução (RN-SESSAO-001) e envia o comando. Se a API já não
   * conhece a sessão (ela caiu), abre outra e repete uma vez (seção 7). `null` quando não há o que
   * mostrar: a aba foi solta, ou o comando foi cancelado antes de ser enviado. `reopen` falso é a execução automática (RN-GRADE-014) e o script depois
   * do primeiro comando respondido (RN-SQL-021): a sessão que caiu fica caída, e a resposta é a da API. `handled`: as recusas que quem chama trata a mais
   * (as do comando, no script). `keep`: os resultados das abas do script que ficam na tela, e que a API continua guardando para a edição (RN-SQL-024).
   */
  async function execute(connection: string, sql: string, started: number, filter: string | undefined, reopen: boolean, handled: readonly string[] = [], keep: readonly string[] = []): Promise<ApiResult<QueryResult> | null> {
    for (let reopened = false; ; reopened = true) {
      let id = sessionId;

      if (id === null) {
        const opened = await call(() => openDatabaseSession(connection, database));
        if (started !== epoch) {
          // A aba foi solta enquanto a sessão abria: ninguém mais a usaria nem a fecharia.
          if (opened.ok) void call(() => closeDatabaseSession(opened.data.id), codes("DATABASE_SESSION_NOT_FOUND")).catch(() => undefined);
          return null;
        }
        if (!opened.ok) {
          // A sessão que caiu não reabriu: a aba segue sem ela.
          if (reopened) autoRefresh.lost();
          return opened;
        }

        id = opened.data.id;
        setSession(id);
        if (reopened) toast.warning(copy.sessionReopened);
        if (cancelRequested) {
          settle();
          return null;
        }
      }

      const session = id;
      // RN-PROT-002: a recusa do somente leitura é tratada no lugar, como a do controle de transação: a frase da API, e o resultado de antes fica.
      const result = await call(
        () => executeQuery(session, sql, filter, keep),
        codes("SQL_EXECUTION_FAILED", "TRANSACTION_CONTROL_NOT_SUPPORTED", "CONNECTION_READ_ONLY", ...handled, ...(filter === undefined ? [] : ["FILTER_INVALID"]), ...(reopened ? [] : ["DATABASE_SESSION_NOT_FOUND"])),
      );
      if (started !== epoch) return null;
      if (result.ok || result.error.code !== "DATABASE_SESSION_NOT_FOUND") return result;

      // Reabrir é do comando da pessoa (`reopen`), uma vez; fora isso a sessão fica caída.
      if (!reopen || reopened || cancelRequested) {
        sessionLost();
        return result;
      }
      setSession(null);
    }
  }

  /**
   * O que fica na área de resultado quando o comando não deu resultado. `previous` é o resultado
   * que estava na tela: linhas, linhas afetadas ou um erro de SQL.
   *
   * O erro de SQL substitui o que estava lá: o banco executou o comando novo e fechou o cursor
   * anterior. É a mensagem dele, como veio (decisão 4 da seção 8), com as linhas de detalhe e de
   * dica que mandar. Depois de um pedido de cancelamento, quem diz o desfecho é a API (`outcome`,
   * RN-SQL-010 e Ruling 135): com `canceled` fica "Comando cancelado."; com `unknown` e `partial` o
   * detalhe dela fica como erro do banco, e o aviso diz que o desfecho é incerto ou que o que o
   * comando gravou ficou. Nunca o SQLSTATE nem o texto: cada banco tem os seus.
   *
   * O controle de transação que rodou (`executed`, RN-SESSAO-005) também substitui: a API desfez a
   * transação que ele deixou aberta, e o cursor anterior fechou.
   *
   * A recusa do somente leitura (`CONNECTION_READ_ONLY`, RN-PROT-002) é como a do controle de transação
   * antes de executar: nada foi ao banco, o cursor anterior continua aberto e o resultado de antes fica, com
   * a frase da API no aviso; sem resultado na tela, a frase vai à área de resultado.
   *
   * Nos outros casos a API não aceitou comando nenhum, e `previous` continua na tela: o aviso diz
   * o que houve. Sem resultado na tela, a área de resultado mostra a frase da API para o controle
   * de transação (RN-SQL-003) e a mensagem do banco para a conexão que não abriu (seção 7).
   */
  function failed(error: ApiError, target: RunTarget, previous: ResultState | null, notify = true): RunnerState {
    const message = error.detail ?? error.title;

    if (error.code === "SQL_EXECUTION_FAILED") {
      const outcome = cancelOutcomeOf(error);
      if (outcome === "canceled") {
        if (notify) toast.warning(copy.commandCancelled);
        return { status: "cancelled" };
      }

      const { sqlState, position } = sqlErrorDetails(error.extensions);
      // O script (RN-SQL-021) diz o erro na pergunta e nas Estatísticas, e avisa uma vez, no fim.
      if (notify) {
        if (outcome === null) toast.error(copy.commandFailed);
        else toast.warning(outcomeCopy[outcome]);
      }
      // RN-GRADE-011: com o filtro do resultado, o banco executou o comando que a API montou, e a posição é dele, e não do texto do editor.
      const marked = position === null || editedSinceRun || target.filter !== undefined ? null : target.offset + utf16IndexOf(target.sql, position);
      return { status: "error", source: "database", title: resultCopy.errorTitle, message, sqlState, errorAt: marked };
    }

    if (error.code === "TRANSACTION_CONTROL_NOT_SUPPORTED") {
      const executed = wasExecuted(error);
      if (previous !== null && !executed) {
        if (notify) toast.error(error.title, error.detail ?? undefined);
        return previous;
      }
      if (notify) toast.error(copy.commandFailed);
      return { status: "error", source: "api", title: error.title, message: error.detail, sqlState: null, errorAt: null, ...(executed ? { executed: true as const } : {}) };
    }

    // RN-PROT-002: o comando que não é leitura numa conexão somente leitura. A API recusou antes de ir ao banco: o resultado e o cursor dele ficam.
    if (error.code === "CONNECTION_READ_ONLY") {
      if (previous !== null) {
        if (notify) toast.error(error.title, error.detail ?? undefined);
        return previous;
      }
      if (notify) toast.error(copy.commandFailed);
      return { status: "error", source: "api", title: error.title, message: error.detail, sqlState: null, errorAt: null };
    }

    // Daqui em diante o aviso central já disse o que houve.
    if (previous !== null) return previous;
    if (error.code === "DATABASE_CONNECTION_FAILED") return { status: "error", source: "connection", title: resultCopy.errorTitle, message, sqlState: null, errorAt: null };
    if (error.code === driverNotInstalledCode) return { status: "error", source: "driver", title: resultCopy.driverMissingTitle, message, sqlState: null, errorAt: null, driverID: driverIdOf(error.extensions) };
    return { status: "idle" };
  }

  /** RN-AVISO-003: valores cortados avisam uma vez por resultado, e não a cada página. */
  function warnTruncated(page: QueryPage) {
    if (page.truncatedCells.length === 0 || truncationWarned) return;
    truncationWarned = true;
    toast.warning(copy.valuesTruncated);
  }

  function closeCursor() {
    patchRows({ cursorClosed: true });
    toast.warning(copy.cursorClosed);
  }

  /**
   * O aviso de "carregar mais" e de "contar total" que terminaram depois de um pedido de cancelamento (RN-SQL-010): a API diz o desfecho
   * (`outcome`), e as linhas ficam na tela. `canceled` é "Comando cancelado."; `unknown` e `partial` levam o detalhe da API no aviso, porque aqui
   * não há área de resultado para ele. Sem `outcome` o erro é do banco, e o aviso central já o mostrou.
   */
  function warnOutcome(error: ApiError) {
    const outcome = cancelOutcomeOf(error);
    if (outcome === "canceled") toast.warning(copy.commandCancelled);
    else if (outcome !== null) toast.warning(outcomeCopy[outcome], error.detail ?? undefined);
  }

  function setCancelling(cancelling: boolean) {
    if (state.status === "running") set({ ...state, cancelling });
    else patchRows({ cancelling });
  }

  /**
   * RN-GRADE-014: o comando da pessoa toma o lugar da execução automática em andamento. Ela é abandonada: a resposta dela não acha mais quem a esperava
   * (`epoch`), e não muda a tela nem avisa; o relógio esquece dela (`yielded`); e a API recebe o cancelamento, calado (o que ele responder não interessa à
   * pessoa). Devolve quando a sessão estiver livre: a resposta dela e a do cancelamento chegaram, e o cancelamento não alcança o comando da pessoa.
   */
  function abandonAuto(): Promise<void> {
    const running = autoBusy ?? Promise.resolve();
    epoch++;
    autoRefresh.yielded();
    const session = sessionId;
    const cancelled =
      session === null
        ? Promise.resolve()
        : call(
            () => cancelQuery(session),
            () => true,
          ).then(
            () => undefined,
            () => undefined,
          );
    return holdAuto(Promise.all([running, cancelled]).then(() => undefined));
  }

  /**
   * RN-GRADE-014: a pessoa desligou ("Desligar", o X) com a execução automática em andamento. Ela é abandonada como quando o comando da pessoa toma o lugar
   * dela (`abandonAuto`): a resposta não muda mais a tela nem avisa, e a API recebe o cancelamento, calado. O resultado de antes volta já, com o cursor
   * fechado (o banco executou o comando dela, RN-SQL-007). Sem isso, ela seguia sem nada na tela dizer, a aba ficava ocupada, e o resultado (ou o erro, com
   * o aviso) chegava depois de desligada.
   */
  function stopAuto() {
    autoRefresh.stop();
    if (!isAutoRun(state)) return;

    const shown = withCursorClosed(state.status === "running" ? state.previous : null);
    void abandonAuto();
    set(shown ?? { status: "idle" });
  }

  /** Junta `work` ao que ocupa a sessão em nome da atualização automática (`autoBusy`), e devolve o todo. */
  function holdAuto(work: Promise<void>): Promise<void> {
    const all = autoBusy === null ? work : Promise.all([autoBusy, work]).then(() => undefined);
    autoBusy = all;
    void all.then(() => {
      if (autoBusy === all) autoBusy = null;
    });
    return all;
  }

  /**
   * Executa o comando. `person`: o do editor (e o dos Registros, do filtro do resultado). `again`: "executar de novo" (o F5), o comando das linhas na tela,
   * com o lugar no texto de quando ele foi enviado. `auto`: a execução da atualização automática (RN-GRADE-014), que não repete o aviso de valores cortados
   * e mantém a grade quando as colunas são as mesmas. O comando da pessoa (`person` e `again`) avisa o relógio antes de enviar (outro comando a desliga) e,
   * com a execução automática em andamento, toma o lugar dela: a aba o mostra rodando desde já, e ele sai quando a sessão estiver livre. `clearsScript`: o
   * comando aceito troca os resultados do script que estiver na tela (RN-SQL-020: o Ctrl+Enter, "Executar este comando"); o F5, o filtro e a execução
   * automática no resultado do último comando do script mudam só ele.
   */
  const runWith = async (target: RunTarget, kind: "person" | "again" | "auto", clearsScript = false): Promise<FilterRefusal | void> => {
    const auto = kind === "auto";
    let refusal: FilterRefusal | undefined;
    await guarded(async () => {
      if (retired) return refuse("run");
      // RN-SESSAO-002: um comando por vez. A execução automática não segura o comando da pessoa (`isPersonBusy`): ele toma o lugar dela, abaixo.
      if (auto ? isBusy() : isPersonBusy(state)) return;

      // RN-SQL-001: uma execução leva um comando só. O comando do cursor é sempre um; a seleção pode ter mais, ou nenhum.
      const statements = statementCount(target.sql, target.engine);
      // O que está na tela: com a execução automática rodando, o resultado de antes dela.
      const previous = state.status === "running" ? state.previous : resultOf(state);
      if (statements === 0) {
        toast.warning(copy.nothingToSend);
        return;
      }
      if (statements > 1) {
        // Nada foi enviado. Com um resultado na tela, ele e o cursor dele ficam: basta o aviso.
        // RN-SQL-019: os dois avisos ensinam o "Executar script", que executa todos.
        if (previous === null) set({ status: "notice", message: resultCopy.tooManyStatements(statements, platformScriptShortcut) });
        toast.warning(copy.tooManyStatements(platformScriptShortcut));
        return;
      }

      // RN-SCRIPT-003: sem conexão não há sessão a abrir. A aba pede uma conexão; nada foi enviado.
      if (connectionId === null) {
        if (previous === null) set({ status: "notice", message: scriptsCopy.toasts.noConnection });
        toast.warning(scriptsCopy.toasts.noConnection);
        return;
      }

      // RN-GRADE-014: a execução automática em andamento cede o lugar ao comando da pessoa (antes de `started`: a resposta dela já não é desta execução); a
      // que já foi abandonada (desligada no meio) e ainda ocupa a sessão é esperada, pelo comando da pessoa e pela execução automática seguinte.
      const yielding = !auto && isAutoRun(state) ? abandonAuto() : autoBusy;
      const started = epoch;
      cancelRequested = false;
      if (kind === "person") editedSinceRun = false;
      if (!auto) autoRefresh.ranByPerson(target);
      set({ status: "running", cancelling: false, previous: yielding === null ? previous : withCursorClosed(previous), ...(auto ? { auto: true as const } : {}) });

      if (yielding !== null) {
        await yielding;
        if (started !== epoch) return;
        // Cancelado enquanto a sessão se livrava: nada foi enviado, e o resultado de antes volta.
        if (cancelRequested) return settle();
      }

      // RN-SQL-024: o comando que troca os resultados do script não guarda nenhum; o F5, o filtro e a execução automática do resultado do último comando
      // guardam os das outras abas, que continuam se editando.
      const result = await execute(connectionId, target.sql, started, target.filter, !auto, [], clearsScript ? [] : keptResultIds(script));
      if (result === null) return;
      // RN-GRADE-011: a API recusou o filtro antes de executar: o resultado e o cursor de antes ficam como estavam, e a frase vai ao campo de filtro.
      if (!result.ok && result.error.code === "FILTER_INVALID" && target.filter !== undefined) {
        refusal = { code: "FILTER_INVALID", message: result.error.detail ?? result.error.title };
        settle();
        return;
      }
      // O que está na tela agora, e não o de quando o comando começou: uma edição no meio já tirou a posição de um erro.
      if (!result.ok) {
        const shown = state.status === "running" ? state.previous : null;
        const next = failed(result.error, target, shown);
        // O que a API não aceitou deixa na tela o que estava, com o script dele (RN-SQL-020).
        if (clearsScript && next !== shown) dropScript();
        return set(next);
      }

      if (clearsScript) dropScript();
      const data = result.data;
      if (data.kind === "affected") {
        set({ status: "affected", rowsAffected: data.rowsAffected, elapsedMs: data.elapsedMs });
        toast.success(copy.commandExecuted(data.rowsAffected));
        return;
      }

      // RN-AVISO-003: o aviso é um por resultado, e o resultado que a atualização automática refaz é o mesmo: quem já foi avisado não é de novo (nem pelo
      // "carregar mais" que vem depois dela).
      if (!auto) truncationWarned = false;
      set({
        status: "rows",
        id: auto && previous?.status === "rows" && sameColumns(previous.columns, data.columns) ? previous.id : ++resultId,
        target,
        columns: data.columns,
        rows: data.rows,
        truncated: withTruncated(new Map(), data.truncatedCells, 0),
        // Com o total, o comando já acabou e não há cursor: nada a carregar, diga a resposta o que disser.
        hasMore: data.totalRows === null && data.hasMore,
        totalRows: data.totalRows,
        elapsedMs: data.elapsedMs,
        pages: 1,
        loadingMore: false,
        cancelling: false,
        cursorClosed: false,
        total: null,
        counting: false,
        resultId: data.resultId ?? null,
        sessionId,
        // RN-GRADE-011: o resultado embrulhado pelo filtro é só leitura, e diz por quê (a API pode já dizer; senão, a frase da tela).
        readOnly: data.readOnly ?? (data.filterApplied === "wrapped" ? gridFilterCopy.result.wrapped : null),
        filterApplied: data.filterApplied ?? null,
      });
      // RN-SQL-013 e RN-AVISO-002: o comando gravou e está confirmado; as linhas são o que ele devolveu.
      if (data.totalRows !== null) toast.success(copy.commandCompleted(data.totalRows));
      // RN-GRADE-014: a execução automática não repete o aviso de valores cortados; as células seguem marcadas, e "carregar mais" ainda avisa.
      if (!auto) warnTruncated(data);
    });
    return refusal;
  };

  /**
   * RN-SQL-020 e 021: uma execução nova na aba (o Ctrl+Enter, "Executar este comando", outro script, o F5) com a pergunta de erro do script esperando a
   * resposta é a resposta "Parar": o script para com o que já rodou (as Estatísticas e o aviso do fim, como no "Parar" da pergunta), e só depois de ele
   * terminar a execução nova segue, e troca os resultados dele quando a API a aceitar. Sem isso o laço do script esperava para sempre uma resposta que a
   * tela, sem o script na tela, não daria mais, e uma resposta atrasada o retomaria por cima do comando novo. `sends` diz se a execução vai mesmo sair: a
   * que o executor recusaria antes de enviar (nada a enviar, mais de um comando, a aba sem conexão) só avisa, e a pergunta continua esperando. Sem pergunta
   * esperando, nada muda: quem chama vê a aba ocupada na mesma chamada, como antes.
   */
  function afterPausedScript<T>(sends: boolean, next: () => Promise<T>): Promise<T> {
    const answer = deciding;
    if (answer === null || !sends) return next();

    deciding = null;
    answer("stop");
    const loop = scriptLoop ?? Promise.resolve();
    return loop.then(next);
  }

  /** O comando vai mesmo à API: um comando só, e a aba com conexão (o resto o executor recusa antes, só com o aviso). */
  const sends = (target: RunTarget) => connectionId !== null && statementCount(target.sql, target.engine) === 1;

  const run = (target: RunTarget, options?: { keepScript?: boolean }) => afterPausedScript(sends(target), () => runWith(target, "person", options?.keepScript !== true));

  /**
   * O "Executar script" (seção 31, RN-SQL-019 a 022): os comandos, um por vez, na ordem, pela sessão da aba e pelo mesmo caminho de `run` (`execute`: a
   * sessão abre no primeiro, e a API recebe um comando por pedido). O executor fica "executando" do primeiro ao último (a aba ocupada para a pessoa e
   * para o bloqueio, RN-SEG-001), menos na pergunta de erro, que espera a resposta com o resultado do comando que falhou (não segura o bloqueio). O que
   * cada comando deixou é o `previous` do seguinte, como numa execução, e o executor termina com o do último; o script guarda as abas e as Estatísticas.
   *
   * O que a API não aceitou no primeiro comando, sem resposta sobre comando nenhum (a conexão que não abre, a sessão ocupada, a API fora do ar, o cancelamento
   * antes do primeiro), deixa a tela como estava: o script de antes volta, e o executor faz o que faria com o Ctrl+Enter. Depois do primeiro, a sessão que
   * cai não é reaberta: o que os comandos de antes deixaram nela (uma tabela temporária, um SET) se perdeu.
   */
  const runScript = (commands: readonly RunTarget[]): Promise<void> => afterPausedScript(connectionId !== null && commands.length > 0, () => runScriptNow(commands));

  const runScriptNow = async (commands: readonly RunTarget[]): Promise<void> => {
    const loop = guarded(async () => {
      if (retired) return refuse("runScript");
      if (isPersonBusy(state)) return;

      const previous = state.status === "running" ? state.previous : resultOf(state);
      if (commands.length === 0) {
        toast.warning(copy.nothingToSend);
        return;
      }
      // RN-SCRIPT-003: sem conexão não há sessão a abrir. A aba pede uma conexão; nada foi enviado.
      if (connectionId === null) {
        if (previous === null) set({ status: "notice", message: scriptsCopy.toasts.noConnection });
        toast.warning(scriptsCopy.toasts.noConnection);
        return;
      }

      // RN-GRADE-014: o script é outro comando: a execução automática em andamento cede o lugar, e a atualização automática desliga.
      const yielding = isAutoRun(state) ? abandonAuto() : autoBusy;
      const started = epoch;
      const before = script;
      cancelRequested = false;
      editedSinceRun = false;
      truncationWarned = false;
      autoRefresh.halt();
      publishScript(createScriptRun(++scriptSerial, commands));
      set({ status: "running", cancelling: false, previous: yielding === null ? previous : withCursorClosed(previous) });

      // O resultado na tela agora: o de antes do script, e depois o que cada comando deixou.
      let shown: ResultState | null = state.status === "running" ? state.previous : null;
      /** A API respondeu sobre algum comando (deu certo, ou o erro foi dele): daí em diante o script tem o que mostrar. */
      let answered = false;
      /** O comando cujo resultado de linhas é o `shown`, com o cursor aberto (RN-SQL-007). */
      let live: number | null = null;
      let kept = 0;
      let skipAll = false;

      const patch = (change: (run: ScriptRun) => ScriptRun) => {
        if (script !== null && started === epoch) publishScript(change(script));
      };
      // O fim: o executor fica com o que o último comando deixou, e o aviso sai uma vez (RN-SQL-020). A aba do último comando executado fica sempre,
      // quando ele devolveu linhas, também depois do limite: é a do cursor aberto, e a aba dela mostra o executor.
      const finish = (phase: "done" | "stopped" | "cancelled") => {
        if (state.status === "running") set(shown ?? { status: "idle" });
        const last = shown?.status === "rows" ? live : null;
        const rows = shown;
        patch((run) => {
          const ended = { ...finishRun(run, phase), live: last };
          if (last === null || rows?.status !== "rows" || ended.results.some((result) => result.entry === last)) return ended;
          return { ...withEntry(ended, last, { kept: true }), results: [...ended.results, { entry: last, rows }] };
        });
        const end = script === null ? null : scriptEndToast(script, title?.() ?? null);
        if (end !== null) toast[end.tone](end.message);
      };
      // Nada chegou ao banco nem foi respondido sobre um comando: a tela volta ao que estava, com o script de antes.
      const untouched = () => {
        publishScript(before);
        settle();
      };

      try {
        if (yielding !== null) {
          await yielding;
          if (started !== epoch) return;
          if (cancelRequested) return untouched();
        }

        for (let index = 0; index < commands.length; ) {
          const target = commands[index];
          patch((run) => startEntry(run, index));
          set({ status: "running", cancelling: false, previous: shown });

          // RN-SQL-024: cada comando (e o "Tentar de novo") manda os resultados das abas que o script já tem: a API continua guardando o que a edição deles
          // precisa. O primeiro comando de um script novo não manda nenhum, e a API esquece os do script de antes quando ele vai ao banco.
          const result = await execute(connectionId, target.sql, started, undefined, !answered, scriptCommandRefusals, keptResultIds(script));
          // A aba foi solta (desconectar, fechar, trocar de banco, o bloqueio): `release` já parou o script.
          if (started !== epoch) return;
          // Cancelado antes de o comando sair (a sessão abria): nada dele rodou, e o executor já voltou ao que mostrava.
          if (result === null) {
            if (!answered) return untouched();
            return finish("cancelled");
          }

          if (result.ok) {
            answered = true;
            const data = result.data;
            if (data.kind === "affected") {
              shown = { status: "affected", rowsAffected: data.rowsAffected, elapsedMs: data.elapsedMs };
              live = null;
              patch((run) => withEntry(run, index, { status: "ok", affected: data.rowsAffected, elapsedMs: data.elapsedMs }));
            } else {
              const rows: RowsState = {
                status: "rows",
                id: ++resultId,
                target,
                columns: data.columns,
                rows: data.rows,
                truncated: withTruncated(new Map(), data.truncatedCells, 0),
                hasMore: data.totalRows === null && data.hasMore,
                totalRows: data.totalRows,
                elapsedMs: data.elapsedMs,
                pages: 1,
                loadingMore: false,
                cancelling: false,
                cursorClosed: false,
                total: null,
                counting: false,
                resultId: data.resultId ?? null,
                sessionId,
                readOnly: data.readOnly ?? null,
                filterApplied: data.filterApplied ?? null,
              };
              shown = rows;
              live = index;
              // RN-SQL-020: as abas dos primeiros comandos que devolvem linhas; a do último é guardada no fim, se passou do limite.
              const keep = kept < scriptResultCap;
              if (keep) kept++;
              patch((run) => ({
                ...withEntry(run, index, { status: "ok", rows: { read: data.rows.length, more: rows.hasMore, total: data.totalRows }, elapsedMs: data.elapsedMs, kept: keep }),
                results: keep ? [...run.results, { entry: index, rows }] : run.results,
              }));
              // RN-AVISO-003: uma vez por script.
              warnTruncated(data);
            }
            // RN-SQL-022: o cancelamento chegou depois de o comando terminar: ele fica como concluído, e o script para.
            if (cancelRequested) return finish("cancelled");
            index++;
            continue;
          }

          const error = result.error;
          const outcome = cancelOutcomeOf(error);
          const commandError = error.code === "SQL_EXECUTION_FAILED" || (scriptCommandRefusals as readonly string[]).includes(error.code);
          if (!commandError && !answered) {
            // Nada foi respondido sobre um comando: o que o Ctrl+Enter faria (o aviso central já disse o que houve), e a tela como estava.
            publishScript(before);
            return set(failed(error, target, shown));
          }

          answered = true;
          const next = failed(error, target, shown, false);
          if (next !== shown) live = null;
          shown = resultOf(next);
          const reason = error.code === "DATABASE_SESSION_NOT_FOUND" ? { title: error.title, message: scriptRunCopy.error.sessionLost, sqlState: null } : scriptErrorOf(error);

          // RN-SQL-022: cancelado pela pessoa. Com o desfecho do cancelamento (`canceled`) ele fica cancelado; incerto ou parcial, com o erro e a frase da API.
          if (outcome === "canceled") {
            set(next);
            patch((run) => withEntry(run, index, { status: "cancelled" }));
            return finish("cancelled");
          }
          if (cancelRequested || outcome !== null) {
            set(next);
            patch((run) => withEntry(run, index, { status: "error", error: reason }));
            return finish("cancelled");
          }
          // O que não é do comando (a sessão que caiu, ocupada, a API fora do ar) para o script sem perguntar.
          if (!commandError) {
            set(next);
            patch((run) => withEntry(run, index, { status: "error", error: reason }));
            return finish("stopped");
          }

          if (skipAll) {
            patch((run) => withEntry(run, index, { status: "skipped", error: reason }));
            index++;
            continue;
          }

          // RN-SQL-021: a pergunta. O executor mostra o erro (e o editor, a posição dele) e não está ocupado enquanto ela espera.
          set(next);
          patch((run) => ({ ...withEntry(run, index, { status: "error", error: reason }), phase: "paused", current: index }));
          const choice = await new Promise<ScriptChoice>((resolve) => (deciding = resolve));
          if (started !== epoch) return;
          if (choice === "stop") return finish("stopped");
          if (choice === "retry") continue;
          if (choice === "skipAll") skipAll = true;
          patch((run) => withEntry(run, index, { status: "skipped" }));
          index++;
        }

        finish("done");
      } finally {
        // Um erro que ninguém previu (a rede de segurança, `guarded`) não deixa o script "executando" para sempre.
        if (started === epoch && script !== null && (script.phase === "running" || script.phase === "paused")) publishScript(finishRun(script, "stopped", "error"));
      }
    });
    scriptLoop = loop;
    await loop;
    if (scriptLoop === loop) scriptLoop = null;
  };

  /** RN-GRADE-014: o que a pessoa pede sobre o resultado na tela espera a execução automática em andamento, e segue sobre o resultado novo. */
  const afterAuto = async () => {
    while (autoBusy !== null) await autoBusy;
  };

  /**
   * Espera a execução automática em andamento (`afterAuto`) e diz se o executor saiu de cena NESSE meio-tempo: trocar o banco ou a conexão da aba (ou fechá-la)
   * com ela rodando a desliga e aposenta o executor, e o "Carregar mais" ou o "Contar total" que esperavam desistem calados, porque o painel não segurava um
   * executor velho. A recusa com o registro (`refuse`) fica para o pedido que chega a um executor já aposentado.
   */
  const retiredWhileWaiting = async () => {
    const before = retired;
    await afterAuto();
    return retired && !before;
  };

  const loadMore = async () => {
    // Sem a espera, tudo até o envio acontece já na chamada: quem chama vê a aba ocupada na hora.
    if (autoBusy !== null && (await retiredWhileWaiting())) return;
    return guarded(async () => {
      if (retired) return refuse("loadMore");
      if (state.status !== "rows" || !state.hasMore || state.cursorClosed || isBusy()) return;
      // Aba desconectada: o cursor foi fechado com a sessão.
      if (sessionId === null) return closeCursor();

      const session = sessionId;
      const started = epoch;
      cancelRequested = false;
      patchRows({ loadingMore: true });

      // Cancelado no meio, o erro que traz o desfecho do cancelamento (`outcome`) não é uma falha a avisar; o que não traz é erro do banco.
      const page = await call(
        () => fetchNextPage(session),
        (error) => codes("NO_OPEN_CURSOR", "DATABASE_SESSION_NOT_FOUND")(error) || cancelOutcomeOf(error) !== null,
      );
      const current = state;
      if (started !== epoch || current.status !== "rows") return;

      if (page.ok) {
        const { rows, truncatedCells, hasMore } = page.data;
        set({ ...current, rows: [...current.rows, ...rows], truncated: withTruncated(current.truncated, truncatedCells, current.rows.length), hasMore, pages: current.pages + 1, loadingMore: false, cancelling: false });
        warnTruncated(page.data);
        return;
      }

      patchRows({ loadingMore: false, cancelling: false });
      if (page.error.code === "DATABASE_SESSION_NOT_FOUND") sessionLost();
      if (page.error.code === "NO_OPEN_CURSOR" || page.error.code === "DATABASE_SESSION_NOT_FOUND") closeCursor();
      else if (page.error.code === "SQL_EXECUTION_FAILED") {
        // A leitura falhou ou foi cancelada: o comando morreu e a API fechou o cursor (o pedido seguinte já responderia 409
        // `NO_OPEN_CURSOR`), então as linhas ficam e a tela oferece executar de novo, em vez de um "Carregar mais" que não leva a nada.
        // O aviso é o da falha, que o aviso central já deu, ou o do desfecho do cancelamento.
        patchRows({ cursorClosed: true });
        warnOutcome(page.error);
      }
    });
  };

  const countTotal = async () => {
    if (autoBusy !== null && (await retiredWhileWaiting())) return;
    return guarded(async () => {
      // Só há o que contar quando há linhas que a tela não leu (RN-SQL-006): com o resultado inteiro
      // na tela, o total é o que está nela, e o comando que gravou já o trouxe (RN-SQL-013). O total
      // já contado se conta de novo (issue #10), mesmo que as linhas tenham chegado ao fim depois.
      if (retired) return refuse("countTotal");
      if (state.status !== "rows" || (!state.hasMore && state.total === null) || sessionId === null || isBusy()) return;

      const session = sessionId;
      const started = epoch;
      cancelRequested = false;
      patchRows({ counting: true });

      // Recusado pelo banco (ou por qualquer outro motivo), o aviso central leva a mensagem (RN-SQL-006).
      // Cancelada no meio, o erro que traz o desfecho do cancelamento (`outcome`) não é uma falha a avisar.
      const counted = await call(
        () => countQueryTotal(session),
        (error) => cancelOutcomeOf(error) !== null,
      );
      if (started !== epoch || state.status !== "rows") return;

      if (!counted.ok && counted.error.code === "DATABASE_SESSION_NOT_FOUND") sessionLost();
      if (!counted.ok) warnOutcome(counted.error);
      // Cancelar a contagem não mexe no resultado nem no cursor (RN-SQL-010); a que terminou antes mostra o total. A que falhou, ou foi
      // cancelada, deixa o total de antes à vista (o de uma contagem anterior, quando é "Contar de novo").
      patchRows({ counting: false, cancelling: false, ...(counted.ok ? { total: counted.data.total } : {}) });
    });
  };

  async function cancel(): Promise<void> {
    if (!isBusy() || cancelRequested) return;

    cancelRequested = true;
    setCancelling(true);
    // A sessão ainda está abrindo: basta não enviar o comando quando ela abrir.
    if (sessionId === null) return;

    const session = sessionId;
    const started = epoch;
    const delivered = await call(() => cancelQuery(session), codes("DATABASE_SESSION_NOT_FOUND")).then(
      (result) => result.ok || result.error.code === "DATABASE_SESSION_NOT_FOUND",
      () => false,
    );

    // O pedido não chegou à sessão (o aviso central já disse por quê): o comando segue, e dá para pedir de novo.
    if (!delivered && started === epoch && isBusy()) {
      cancelRequested = false;
      setCancelling(false);
    }
  }

  function release() {
    const released = { sessionId, busy: isBusy() };

    // Desconectar, fechar a aba, trocar de banco, ir para outra janela, o bloqueio: a atualização automática desliga antes de o comando sair de cena.
    autoRefresh.halt();
    epoch++;
    sessionId = null;
    cancelRequested = false;
    settle();
    // RN-SQL-022: o script para com a sessão. O comando que rodava fica cancelado (a sessão fecha com ele), e o que esperava a pergunta, com o erro dele.
    if (script !== null && (script.phase === "running" || script.phase === "paused")) publishScript(finishRun(script, script.phase === "paused" ? "stopped" : "cancelled", "cancelled"));
    const answer = deciding;
    deciding = null;
    answer?.("stop");

    return released;
  }

  function retire() {
    const released = release();

    retired = true;
    truncationWarned = false;
    editedSinceRun = false;
    set({ status: "idle" });
    publishScript(null);

    return released;
  }

  // RN-GRADE-014: o relógio da atualização automática observa este executor e executa por ele, como execução automática.
  const autoRefresh = createAutoRefresh({
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    isBusy: isBusyState,
    connected: () => sessionId !== null && !retired,
    run: (target) => holdAuto(runWith(target, "auto").then(() => undefined)),
  });

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,
    run,
    runScript,
    runCommand: (target) => afterPausedScript(sends(target), () => runWith(target, "again", true).then(() => undefined)),
    script: {
      subscribe: (listener) => {
        scriptListeners.add(listener);
        return () => void scriptListeners.delete(listener);
      },
      getState: () => script,
      decide: (choice) => {
        const answer = deciding;
        deciding = null;
        answer?.(choice);
      },
    },
    rerun: () => {
      // Com a execução automática em andamento, o resultado na tela é o de antes dela, e o comando dele é o que se executa de novo.
      const shownTarget = () => {
        const shown = state.status === "running" ? state.previous : state;
        return shown?.status === "rows" ? shown.target : null;
      };
      const before = shownTarget();
      return afterPausedScript(before !== null && sends(before), async () => {
        const target = shownTarget();
        if (target !== null) await runWith(target, "again");
      });
    },
    cancel,
    autoRunSettled: afterAuto,
    loadMore,
    countTotal,
    textEdited: () => {
      editedSinceRun = true;
      if (state.status === "error" && state.errorAt !== null) set({ ...state, errorAt: null });
      // O erro que está na tela enquanto outro comando roda também perde a posição: ela não pode voltar, velha, se ele for restaurado.
      else if (state.status === "running" && state.previous?.status === "error" && state.previous.errorAt !== null) set({ ...state, previous: { ...state.previous, errorAt: null } });
    },
    sessionOf: () => sessionId,
    keepSaved: (savedIn, { rows, truncated, generated, sourceRows }) => {
      const saved = { rows, truncated, generated, ...(sourceRows === undefined ? {} : { sourceRows }) };
      if (state.status === "rows" && state.resultId === savedIn) {
        if (!isBusy()) set({ ...state, ...saved, cursorClosed: state.cursorClosed || state.hasMore });
        return;
      }
      // RN-SQL-023: o Salvar de uma aba guardada do script. Ele foi um comando na sessão, e o cursor aberto do resultado do último comando fechou.
      const next = script === null ? null : withSavedResult(script, savedIn, saved);
      if (next === null || next === script) return;
      publishScript(next);
      if (state.status === "rows" && state.hasMore && !state.cursorClosed && !isBusy()) set({ ...state, cursorClosed: true });
    },
    release,
    retire,
    autoRefresh: { subscribe: autoRefresh.subscribe, getState: autoRefresh.getState, blocker: autoRefresh.blocker, start: autoRefresh.start, stop: stopAuto, pause: autoRefresh.pause },
  };
}

/** O estado do que a aba executa, para o componente que o desenha. */
export function useQueryRunner(runner: QueryRunner): RunnerState {
  return useSyncExternalStore(runner.subscribe, runner.getState);
}

/** O script da aba (RN-SQL-019 a 022), para o componente que desenha as abas, as Estatísticas e a pergunta. */
export function useScriptRun(runner: QueryRunner): ScriptRun | null {
  return useSyncExternalStore(runner.script.subscribe, runner.script.getState);
}
