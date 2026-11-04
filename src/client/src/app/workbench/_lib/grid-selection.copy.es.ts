import { formatCount } from "@/lib/utils/format";

import type { GridSelectionCopy } from "./grid-selection.copy";

export const gridSelectionCopyEs: GridSelectionCopy = {
  count: (rows: number, cells: number, whole: boolean) => (whole ? `${formatCount(rows, "fila elegida", "filas elegidas")}` : `${formatCount(cells, "celda elegida", "celdas elegidas")}`),
  wholeColumns: (names: readonly string[], known: { total: number } | { loaded: number; added: number }) => {
    const label = names.length === 1 ? `Columna ${names[0]}` : `${names.length.toLocaleString("es")} columnas`;
    if ("total" in known) return known.total === 1 ? `${label}: la única fila` : known.total === 0 ? `${label}: todas las filas` : `${label}: todas las ${known.total.toLocaleString("es")} filas`;
    const loaded = formatCount(known.loaded, "cargada", "cargadas");
    return `${label}: todas las filas (${known.added === 0 ? loaded : `${loaded} y ${formatCount(known.added, "nueva", "nuevas")}`})`;
  },
  selectAll: "Elegir todas las filas",

  copy: {
    copied: "Copiado.",
    copiedWithHeader: "Copiado, con el encabezado.",
    rows: (rows: number, header: boolean) => `${rows === 1 ? "1 fila copiada" : `${formatCount(rows, "fila", "filas")} copiadas`}${header ? ", con el encabezado." : "."}`,
    tooLarge: "El texto pasó de 10 MiB, el límite del portapapeles. Elige menos celdas, o usa Exportar datos… para grabar un archivo.",
    copying: "Copiando…",
    chooseCell: "Elige una celda en la cuadrícula.",
  },

  names: {
    copied: (count: number) => (count === 1 ? "Nombre de la columna copiado." : `${formatCount(count, "nombre", "nombres")} de columna copiados.`),
  },
  numbers: {
    copied: (count: number) => (count === 1 ? "Número de la fila copiado." : `${formatCount(count, "número", "números")} de fila copiados.`),
    onlyNew: "Las filas nuevas no tienen número.",
  },

  menu: {
    copy: "Copiar",
    copyWithHeader: "Copiar con encabezado",
    advanced: "Copia avanzada",
    advancedDialog: "Copia avanzada…",
    columnNames: "Copiar nombre(s) de columna",
    rowNumbers: "Copiar número(s) de fila",
    copyAs: (format: string) => `Copiar como ${format}`,
    configureCopyAs: "Configurar comandos 'Copiar como'…",
    sort: "Ordenar",
    sortAscending: "Ascendente",
    sortDescending: "Descendente",
    sortNone: "Sin orden",
    follow: "Ir al registro referenciado",
    generateSql: "Generar SQL",
    sql: {
      selectEquals: "SELECT .. WHERE .. =",
      selectIn: "SELECT .. WHERE .. IN",
      insert: "INSERT",
      update: "UPDATE",
      delete: "DELETE por clave única",
      create: "CREATE",
    },
    oneCellOnly: "Vale para una sola celda: elige una.",
    sortUnavailable: (reason: string) => `No disponible: ${reason}.`,
    sortNotRead: "ordenar ejecuta de nuevo la sentencia del resultado, y no es solo de lectura",
    followUnavailable: "No disponible: este valor no lleva a un registro.",
    copyShortcut: "Ctrl+C",
    copyShortcutMac: "Cmd+C",
    advancedShortcut: "Ctrl+Shift+C",
    advancedShortcutMac: "Cmd+Shift+C",
  },

  loadRest: {
    progress: (loaded: number, total: number | null) =>
      total === null ? `Cargando las filas que faltan… ${formatCount(loaded, "fila", "filas")}` : `Cargando las filas que faltan… ${loaded.toLocaleString("es")} de ${formatCount(total, "fila", "filas")}`,
    tooMany: "El resultado tiene más de 100.000 filas, el límite de lo que la cuadrícula carga para copiar o generar SQL. Usa Exportar datos…, que lee todas desde la base de datos.",
    closed: (subject: "table" | "result") =>
      `No se pueden leer las filas que faltan: el cursor de este resultado se cerró. ${subject === "table" ? "Actualiza los registros, o elige solo las filas cargadas (Ctrl+A)." : "Ejecuta la sentencia de nuevo, o elige solo las filas cargadas (Ctrl+A)."}`,
    busy: "Hay una sentencia en curso en la pestaña: inténtalo otra vez cuando termine.",
    refreshing: "La actualización automática está leyendo las filas de nuevo; inténtalo otra vez en un momento.",
    failed: "No se pudieron leer las filas que faltan.",
  },

  rows: {
    chooseRows: "Elige las filas por el número de fila.",
    duplicate: "Duplicar filas",
    remove: "Eliminar filas",
    duplicateTitle: (count: number, shortcut: string) => `Duplicar las ${count.toLocaleString("es")} filas elegidas (${shortcut})`,
    removeTitle: (count: number, shortcut: string) => `Eliminar las ${count.toLocaleString("es")} filas elegidas (${shortcut})`,
    duplicateDescription: (count: number) => `Duplicar las ${count.toLocaleString("es")} filas elegidas`,
    removeDescription: (count: number) => `Eliminar las ${count.toLocaleString("es")} filas elegidas`,
    duplicateLimit: "Duplicar vale para hasta 1.000 filas a la vez: elige menos filas.",
    keyTruncatedAt: (row: number) => `la clave de la fila ${row.toLocaleString("es")} llegó cortada`,
    keyGeneratedAt: (row: number) => `la clave de la fila ${row.toLocaleString("es")} la generó la base de datos; ejecuta de nuevo para editarla`,
    alreadyDeleted: "las filas ya están marcadas para eliminación; Deshacer cambio las devuelve",
    keyCopied: (table: string, columns: readonly string[]) => `Las filas duplicadas copiaron la clave de ${table} (${columns.join(", ")}): cámbiala en cada una antes de guardar, o la base de datos rechazará las filas repetidas.`,
    fullValueMissing: (column: string, row: number, subject: "table" | "result") =>
      `Las filas no se duplicaron: no pudo venir el valor completo de ${column}, en la fila ${row.toLocaleString("es")}. ${subject === "table" ? "Actualiza los registros para duplicarlas." : "Ejecuta la sentencia de nuevo para duplicarlas."}`,
    fetchCancelled: "Las filas no se duplicaron: se canceló la búsqueda de los valores completos.",
  },
};
