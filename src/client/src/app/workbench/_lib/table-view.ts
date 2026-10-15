import type { Engine } from "@/components/ui/engine-tag";

import type { FilterRequest } from "./filter-handoff";
import { nextSort, orderOf, recordsRunPlan, sortOf, withOrder, type RecordsRunPlan } from "./table-sql";
import { isPersonBusy, type RunnerState } from "./use-query-runner";
import type { TableView } from "./workbench-model";

/**
 * As vistas que a aba de uma tabela oferece, na ordem do seletor (RN-TABELA-001). O seletor só
 * aparece com mais de uma, e um pedido de vista que a aba não tem (`openTableTab` com `view`) cai
 * nos registros.
 */
export const tableViews: readonly TableView[] = ["data", "structure", "diagram"];

/** A vista que a aba mostra para o que foi pedido. */
export function viewOf(requested: TableView, views: readonly TableView[] = tableViews): TableView {
  return views.includes(requested) ? requested : "data";
}

/** Para onde a lista de abas corre, e então quais setas a movem: numa fileira, as da horizontal; numa coluna, as da vertical (`aria-orientation`). */
export type TabOrientation = "horizontal" | "vertical";

/**
 * Setas movem entre as abas de uma lista (as vistas da tabela, as seções da Estrutura), com a volta nas pontas; Home e End vão à primeira e à
 * última. Só as setas da orientação da lista contam: numa fileira (o padrão) são esquerda e direita, numa coluna são cima e baixo. `null` para
 * outra tecla, ou para uma aba que a lista não tem.
 */
export function tabForKey<T>(tabs: readonly T[], current: T, key: string, orientation: TabOrientation = "horizontal"): T | null {
  const index = tabs.indexOf(current);
  if (index < 0) return null;

  const [previous, next] = orientation === "horizontal" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  if (key === next) return tabs[(index + 1) % tabs.length];
  if (key === previous) return tabs[(index - 1 + tabs.length) % tabs.length];
  if (key === "Home") return tabs[0];
  if (key === "End") return tabs[tabs.length - 1];
  return null;
}

/** Em que condições a aba de uma tabela está: o banco da conexão, se está à vista e se a pessoa desconectou a conexão. */
export type FirstRunContext = {
  /** O banco da conexão. Sem ele não se sabe escrever o nome da tabela. */
  engine: Engine | undefined;
  /**
   * A aba está À VISTA: é a ativa, e a área de trabalho é a tela mostrada (e não está escondida por baixo de Configurações, Conexões ou
   * Drivers). Uma aba escondida espera ser aberta.
   */
  visible: boolean;
  /** A pessoa desconectou a conexão e ainda não a reconectou (`connection-intent.ts`). */
  disconnected: boolean;
};

/**
 * A vista Registros executa o `SELECT` sozinha quando a aba nunca executou nada (RN-TABELA-002), e só então: um erro, um
 * cancelamento, o comando em andamento e as linhas que estão na tela ficam como estão, e quem os refaz é "Atualizar".
 *
 * Só com a aba à vista (RN-SEG-001): ao desbloquear, cada aba ganha um executor novo, e dez abas abertas não são dez sessões e dez
 * consultas de uma vez. A que está à vista recarrega sozinha, e as escondidas esperam ser abertas, também na primeira carga. E nunca
 * sobre uma conexão que a pessoa desconectou: nada reconecta sem um clique, e o clique é "Atualizar".
 */
export function needsFirstRun(state: RunnerState, { engine, visible, disconnected }: FirstRunContext): boolean {
  return engine !== undefined && visible && !disconnected && state.status === "idle";
}

/** O que a vista Registros sabe na hora de levar ao campo o filtro que outra aba pediu. */
export type HandoffContext = {
  /** A aba está À VISTA (a ativa, com a área de trabalho na tela). */
  visible: boolean;
  /**
   * Há algo da pessoa em andamento na aba (comando, "carregar mais" ou contagem): o executor recusaria outro comando (RN-SESSAO-002). A execução da
   * atualização automática não conta: o comando da pessoa toma o lugar dela (`isPersonBusy`, RN-GRADE-014).
   */
  busy: boolean;
  /** A pessoa desconectou a conexão e ainda não a reconectou: nada é enviado sem o clique em "Atualizar" (RN-SESSAO-004). */
  disconnected: boolean;
  /** RN-EDIT-007: a aba tem alterações não salvas; o pedido espera a resposta da pergunta (Salvar, Descartar ou Cancelar). */
  unsaved?: boolean;
};

/**
 * O filtro que outra aba pediu para esta tabela (RN-TABELA-007) e que a vista leva AGORA ao campo, ou `null`. Só o pedido que ela ainda não levou (`taken` é o
 * id do último que levou); só com a aba à vista (a escondida espera ser aberta, também ao desbloquear: RN-SEG-001); e só quando o comando com ele vai de fato ser
 * enviado, porque a tela só mostra como aplicado o filtro do comando que foi enviado (RN-TABELA-005). Por isso o pedido espera com algo em andamento na aba (o
 * executor recusaria o comando, RN-SESSAO-002) e com a conexão desconectada pela pessoa (nada reconecta sem o clique em "Atualizar", RN-SESSAO-004): nos dois casos
 * o campo e o comando à vista ficam como estavam. O pedido que espera fica na passagem e é levado quando a aba se livra do que roda, ou quando a pessoa reconecta
 * (a passagem o apaga sozinha se isso demorar mais que o prazo dela).
 */
