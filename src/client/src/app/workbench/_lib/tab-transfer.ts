import { tabTransferSchema, type TabTransfer } from "../../../../electron/window-messages";
import type { SelectionMemory, TransferMemory } from "./tab-memory";
import type { RunnerState } from "./use-query-runner";
import type { QueryTab } from "./workbench-model";

/**
 * A passagem de uma aba para outra janela (RN-ABAS-002 e 003), nos dois sentidos, sem React: `serializeTab` monta o que vai pelo processo principal,
 * e `readTransfer` confere o que chegou (o mesmo schema que o processo principal usa, `electron/window-messages.ts`) e devolve os tipos da tela.
 * Vai a aba como estava: o texto que está no editor, a seleção dele, o resultado na tela com o cursor que a sessão tem aberto, a sessão com o banco e o
 * que a tela da aba lembrava. Nada é executado de novo: quem recebe só mostra.
 */

/** O que a janela de origem sabe da aba no instante de mandá-la. */
export type TabSnapshot = {
  tab: QueryTab;
  /** A sessão que o executor da aba tem agora (a cópia em `tab.sessionId` pode estar atrasada). */
  sessionId: string | null;
  /** O texto e a seleção do editor, lidos dele agora; `null` na aba de uma tabela, que não tem editor. */
  editor: { sql: string; anchor: number; head: number } | null;
  state: RunnerState;
  memory: TransferMemory;
};

/** A aba como a janela que recebe a monta. */
export type AdoptedTab = { tab: QueryTab; selection: SelectionMemory | null; state: RunnerState; memory: TransferMemory };

type TransferredResult = NonNullable<TabTransfer["result"]>;

/** O resultado como vai: o estado parado, e as células cortadas como pares (o que passa pelo processo principal é dado puro). */
function resultOf(state: RunnerState): TransferredResult | null | undefined {
  switch (state.status) {
    case "idle":
      return null;
    case "running":
      return undefined;
    case "rows": {
      if (state.loadingMore || state.counting) return undefined;
      const { status, id, target, columns, rows, truncated, hasMore, totalRows, elapsedMs, pages, cursorClosed, total, resultId, readOnly } = state;
      return {
        ...{ status, id, target, columns, rows, hasMore, totalRows, elapsedMs, pages, cursorClosed, total },
        ...(resultId === undefined ? {} : { resultId }),
        ...(readOnly === undefined ? {} : { readOnly }),
        truncated: [...truncated].map(([row, cells]) => [row, [...cells]]),
      };
    }
    default:
      return state;
  }
}

/**
 * O que vai para a outra janela, ou `null` quando a aba não pode ir: há comando em andamento nela (executar, carregar mais, contar). A resposta dele
 * chegaria à janela que a aba deixou, e o executor de lá já saiu de cena; quem chama pede para esperar ou cancelar.
 */
export function serializeTab({ tab, sessionId, editor, state, memory }: TabSnapshot): TabTransfer | null {
  const result = resultOf(state);
  if (result === undefined) return null;

  const { table, database } = tab;
  return {
    version: 1,
    tab: { id: tab.id, title: tab.title, connectionId: tab.connectionId, ...(database === undefined ? {} : { database }), sessionId, sql: editor?.sql ?? tab.sql, ...(table === undefined ? {} : { table }) },
    editor: editor === null ? null : { anchor: editor.anchor, head: editor.head },
    result,
    memory,
  };
}

function stateOf(result: TabTransfer["result"]): RunnerState {
  if (result === null) return { status: "idle" };
  if (result.status !== "rows") return result;

  const { truncated, ...rest } = result;
  return { ...rest, truncated: new Map(truncated.map(([row, columns]) => [row, new Set(columns)])), loadingMore: false, cancelling: false, counting: false };
}

/** Confere o que chegou e devolve a aba, ou `null` se não é uma aba (outra versão, um campo fora do formato): a janela não a abre. */
export function readTransfer(raw: unknown): AdoptedTab | null {
  const parsed = tabTransferSchema.safeParse(raw);
  if (!parsed.success) return null;

  const { tab, editor, result, memory } = parsed.data;
  const clamp = (position: number) => Math.min(position, tab.sql.length);
  // O tipo da aba é o da tela: o TypeScript confere que o schema do processo principal não divergiu dele.
  const adopted: QueryTab = { id: tab.id, title: tab.title, connectionId: tab.connectionId, ...(tab.database === undefined ? {} : { database: tab.database }), sessionId: tab.sessionId, sql: tab.sql, ...(tab.table === undefined ? {} : { table: tab.table }) };
  const restored: TransferMemory = memory;

  return { tab: adopted, selection: editor === null ? null : { anchor: clamp(editor.anchor), head: clamp(editor.head) }, state: stateOf(result), memory: restored };
}
