import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { driverIdOf, driverNotInstalledCode } from "@/app/drivers/_lib/drivers.model";
import type { Engine } from "@/components/ui/engine-tag";
import type { useToast } from "@/components/ui/toast";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { allowRefusal, ApiRequestError, type ApiError, type ApiResult } from "@/lib/api/prism-api";

import { closeDatabaseSession, openDatabaseSession } from "./database-sessions.service";
import { queryOutcomeCopy } from "./query-outcome.copy";
import { sqlErrorDetails, type QueryColumn, type QueryPage, type QueryResult, type QueryRow } from "./query.schema";
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
export type RunTarget = { sql: string; offset: number; engine?: Engine };

export type RowsState = {
  status: "rows";
  /** Muda a cada execução, e não a cada página: é a chave da grade. */
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
  /** Só existe depois de "Contar total" (RN-SQL-006). */
  total: number | null;
  counting: boolean;
  /** RN-EDIT-002: o resultado da API a que estas linhas pertencem; é por ele que a edição dos Registros pergunta e grava. */
  resultId?: string | null;
  /** RN-EDIT-002: o motivo de o resultado inteiro ser só leitura, quando a página já o trouxe. */
  readOnly?: string | null;
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
   * aceitar o comando novo, e volta a ser o estado se ela não aceitar.
   */
  | { status: "running"; cancelling: boolean; previous: ResultState | null }
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

export type QueryRunner = {
  subscribe: (listener: () => void) => () => void;
  getState: () => RunnerState;
  run: (target: RunTarget) => Promise<void>;
  /** Executa de novo o comando das linhas que estão na tela, e nunca outro: é o que o aviso de cursor fechado oferece. */
  rerun: () => Promise<void>;
  cancel: () => Promise<void>;
  loadMore: () => Promise<void>;
  countTotal: () => Promise<void>;
  /**
   * O texto do editor mudou: a posição do erro era a do texto enviado. Desfaz a marca que estiver
   * na tela, e o erro do comando que ainda roda chega sem posição.
   */
  textEdited: () => void;
  /** A sessão da aba na API, ou nula antes da primeira execução e depois de solta: a edição dos Registros grava nela (seção 22). */
  sessionOf: () => string | null;
  /**
   * Solta a aba da sessão dela (fechar a aba, desconectar, conexão excluída) e devolve o que há
   * para encerrar na API. O que estava a caminho chega e não muda mais nada.
   */
  release: () => { sessionId: string | null; busy: boolean };
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
  connectionId: string;
  /** RN-ARVORE-006: outro banco do servidor da conexão, de onde a aba foi aberta; sem ele, o banco da conexão. */
  database?: string;
  queryClient: QueryClient;
  toast: ReturnType<typeof useToast>;
  /** A sessão da aba mudou: aberta na primeira execução, trocada quando cai, nula quando a API já não a tem. */
  onSession: (sessionId: string | null) => void;
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
export function createQueryRunner({ connectionId, database, queryClient, toast, onSession }: QueryRunnerOptions): QueryRunner {
  let state: RunnerState = { status: "idle" };
  const listeners = new Set<() => void>();

  let sessionId: string | null = null;
  /** Cresce quando a aba é solta: a resposta que chegar depois não acha mais quem a esperava. */
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
  function refuse(operation: "run" | "loadMore" | "countTotal"): void {
    if (refusedWhenRetired.has(operation)) return;

    refusedWhenRetired.add(operation);
    console.warn(`[prism] o executor de uma aba que já saiu de cena (bloqueio, aba fechada ou conexão removida) recusou "${operation}": o painel segurou o executor velho, e nada foi enviado ao banco.`);
  }
  let resultId = 0;
  /**
   * O usuário pediu o cancelamento do que está em andamento: o comando que ainda não foi enviado não sai, e não se pede duas vezes. O
   * desfecho do comando não é decidido por isto, e sim pelo `outcome` da API (RN-SQL-010, Ruling 135).
   */
  let cancelRequested = false;
  let truncationWarned = false;
  /** O texto mudou depois de o comando ser enviado: a posição que o banco apontar já não é a do texto na tela. */
  let editedSinceRun = false;
  /** Os erros inesperados que o aviso central já mostrou: a rede de segurança não avisa de novo. */
  const reported = new WeakSet<object>();

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
   * mostrar: a aba foi solta, ou o comando foi cancelado antes de ser enviado.
   */
  async function execute(sql: string, started: number): Promise<ApiResult<QueryResult> | null> {
    for (let reopened = false; ; reopened = true) {
      let id = sessionId;

      if (id === null) {
        const opened = await call(() => openDatabaseSession(connectionId, database));
        if (started !== epoch) {
          // A aba foi solta enquanto a sessão abria: ninguém mais a usaria nem a fecharia.
          if (opened.ok) void call(() => closeDatabaseSession(opened.data.id), codes("DATABASE_SESSION_NOT_FOUND")).catch(() => undefined);
          return null;
        }
        if (!opened.ok) return opened;

        id = opened.data.id;
        setSession(id);
        if (reopened) toast.warning(copy.sessionReopened);
        if (cancelRequested) {
          settle();
          return null;
        }
      }

      const session = id;
      const result = await call(
        () => executeQuery(session, sql),
        codes("SQL_EXECUTION_FAILED", "TRANSACTION_CONTROL_NOT_SUPPORTED", ...(reopened ? [] : ["DATABASE_SESSION_NOT_FOUND"])),
      );
      if (started !== epoch) return null;
      if (result.ok || result.error.code !== "DATABASE_SESSION_NOT_FOUND") return result;

      setSession(null);
      if (reopened || cancelRequested) return result;
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
   * Nos outros casos a API não aceitou comando nenhum, e `previous` continua na tela: o aviso diz
   * o que houve. Sem resultado na tela, a área de resultado mostra a frase da API para o controle
   * de transação (RN-SQL-003) e a mensagem do banco para a conexão que não abriu (seção 7).
   */
  function failed(error: ApiError, target: RunTarget, previous: ResultState | null): RunnerState {
    const message = error.detail ?? error.title;

    if (error.code === "SQL_EXECUTION_FAILED") {
      const outcome = cancelOutcomeOf(error);
      if (outcome === "canceled") {
        toast.warning(copy.commandCancelled);
        return { status: "cancelled" };
      }

      const { sqlState, position } = sqlErrorDetails(error.extensions);
      if (outcome === null) toast.error(copy.commandFailed);
      else toast.warning(outcomeCopy[outcome]);
      return { status: "error", source: "database", title: resultCopy.errorTitle, message, sqlState, errorAt: position === null || editedSinceRun ? null : target.offset + utf16IndexOf(target.sql, position) };
    }

    if (error.code === "TRANSACTION_CONTROL_NOT_SUPPORTED") {
      const executed = wasExecuted(error);
      if (previous !== null && !executed) {
        toast.error(error.title, error.detail ?? undefined);
        return previous;
      }
      toast.error(copy.commandFailed);
      return { status: "error", source: "api", title: error.title, message: error.detail, sqlState: null, errorAt: null, ...(executed ? { executed: true as const } : {}) };
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

  const run = (target: RunTarget) =>
    guarded(async () => {
      if (retired) return refuse("run");
      if (isBusy()) return;

      // RN-SQL-001: uma execução leva um comando só. O comando do cursor é sempre um; a seleção pode ter mais, ou nenhum.
      const statements = statementCount(target.sql, target.engine);
      const previous = resultOf(state);
      if (statements === 0) {
        toast.warning(copy.nothingToSend);
        return;
      }
      if (statements > 1) {
        // Nada foi enviado. Com um resultado na tela, ele e o cursor dele ficam: basta o aviso.
        if (previous === null) set({ status: "notice", message: resultCopy.tooManyStatements(statements) });
        toast.warning(copy.tooManyStatements);
        return;
      }

      const started = epoch;
      cancelRequested = false;
      editedSinceRun = false;
      set({ status: "running", cancelling: false, previous });

      const result = await execute(target.sql, started);
      if (result === null) return;
      // O que está na tela agora, e não o de quando o comando começou: uma edição no meio já tirou a posição de um erro.
      if (!result.ok) return set(failed(result.error, target, state.status === "running" ? state.previous : null));

      const data = result.data;
      if (data.kind === "affected") {
        set({ status: "affected", rowsAffected: data.rowsAffected, elapsedMs: data.elapsedMs });
        toast.success(copy.commandExecuted(data.rowsAffected));
        return;
      }

      truncationWarned = false;
      set({
        status: "rows",
        id: ++resultId,
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
        readOnly: data.readOnly ?? null,
      });
      // RN-SQL-013 e RN-AVISO-002: o comando gravou e está confirmado; as linhas são o que ele devolveu.
      if (data.totalRows !== null) toast.success(copy.commandCompleted(data.totalRows));
      warnTruncated(data);
    });

  const loadMore = () =>
    guarded(async () => {
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
      if (page.error.code === "DATABASE_SESSION_NOT_FOUND") setSession(null);
      if (page.error.code === "NO_OPEN_CURSOR" || page.error.code === "DATABASE_SESSION_NOT_FOUND") closeCursor();
      else if (page.error.code === "SQL_EXECUTION_FAILED") {
        // A leitura falhou ou foi cancelada: o comando morreu e a API fechou o cursor (o pedido seguinte já responderia 409
        // `NO_OPEN_CURSOR`), então as linhas ficam e a tela oferece executar de novo, em vez de um "Carregar mais" que não leva a nada.
        // O aviso é o da falha, que o aviso central já deu, ou o do desfecho do cancelamento.
        patchRows({ cursorClosed: true });
        warnOutcome(page.error);
      }
    });

  const countTotal = () =>
    guarded(async () => {
      // Só há o que contar quando há linhas que a tela não leu (RN-SQL-006): com o resultado inteiro
      // na tela, o total é o que está nela, e o comando que gravou já o trouxe (RN-SQL-013).
      if (retired) return refuse("countTotal");
      if (state.status !== "rows" || !state.hasMore || state.total !== null || sessionId === null || isBusy()) return;

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

      if (!counted.ok && counted.error.code === "DATABASE_SESSION_NOT_FOUND") setSession(null);
      if (!counted.ok) warnOutcome(counted.error);
      // Cancelar a contagem não mexe no resultado nem no cursor (RN-SQL-010); a que terminou antes mostra o total.
      patchRows({ counting: false, cancelling: false, total: counted.ok ? counted.data.total : null });
    });

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

    epoch++;
    sessionId = null;
    cancelRequested = false;
    settle();

    return released;
  }

  function retire() {
    const released = release();

    retired = true;
    truncationWarned = false;
    editedSinceRun = false;
    set({ status: "idle" });

    return released;
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,
    run,
    rerun: async () => {
      if (state.status === "rows") await run(state.target);
    },
    cancel,
    loadMore,
    countTotal,
    textEdited: () => {
      editedSinceRun = true;
      if (state.status === "error" && state.errorAt !== null) set({ ...state, errorAt: null });
      // O erro que está na tela enquanto outro comando roda também perde a posição: ela não pode voltar, velha, se ele for restaurado.
      else if (state.status === "running" && state.previous?.status === "error" && state.previous.errorAt !== null) set({ ...state, previous: { ...state.previous, errorAt: null } });
    },
    sessionOf: () => sessionId,
    release,
    retire,
  };
}

/** O estado do que a aba executa, para o componente que o desenha. */
export function useQueryRunner(runner: QueryRunner): RunnerState {
  return useSyncExternalStore(runner.subscribe, runner.getState);
}