export function handoffToTake(request: FilterRequest | null, taken: number | null, { visible, busy, disconnected, unsaved = false }: HandoffContext): FilterRequest | null {
  return request !== null && request.id !== taken && visible && !busy && !disconnected && !unsaved ? request : null;
}

/**
 * O que se faz depois que o pedido foi levado ao campo: `clearId` é o pedido a apagar da passagem (já foi atendido), ou `null` se não há o que apagar; `execute`, se a
 * consulta se refaz. Sem resultado nenhum (aba nova), quem executa é a primeira carga, que já sai com o filtro; com resultado na tela (a aba já existia), é este pedido que
 * refaz a consulta. Um pedido só é levado com a conexão de pé (`handoffToTake`): aqui não há conexão desconectada a considerar.
 */
export function afterHandoff(request: FilterRequest | null, taken: number | null, { state }: { state: RunnerState }): { clearId: number | null; execute: boolean } {
  if (request === null || request.id !== taken) return { clearId: null, execute: false };
  return { clearId: request.id, execute: state.status !== "idle" };
}

/*
 * As decisões acima, aplicadas: o que a vista Registros FAZ com cada uma, sem React e com as peças injetadas (no molde de `submitPasswordChange` e de
 * `lock-vault.ts`). O componente só entrega o que tem (o estado do executor, os `setState`, o `execute`); o que se faz, e em que ordem, está aqui e tem teste. Sem
 * isto, tirar um ramo no componente (a aba ocupada, os vários comandos) não reprovava teste nenhum, e a tela voltava a mostrar um filtro ou uma ordem não enviados.
 */

/** As peças de `applyRunPlan`: o `setState` do aviso do campo, o do filtro em vigor, e o pedido ao executor. */
export type RunPlanDeps = {
  /** Diz, no campo do filtro, o que ele tem de errado; `null` tira o aviso. */
  setProblem: (problem: "severalStatements" | null) => void;
  /** Registra o filtro (a condição, a ordem ou as duas) como o em vigor: o comando à vista e a seta do cabeçalho passam a ser os dele. */
  setFilter: (filter: string) => void;
  /** Pede ao executor o comando do filtro. */
  execute: (filter: string) => void;
};

/** As peças do que mexe também no texto do campo: o clique no cabeçalho e "Limpar". */
export type FieldDeps = RunPlanDeps & { setDraft: (text: string) => void };

/** A tabela dos registros e o banco dela, que diz como ler o texto do filtro. */
type RecordsTable = { engine: Engine; schema: string; name: string };

/**
 * O que a vista faz com o plano (`recordsRunPlan`, RN-TABELA-005): enviar é registrar o filtro como o em vigor e pedi-lo ao executor; a aba ocupada não muda
 * nada (o executor recusaria o comando, e a seta, o comando à vista e o filtro em vigor ficam como estavam); vários comandos, só o aviso no campo.
 */
export function applyRunPlan(plan: RecordsRunPlan, deps: RunPlanDeps): void {
  if (plan.kind === "busy") return;
  if (plan.kind === "several") return deps.setProblem("severalStatements");

  deps.setFilter(plan.filter);
  deps.execute(plan.filter);
}

/**
 * "Aplicar" e "Atualizar": do estado do executor (ocupado ou não) até o comando. Ocupado é o comando da pessoa (`isPersonBusy`): com a execução da
 * atualização automática em andamento o comando vai, e o executor o põe no lugar dela (RN-GRADE-014).
 */
export function runRecords({ engine, schema, name }: RecordsTable, next: string, state: RunnerState, deps: RunPlanDeps): void {
  applyRunPlan(recordsRunPlan(engine, schema, name, next, isPersonBusy(state)), deps);
}

/**
 * O clique no cabeçalho de uma coluna (RN-TABELA-010). O ciclo é o da ordem APLICADA, a que a seta mostra (`sortOf` sobre o filtro em vigor: crescente,
 * decrescente, sem ordem; outra coluna, ou uma ordem que não é de uma coluna só, começa do crescente), e o `ORDER BY` é escrito, trocado ou tirado no texto do
 * CAMPO (`withOrder`), que é enviado inteiro: a condição digitada e ainda não aplicada vai junto, e a ordem que a pessoa digitou é trocada. O campo só passa a
 * mostrar o texto novo quando ele é de fato enviado: com a aba ocupada nada muda, e com mais de um comando só o aviso aparece.
 */
