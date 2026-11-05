import type { Engine } from "@/components/ui/engine-tag";

import type { ColumnRead } from "./column-types";
import { cellValue, type VariableQueryColumn } from "./query-value";
import type { Random } from "./random";
import { refuse, type Value } from "./values";
import { phrase } from "./variables.copy";

/*
 * O `random.of` (RN-VAR-010), na parte pura: as posições sorteadas entre os valores da coluna e o valor de cada uma. Quem pede à API o total e o valor de cada
 * posição (a rota dos valores, RN-VAR-035) é o executor da aba, na sessão dela e na vez da declaração.
 */

/** A maior posição que a rota dos valores alcança (`offset` até 1.000.000, RN-VAR-035). */
export const sampleReach = 1_000_001;

/**
 * As posições de `count` valores diferentes entre `total` (uma só com `count` nulo): cada uma é o `random.int` sobre as posições, e a que já saiu é sorteada de novo.
 * Lança a frase quando a coluna não tem valores ou tem menos que os pedidos.
 */
export function samplePositions(written: string, total: number, count: number | null, random: Random): number[] {
  if (total === 0) throw refuse(phrase.sampleEmpty(written));
  const wanted = count ?? 1;
  if (total < wanted) throw refuse(phrase.sampleTooFew(written, total));
  // ponytail: a coluna com mais de 1.000.001 valores sorteia só entre os primeiros, que a rota alcança; uma rota de amostra no banco sortearia entre todos.
  const reach = Math.min(total, sampleReach);
  const positions = new Set<number>();
  while (positions.size < wanted) positions.add(random.int(0, reach - 1));
  return [...positions];
}

/** O valor de uma posição, pelo tipo da coluna (RN-VAR-004): o número, a data de dia ou de instante, o booleano ou o texto. O valor que a API cortou (RN-SQL-011) é recusado. */
export function sampleValue(written: string, entry: { value: string; truncated: boolean }, read: Extract<ColumnRead, { ok: true }>, engine: Engine | undefined): Value {
  if (entry.truncated) throw refuse(phrase.sampleTruncated(written));
  const kind: VariableQueryColumn["kind"] = read.kind === "number" ? "number" : read.kind === "boolean" ? "boolean" : read.kind === "string" ? "text" : "datetime";
  return cellValue(entry.value, { name: read.column, type: read.kind === "day" ? "date" : read.dbType, kind }, engine);
}
