import { dataExportCopy } from "../data-export/data-export.copy";
import type { DocumentFormat } from "../grid-export/document";
import { gridSelectionCopy } from "../grid-selection.copy";
import { recordsCopy } from "../records.copy";

import type { CopyAsCopy } from "./copy-as.copy";

const menu = gridSelectionCopy.menu;

const formatCount = (value: number) => value.toLocaleString("es");
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
const nameOf = (format: DocumentFormat) => dataExportCopy.formats.names[format];

export const copyAsCopyEs: CopyAsCopy = {
  menu: {
    submenu: menu.advanced,
    advanced: menu.advancedDialog,
    copyAs: (format: DocumentFormat) => menu.copyAs(nameOf(format)),
    configure: menu.configureCopyAs,
  },

  advanced: {
    title: "Copia avanzada",
    format: "Formato",
    formats: "Formato de la copia",
    scope: "Qué copiar",
    scopes: { cells: "Las celdas elegidas", rows: "Las filas completas de la selección", loaded: "Todas las filas cargadas" },
    loadedHint: "Las filas que aún no se han cargado no entran. Para todas, usa Exportar datos…",
    size: (rows: number, columns: number) => `${formatCount(rows)} ${plural(rows, "fila", "filas")} y ${formatCount(columns)} ${plural(columns, "columna", "columnas")}`,
    wholeSize: (total: number | null, columns: number) => `${total === null ? "todas las filas" : `todas las ${formatCount(total)} ${plural(total, "fila", "filas")}`} y ${formatCount(columns)} ${plural(columns, "columna", "columnas")}`,
    previewLoaded: "En la vista previa, solo las filas cargadas; la copia carga las que faltan.",
    cancelLoading: "Cancelar",
    options: "Opciones",
    preview: "Vista previa",
    previewCut: "En la vista previa, los valores cortados aparecen como en la cuadrícula; la copia lleva los completos.",
    previewEmpty: "El texto sale vacío.",
    cancel: "Cancelar",
    copy: "Copiar",
    copying: "Copiando…",
    fetching: "Obteniendo los valores completos…",
    cancelFetch: "Cancelar la obtención",
  },

  configure: {
    title: "Configurar comandos 'Copiar como'",
    formats: "Formatos de 'Copiar como'",
    refusedSuffix: ", con un campo rechazado",
    cancel: "Cancelar",
    save: "Guardar",
    saved: "Opciones de 'Copiar como' guardadas.",
  },

  checkingTable: "Comprobando la tabla de este resultado…",

  notice: {
    duplicateColumn: (name: string) => `El resultado tiene dos columnas llamadas ${name}: deja una fuera de la selección.`,
    copied: (rows: number, format: DocumentFormat) => `${formatCount(rows)} ${plural(rows, "fila copiada", "filas copiadas")} en ${nameOf(format)}.`,
    cutValues: (count: number) => `${formatCount(count)} ${plural(count, "valor cortado", "valores cortados")} al ancho máximo del TXT.`,
    removed: (count: number) => (count === 1 ? "Se quitó 1 carácter que el formato no acepta." : `Se quitaron ${formatCount(count)} caracteres que el formato no acepta.`),
    skipped: (count: number) => (count === 1 ? "1 fila no copiada, comentada en el SQL: el comentario dice por qué." : `${formatCount(count)} filas no copiadas, comentadas en el SQL: el comentario de cada una dice por qué.`),
    notWhole: (count: number) => (count === 1 ? "1 valor no pudo venir completo y se cortó." : `${formatCount(count)} valores no pudieron venir completos y se cortaron.`),
    noColumns: 'Las columnas elegidas son todas calculadas por la base de datos y quedan fuera del INSERT: activa "Incluir las columnas que calcula la base de datos" en las opciones del SQL.',
    tooLarge: gridSelectionCopy.copy.tooLarge,
    failed: recordsCopy.edit.menu.notCopied,
  },
};
