import type { ColumnSizing } from "./grid-columns";
import type { PendingEdits } from "./record-edits";
import type { PaneLayout } from "./result-layout";
import type { StructureSection } from "./structure-sections";
import type { RecordsQuery } from "./table-sql";

/** O diagrama de uma aba: o zoom e onde a área estava rolada (RN-TABELA-004). */
export type DiagramMemory = { zoom: number; left: number; top: number };

/** A vista Registros de uma aba: o que está escrito no campo do filtro e o filtro e a ordem em vigor (RN-TABELA-005). */
export type RecordsMemory = { draft: string; query: RecordsQuery };

/**
 * A vista Estrutura de uma aba lembra a seção que a pessoa escolheu na lista lateral (RN-TABELA-009); a grade dos Registros, as larguras que a pessoa deu às
 * colunas (RN-GRADE-009).
 */
/** RN-EDIT-004: as pendências dos Registros e o resultado a que elas pertencem; trocar de vista e voltar não as perde. */
export type EditsMemory = { resultId: string; edits: PendingEdits };

/** RN-ABAS-002: a seleção do editor com que a aba chegou de outra janela; o editor a lê uma vez, ao nascer. */
export type SelectionMemory = { anchor: number; head: number };

type Slots = { layout: PaneLayout; diagram: DiagramMemory; records: RecordsMemory; structure: StructureSection; grid: ColumnSizing; edits: EditsMemory; selection: SelectionMemory };

/** O que passa com a aba para outra janela (RN-ABAS-002): tudo menos as alterações não salvas dos Registros, que não mudam de janela, e a seleção, que vem do editor. */
export type TransferMemory = Partial<Pick<Slots, "layout" | "diagram" | "records" | "structure" | "grid">>;

const transferSlots = ["layout", "diagram", "records", "structure", "grid"] as const satisfies readonly (keyof TransferMemory)[];

/**
 * O que a tela de cada aba lembra quando a vista que o guarda deixa de existir e volta: o tamanho da divisão e o recolhido ou maximizado da
 * consulta, o zoom e a rolagem do diagrama, o filtro e a ordem dos registros, as larguras das colunas da grade deles, e a seção da Estrutura. Quem some e
 * volta é a vista, não a aba: trocar
 * de vista desmonta a Estrutura, o Diagrama ou os Registros, e o bloqueio por inatividade (RN-SEG-001) troca o executor de todas as abas.
 *
 * A chave é o ID DA ABA (`QueryTab.id`), que não muda em nada disso: com o executor como chave (como já foi), o filtro e a ordem de uma aba cuja vista
 * Registros não estava montada no bloqueio, e o zoom de um diagrama que não estava na tela, se perdiam ao desbloquear. Só números e textos pequenos:
 * nada de valor de linha (as larguras levam o nome e o tipo das colunas, que dizem a que resultado elas valem).
 *
 * Quem sabe quais abas existem é o provedor da área de trabalho (`WorkbenchProvider`, que tem a lista), e é ele que chama `forgetExcept` a cada mudança dela:
 * a aba que fecha leva a memória dela, e nenhuma aba nova (o id é um UUID novo) herda a de outra.
 */
const memory = new Map<string, Partial<Slots>>();

export function recall<K extends keyof Slots>(tabId: string, slot: K): Slots[K] | undefined {
  return memory.get(tabId)?.[slot];
}

export function remember<K extends keyof Slots>(tabId: string, slot: K, value: Slots[K]): void {
  memory.set(tabId, { ...memory.get(tabId), [slot]: value });
}

/** Esquece o que as abas que não estão em `open` guardavam. */
export function forgetExcept(open: ReadonlySet<string>): void {
  for (const tabId of memory.keys()) if (!open.has(tabId)) memory.delete(tabId);
}

/** O que a aba leva para outra janela (RN-ABAS-002). */
export function recallForTransfer(tabId: string): TransferMemory {
  const slots = memory.get(tabId) ?? {};
  return Object.fromEntries(transferSlots.flatMap((slot) => (slots[slot] === undefined ? [] : [[slot, slots[slot]]])));
}

/** A aba chegou de outra janela: a tela dela nasce com o que lembrava lá. */
export function rememberTransferred(tabId: string, transferred: TransferMemory & { selection?: SelectionMemory }): void {
  memory.set(tabId, { ...memory.get(tabId), ...transferred });
}