export function sortRecords(table: RecordsTable, { draft, filter, column, columns }: { draft: string; filter: string; column: string; columns: readonly { name: string }[] }, state: RunnerState, deps: FieldDeps): void {
  const next = nextSort(sortOf(filter, columns, table.engine), column);
  const plan = recordsRunPlan(table.engine, table.schema, table.name, withOrder(draft, next, table.engine), isPersonBusy(state));

  if (plan.kind === "send") {
    deps.setDraft(plan.filter);
    deps.setProblem(null);
  }
  applyRunPlan(plan, deps);
}

/**
 * O "Filtrar" do menu da célula (RN-GRADE-013): `text` é o campo com a condição já junta (`joinFilter`), e é enviado inteiro,
 * como o "Aplicar". Como no clique do cabeçalho, o campo só passa a mostrar o texto novo quando ele é de fato enviado: com a aba ocupada nada muda, e com
 * mais de um comando só o aviso aparece.
 */
export function filterRecords(table: RecordsTable, text: string, state: RunnerState, deps: FieldDeps): void {
  const plan = recordsRunPlan(table.engine, table.schema, table.name, text, isPersonBusy(state));

  if (plan.kind === "send") {
    deps.setDraft(plan.filter);
    deps.setProblem(null);
  }
  applyRunPlan(plan, deps);
}

/** "Limpar" vale sempre que há filtro ou ordem, em vigor ou só digitados (RN-TABELA-010): a ordem do cabeçalho mora no texto, e conta. */
export function canClear(draft: string, filter: string): boolean {
  return draft !== "" || filter !== "";
}

/**
 * "Limpar" (RN-TABELA-010): esvazia o campo, com o aviso dele, e, havendo filtro ou ordem em vigor, executa o `SELECT` puro, que passa a ser o que vale. Só
 * digitado, nada é enviado. Com algo em andamento na aba o campo esvazia e o que vale continua valendo (o executor recusaria o comando): o botão segue
 * habilitado, e o clique seguinte, com a aba livre, limpa. Sem o banco da conexão (a lista de conexões ainda não chegou) também: não há como montar o comando.
 */
export function clearRecords({ engine, schema, name }: { engine: Engine | undefined; schema: string; name: string }, filter: string, state: RunnerState, deps: FieldDeps): void {
  deps.setDraft("");
  deps.setProblem(null);
  if (filter !== "" && engine !== undefined) runRecords({ engine, schema, name }, "", state, deps);
}

/** As peças de `takeHandoff`: os `setState` do pedido levado, do texto do campo, do aviso do campo e do filtro em vigor. */
export type TakeHandoffDeps = {
  setApplied: (id: number) => void;
  setDraft: (text: string) => void;
  setProblem: (problem: null) => void;
  setFilter: (filter: string) => void;
};

/**
 * Leva ao campo o filtro que outra aba pediu, se é hora (`handoffToTake`): o pedido fica marcado como levado, e a condição pedida troca a que estava em vigor,
 * mantendo a ordem de fora (`orderOf`), no campo (sem aviso de erro) e no filtro em vigor. Chamado na renderização (o campo e o comando já saem com ele). Recebe
 * o ESTADO do executor, e não um "ocupado" já calculado: é daqui que sai se a aba está ocupada. Sem o banco da conexão o texto é lido como PostgreSQL.
 */
export function takeHandoff(request: FilterRequest | null, taken: number | null, { visible, disconnected, state, filter, engine, unsaved = false }: { visible: boolean; disconnected: boolean; state: RunnerState; filter: string; engine: Engine | undefined; unsaved?: boolean }, deps: TakeHandoffDeps): void {
  const taking = handoffToTake(request, taken, { visible, busy: isPersonBusy(state), disconnected, unsaved });
  if (taking === null) return;

  const text = [taking.where, orderOf(filter, engine)].filter((part) => part !== "").join(" ");
  deps.setApplied(taking.id);
  deps.setDraft(text);
  deps.setProblem(null);
  deps.setFilter(text);
}

/** Depois de levar o pedido ao campo (`afterHandoff`): apaga-o da passagem e, se a aba já tinha resultado, refaz a consulta. */
export function settleHandoff(request: FilterRequest | null, taken: number | null, state: RunnerState, deps: { clear: (id: number) => void; execute: () => void }): void {
  const after = afterHandoff(request, taken, { state });
  if (after.clearId === null) return;

  deps.clear(after.clearId);
  if (after.execute) deps.execute();
}

/**
 * O que a área de resultado da vista Registros diz enquanto não há resultado nenhum (`idle`): `waiting` é "Carregando…" (a primeira carga está para começar: o banco da
 * conexão ainda não chegou, ou a aba ainda vai executar) e `disconnected`, que a pessoa desconectou a conexão e nada foi carregado ("Atualizar" conecta e carrega). Com
 * resultado, de qualquer tipo, nenhum dos dois. Sem o banco da conexão `waiting` prevalece, e a área já o prefere.
 */
export function idleNotice(state: RunnerState, { engine, disconnected }: { engine: Engine | undefined; disconnected: boolean }): { waiting: boolean; disconnected: boolean } {
  const idle = state.status === "idle";
  return { waiting: idle && (engine === undefined || !disconnected), disconnected: idle && disconnected };
}
