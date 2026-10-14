import type { Engine } from "@/components/ui/engine-tag";

import type { CellMenuGroup, CellMenuItem } from "./cell-menu";
import { compareOperators, customCondition, customFilterOptions, joinFilter, valueFilterOptions, valuesCondition, type CompareOperator, type DistinctValue, type JoinedFilter, type ValueFilterId } from "./grid-export/value-filter";
import { gridFilterCopy } from "./grid-filter.copy";
import type { QueryColumn } from "./query.schema";

const copy = gridFilterCopy.menu;
const reasons = gridFilterCopy.reasons;

/** As ações do submenu "Filtrar": o diálogo dos valores, uma condição do valor da célula, uma do personalizado (pede o valor) e remover tudo. */
export type FilterAction = "filter:byValue" | `filter:cell:${ValueFilterId}` | `filter:custom:${CompareOperator}` | "filter:clear";

/** A célula do menu, para o "Filtrar": a lida, com o valor LIDO do banco (a pendência não está lá) e se chegou cortada; ou a linha nova, que não tem valor no banco. */
export type FilterCell = { kind: "read"; value: string | null; truncated: boolean } | { kind: "new" };

/** O que o "Filtrar" sabe da grade e do campo de filtro dela, nos Registros e no resultado da aba de consulta. */
export type FilterMenuContext = {
  engine: Engine;
  column: QueryColumn;
  cell: FilterCell;
  /** O texto do campo de filtro agora (digitado ou aplicado): é a ele que a condição se junta. */
  field: string;
  /** Há filtro ou ordem, em vigor ou só no campo: "Remover todos os filtros e ordenações" vale. */
  removable: boolean;
  /** Há algo em andamento na aba: o executor recusaria o comando. */
  busy: boolean;
};

/** O que fazer com a escolha: juntar o texto ao campo e executar, abrir o diálogo dos valores, pedir o valor do personalizado ou limpar tudo. */
export type FilterPlan = { kind: "apply"; text: string } | { kind: "values" } | { kind: "custom"; operator: CompareOperator } | { kind: "clear" };

const off = (reason: string) => ({ disabled: true, hint: copy.unavailable(reason) });

/** Por que nada se junta ao campo agora: a aba ocupada, ou o campo que não aceita uma condição a mais com segurança (`joinFilter`). */
function blockedOf(context: FilterMenuContext): string | null {
  if (context.busy) return reasons.busy;
  const probe = joinFilter(context.engine, context.field, "1 = 1");
  return "problem" in probe ? (probe.problem === "several" ? reasons.several : reasons.open) : null;
}

/**
 * O item "Filtrar" (F11) do menu da célula e o submenu dele (RN-GRADE-013): "Filtrar por valor…" (Ctrl+F11); o grupo
 * "Valor da célula" (`=`, `<>`, `>`, `<`, em coluna de texto também `LIKE`, e os de nulo), com a condição como rótulo; o grupo "Personalizado" (`= …`,
 * `<> …`, `> …`, `< …`, que pedem o valor); e "Remover todos os filtros e ordenações". O que não se aplica vem desabilitado, com o motivo embaixo do
 * rótulo: a célula nula, cortada ou binária (só os de nulo e o personalizado), a linha nova (que não está no banco), a aba ocupada e o campo em que a
 * condição não se junta com segurança.
 */
export function filterMenuItem(context: FilterMenuContext): CellMenuItem {
  const blocked = blockedOf(context);
  const { engine, column, cell } = context;
  const fromCell = valueFilterOptions(engine, column, cell.kind === "read" ? cell.value : null, cell.kind === "read" && cell.truncated);
  // Os de nulo não dependem do valor da célula: valem também na linha nova.
  const cellReason = (option: (typeof fromCell)[number]) => (cell.kind === "new" && option.id !== "isNull" && option.id !== "isNotNull" ? reasons.newRow : null) ?? (option.condition === null ? option.reason : null);

  const cellItems: CellMenuItem[] = fromCell
    .filter((option) => option.id !== "like" || column.kind === "text")
    .map((option) => {
      const reason = blocked ?? cellReason(option);
      return { id: `filter:cell:${option.id}` as FilterAction, label: option.label, ...(reason === null ? { disabled: false } : off(reason)) };
    });

  const customItems: CellMenuItem[] = customFilterOptions(engine, column).map((option) => {
    const reason = blocked ?? option.reason;
    return { id: `filter:custom:${option.id}` as FilterAction, label: option.label, ...(reason === null ? { disabled: false } : off(reason)) };
  });

  const byValueReason = blocked ?? (column.kind === "binary" ? reasons.binary : null);
  const clearReason = context.busy ? reasons.busy : context.removable ? null : reasons.nothingToRemove;
  const groups: CellMenuGroup[] = [
    [{ id: "filter:byValue", label: copy.byValue, shortcut: "Ctrl+F11", ...(byValueReason === null ? { disabled: false } : off(byValueReason)) }],
    { label: copy.cellValue, items: cellItems },
    { label: copy.custom, items: customItems },
    [{ id: "filter:clear", label: copy.clear, ...(clearReason === null ? { disabled: false } : off(clearReason)) }],
  ];

  return { id: "filter", label: copy.filter, shortcut: "F11", disabled: false, submenu: { label: copy.label, groups } };
}

