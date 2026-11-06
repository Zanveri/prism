import { dataExportCopy } from "../data-export/data-export.copy";
import type { DocumentFormat } from "../grid-export/document";
import { gridSelectionCopy } from "../grid-selection.copy";
import { recordsCopy } from "../records.copy";

import type { CopyAsCopy } from "./copy-as.copy";

const menu = gridSelectionCopy.menu;

const formatCount = (value: number) => value.toLocaleString("en");
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
const nameOf = (format: DocumentFormat) => dataExportCopy.formats.names[format];

export const copyAsCopyEn: CopyAsCopy = {
  menu: {
    submenu: menu.advanced,
    advanced: menu.advancedDialog,
    copyAs: (format: DocumentFormat) => menu.copyAs(nameOf(format)),
    configure: menu.configureCopyAs,
  },

  advanced: {
    title: "Advanced copy",
    format: "Format",
    formats: "Copy format",
    scope: "What to copy",
    scopes: { cells: "The chosen cells", rows: "The whole rows of the selection", loaded: "All loaded rows" },
    loadedHint: "Rows that have not been loaded yet are not included. For all of them, use Export data…",
    size: (rows: number, columns: number) => `${formatCount(rows)} ${plural(rows, "row", "rows")} and ${formatCount(columns)} ${plural(columns, "column", "columns")}`,
    wholeSize: (total: number | null, columns: number) => `${total === null ? "all rows" : `all ${formatCount(total)} ${plural(total, "row", "rows")}`} and ${formatCount(columns)} ${plural(columns, "column", "columns")}`,
    previewLoaded: "The preview only has the loaded rows; the copy loads the missing ones.",
    cancelLoading: "Cancel",
    options: "Options",
    preview: "Preview",
    previewCut: "In the preview, truncated values appear as in the grid; the copy carries the full ones.",
    previewEmpty: "The text comes out empty.",
    cancel: "Cancel",
    copy: "Copy",
    copying: "Copying…",
    fetching: "Fetching the full values…",
    cancelFetch: "Cancel the fetch",
  },

  configure: {
    title: "Configure 'Copy as' commands",
    formats: "'Copy as' formats",
    refusedSuffix: ", with a refused field",
    cancel: "Cancel",
    save: "Save",
    saved: "'Copy as' options saved.",
  },

  checkingTable: "Checking the table of this result…",

  notice: {
    duplicateColumn: (name: string) => `The result has two columns named ${name}: leave one out of the selection.`,
    copied: (rows: number, format: DocumentFormat) => `${formatCount(rows)} ${plural(rows, "row copied", "rows copied")} as ${nameOf(format)}.`,
    cutValues: (count: number) => `${formatCount(count)} ${plural(count, "value", "values")} cut to the maximum TXT width.`,
    removed: (count: number) => (count === 1 ? "1 character the format does not accept was removed." : `${formatCount(count)} characters the format does not accept were removed.`),
    skipped: (count: number) => (count === 1 ? "1 row not copied, commented out in the SQL: the comment says why." : `${formatCount(count)} rows not copied, commented out in the SQL: each one's comment says why.`),
    notWhole: (count: number) => (count === 1 ? "1 value could not come in full and was truncated." : `${formatCount(count)} values could not come in full and were truncated.`),
    noColumns: 'The chosen columns are all computed by the database and stay out of the INSERT: turn on "Include the columns the database computes" in the SQL options.',
    tooLarge: gridSelectionCopy.copy.tooLarge,
    failed: recordsCopy.edit.menu.notCopied,
  },
};
