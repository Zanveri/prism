import { formatCount } from "@/lib/utils/format";

import type { GridFilterCopy } from "./grid-filter.copy";

export const gridFilterCopyEn: GridFilterCopy = {
  menu: {
    filter: "Filter",
    label: "Filter",
    byValue: "Filter by value…",
    cellValue: "Cell value",
    custom: "Custom",
    clear: "Remove all filters and sorting",
    noValue: "(cell value)",
    typed: "…",
    unavailable: (reason: string) => `Does not apply: ${reason}.`,
  },

  reasons: {
    nullCell: "the cell is null",
    truncated: "the value came cut, and the screen does not have it whole",
    binary: "the column is binary",
    controls: "the value has a line break, a tab or another control character",
    informix: "Informix does not accept this value as a literal",
    informixOrder: "Informix does not sort boolean values",
    emptyLike: "the value is empty, and “contains” would match everything",
    textOnly: "only applies to a text column",
    newRow: "the new row is not in the database yet",
    busy: "a statement is running in the tab",
    several: "the field's filter has more than one statement",
    open: "the field's filter leaves quotes or a comment open",
    nothingToRemove: "there is no filter or order",
    noValues: "there are no values to choose",
  },

  values: {
    title: (column: string) => `Filter ${column} by value`,
    description: (rows: number, more: boolean) => `The distinct values of the ${formatCount(rows, "loaded row", "loaded rows")}${more ? ", without those not read yet" : ""}, from most to least frequent.`,
    search: "Search value",
    searchPlaceholder: "Search…",
    list: "Column values",
    nullValue: "NULL",
    emptyValue: "(empty)",
    count: (count: number) => count.toLocaleString("en"),
    countLabel: (count: number) => formatCount(count, "time", "times"),
    selectAll: "Check all",
    selectNone: "Uncheck all",
    noMatch: "No value has that text.",
    capped: (shown: number, total: number) => `Showing ${shown.toLocaleString("en")} of ${total.toLocaleString("en")} values. Use the search to find the others.`,
    unusable: (count: number) => (count === 1 ? "1 value does not go into the filter (cut or with a control character)." : `${count.toLocaleString("en")} values do not go into the filter (cut or with a control character).`),
    chosen: (count: number) => (count === 0 ? "No value checked." : formatCount(count, "value checked", "values checked") + "."),
    apply: "Filter",
    cancel: "Cancel",
  },

  custom: {
    label: (condition: string) => `Value for ${condition}`,
    hint: "Enter filters, Esc cancels. The value goes in as a database literal.",
    apply: "Filter",
    cancel: "Cancel",
    controls: "The value cannot have a tab or another control character.",
    informix: "Informix does not accept this value as a literal for this column.",
  },

  placeholder: "Enter a SQL expression to filter the results (use Ctrl+Space)",

  result: {
    label: "Result filter and order",
    hint: "What goes along with the statement: a condition, an order (ORDER BY) or both. The editor's text does not change.",
    wrapped: "the filter was applied outside the statement (SELECT * FROM (…)), and the result does not say which table each row comes from",
  },

  completion: {
    column: "column",
    keyword: "filter keyword",
  },
};
