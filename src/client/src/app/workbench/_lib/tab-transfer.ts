import { tabTransferSchema, type TabTransfer } from "../../../../electron/window-messages";
import { isScriptDirty } from "./saved-scripts";
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
export type AdoptedTab = { tab: QueryTab; selection: SelectionMemory | null; state: RunnerState; memory: TransferMemory; resultWindowLost: boolean };

type TransferredResult = NonNullable<TabTransfer["result"]>;

/** As células marcadas de cada linha (cortadas, preenchidas pelo banco) como pares, e de volta. */
const pairsOf = (marks: ReadonlyMap<number, ReadonlySet<number>>): [number, number[]][] => [...marks].map(([row, cells]) => [row, [...cells]]);
const marksOf = (pairs: [number, number[]][]): Map<number, Set<number>> => new Map(pairs.map(([row, columns]) => [row, new Set(columns)]));

/** O resultado como vai: o estado parado, e as células cortadas como pares (o que passa pelo processo principal é dado puro). */
function resultOf(state: RunnerState): TransferredResult | null | undefined {
  switch (state.status) {
    case "idle":
      return null;
    case "running":
      return undefined;
    case "rows": {
      if (state.loadingMore || state.counting) return undefined;
      const { status, id, target, columns, rows, truncated, hasMore, totalRows, elapsedMs, pages, cursorClosed, total, resultId, readOnly, generated, sourceRows, filterApplied, read } = state;
      return {
        ...{ status, id, target, columns, rows, hasMore, totalRows, elapsedMs, pages, cursorClosed, total },
        ...(resultId === undefined ? {} : { resultId }),
        ...(readOnly === undefined ? {} : { readOnly }),
        // RN-GRADE-011: como o filtro do resultado entrou; o filtro viaja no `target`, e "Executar de novo" na outra janela o repete.
        ...(filterApplied === undefined || filterApplied === null ? {} : { filterApplied }),
        // RN-EXPORT-002: o "Exportar…" do resultado continua valendo na outra janela.
        ...(read === undefined || read === null ? {} : { read }),
        truncated: pairsOf(truncated),
        // RN-EDIT-009: as colunas que o banco preencheu nas linhas novas que a aba de consulta salvou.
        ...(generated === undefined || generated.size === 0 ? {} : { generated: pairsOf(generated) }),
        // RN-SQL-017: a linha do resultado na API de cada linha da grade, depois de um Salvar que tirou linhas.
        ...(sourceRows === undefined ? {} : { sourceRows: [...sourceRows] }),
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

  const { table, database, script, resultPlace } = tab;
  return {
    version: 1,
    tab: {
      id: tab.id,
      title: tab.title,
      connectionId: tab.connectionId,
      ...(database === undefined ? {} : { database }),
      sessionId,
      sql: editor?.sql ?? tab.sql,
      ...(table === undefined ? {} : { table }),
      ...(resultPlace === undefined ? {} : { resultPlace }),
      ...(script === undefined
        ? {}
        : {
            script: {
              id: script.id,
              name: script.name,
              savedSql: script.savedSql,
              ...(script.generic === true ? { generic: true as const } : {}),
              ...(script.savedConnectionId === undefined ? {} : { savedConnectionId: script.savedConnectionId }),
              ...(script.savedDatabase === undefined ? {} : { savedDatabase: script.savedDatabase }),
              ...(script.folderId === undefined ? {} : { folderId: script.folderId }),
            },
          }),
    },
    editor: editor === null ? null : { anchor: editor.anchor, head: editor.head },
    result,
    memory,
  };
}

function stateOf(result: TabTransfer["result"]): RunnerState {
  if (result === null) return { status: "idle" };
  if (result.status !== "rows") return result;

  const { truncated, generated, ...rest } = result;
  return { ...rest, truncated: marksOf(truncated), ...(generated === undefined ? {} : { generated: marksOf(generated) }), loadingMore: false, cancelling: false, counting: false };
}

/** Confere o que chegou e devolve a aba, ou `null` se não é uma aba (outra versão, um campo fora do formato): a janela não a abre. */
export function readTransfer(raw: unknown): AdoptedTab | null {
  const parsed = tabTransferSchema.safeParse(raw);
  if (!parsed.success) return null;

  const { tab, editor, result, memory, resultWindowLost } = parsed.data;
  const clamp = (position: number) => Math.min(position, tab.sql.length);
  // O tipo da aba é o da tela: o TypeScript confere que o schema do processo principal não divergiu dele.
  const adopted: QueryTab = {
    id: tab.id,
    title: tab.title,
    connectionId: tab.connectionId,
    ...(tab.database === undefined ? {} : { database: tab.database }),
    sessionId: tab.sessionId,
    sql: tab.sql,
    ...(tab.table === undefined ? {} : { table: tab.table }),
    // RN-ABAS-016: a aba chega no lugar do resultado que tinha, e não no da preferência desta janela.
    ...(tab.resultPlace === undefined ? {} : { resultPlace: tab.resultPlace }),
    // RN-SCRIPT-003: o ponto da faixa é o texto que chegou e o lugar da aba contra o que foi salvo (a aba pode ter trocado de conexão ou de banco).
    ...(tab.script === undefined ? {} : { script: { ...tab.script, dirty: isScriptDirty(tab.script, tab.sql, tab) } }),
  };
  const restored: TransferMemory = memory;

  return { tab: adopted, selection: editor === null ? null : { anchor: clamp(editor.anchor), head: clamp(editor.head) }, state: stateOf(result), memory: restored, resultWindowLost: resultWindowLost === true };
}