/** A ação é do "Filtrar"? */
export function isFilterAction(action: string): action is FilterAction {
  return action.startsWith("filter:");
}

/**
 * O que a escolha faz. A condição do valor da célula junta ao campo (`joinFilter`) e executa; o personalizado pede o valor; "Filtrar por valor…" abre o
 * diálogo; "Remover todos" limpa. `null` quando a escolha não se aplica mais (o menu é de antes: a aba ficou ocupada, o campo mudou).
 */
export function filterPlan(context: FilterMenuContext, action: FilterAction): FilterPlan | null {
  if (action === "filter:clear") return context.busy || !context.removable ? null : { kind: "clear" };
  if (blockedOf(context) !== null) return null;
  if (action === "filter:byValue") return context.column.kind === "binary" ? null : { kind: "values" };

  const [, group, id] = action.split(":");
  if (group === "custom") return compareOperators.includes(id as CompareOperator) ? { kind: "custom", operator: id as CompareOperator } : null;

  const { engine, column, cell } = context;
  if (cell.kind === "new" && id !== "isNull" && id !== "isNotNull") return null;
  const option = valueFilterOptions(engine, column, cell.kind === "read" ? cell.value : null, cell.kind === "read" && cell.truncated).find((candidate) => candidate.id === id);
  return option?.condition == null ? null : applyOf(joinFilter(engine, context.field, option.condition));
}

const applyOf = (joined: JoinedFilter): FilterPlan | null => ("text" in joined ? { kind: "apply", text: joined.text } : null);

/** O "Personalizado" com o valor escrito: o texto novo do campo, ou o problema do valor (que o campo pequeno mostra). */
export function customPlan(context: FilterMenuContext, operator: CompareOperator, typed: string): FilterPlan | { problem: string } | null {
  const result = customCondition(context.engine, context.column, operator, typed);
  if ("problem" in result) return { problem: result.problem === "controls" ? gridFilterCopy.custom.controls : gridFilterCopy.custom.informix };
  return blockedOf(context) === null ? applyOf(joinFilter(context.engine, context.field, result.condition)) : null;
}

/** Quantos valores o diálogo "Filtrar por valor…" desenha de uma vez: o resto se acha pela busca. */
export const valueListCap = 500;

/**
 * Os valores que o diálogo "Filtrar por valor…" mostra para a busca dada: os que contêm o texto (sem diferença de maiúsculas; o nulo se acha por "null"),
 * na ordem da lista (a das quantidades), no máximo `valueListCap`, com a posição de cada um na lista inteira (é por ela que a marca fica) e quantos casaram.
 */
export function visibleValues(values: readonly DistinctValue[], search: string): { entries: { index: number; value: DistinctValue }[]; total: number } {
  const wanted = search.trim().toLocaleLowerCase("pt-BR");
  const matches = values.flatMap((value, index) => (wanted === "" || (value.value ?? gridFilterCopy.values.nullValue).toLocaleLowerCase("pt-BR").includes(wanted) ? [{ index, value }] : []));
  return { entries: matches.slice(0, valueListCap), total: matches.length };
}

/** Os valores marcados no "Filtrar por valor…": o texto novo do campo, ou nada (nenhum valor marcado, o campo mudou). */
export function valuesPlan(context: FilterMenuContext, chosen: readonly (string | null)[]): FilterPlan | null {
  const condition = valuesCondition(context.engine, context.column, chosen);
  return condition === null || blockedOf(context) !== null ? null : applyOf(joinFilter(context.engine, context.field, condition));
}
