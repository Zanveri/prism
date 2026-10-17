import type { TrackedExport } from "../data-export/transfer-tracker";
import type { LoadKind, TrackedLoad } from "./load-tracker";

/**
 * As transferências desta janela na barra de status, juntas (RN-EXPORT-021 e RN-IMPORT-019): as exportações e as importações e cópias, na ordem em que
 * começaram (`seq`, um número só para todas). A barra mostra uma: a que pede ação (a entrega que falhou, a importação ou a cópia que parou e espera "Ver o
 * erro"), a mais antiga delas; sem nenhuma, a mais antiga. O botão ao lado diz quantas são as outras e de que tipo.
 */

export type BarEntry = { kind: "export"; seq: number; entry: TrackedExport } | { kind: LoadKind; seq: number; entry: TrackedLoad };

export function barEntries(exports: readonly TrackedExport[], loads: readonly TrackedLoad[]): BarEntry[] {
  const all: BarEntry[] = [...exports.map((entry): BarEntry => ({ kind: "export", seq: entry.seq, entry })), ...loads.map((entry): BarEntry => ({ kind: entry.kind, seq: entry.seq, entry }))];
  return all.sort((left, right) => left.seq - right.seq);
}

const asksAction = (bar: BarEntry) => (bar.kind === "export" ? bar.entry.stage === "deliveryFailed" : bar.entry.stage === "failed");

/** A que aparece na barra: a mais antiga das que pedem ação; sem nenhuma, a mais antiga (a lista vem na ordem de `barEntries`). */
export function featuredBarEntry(entries: readonly BarEntry[]): BarEntry | null {
  return entries.find(asksAction) ?? entries[0] ?? null;
}

/** O tipo das outras, para o botão: "+2 exportações", "+2 importações", "+2 cópias" quando são todas de um tipo, e "+2 transferências" misturadas. */
export function othersKind(others: readonly BarEntry[]): "export" | "import" | "copy" | "mixed" {
  const kinds = new Set(others.map((bar) => bar.kind));
  return kinds.size === 1 ? [...kinds][0] : "mixed";
}

/** A chave da linha na lista: o id do trabalho, que a API dá único. */
export const barKey = (bar: BarEntry) => bar.entry.id;
