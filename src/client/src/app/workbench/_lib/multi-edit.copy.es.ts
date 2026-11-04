import { formatCount } from "@/lib/utils/format";

import type { MultiEditCopy } from "./multi-edit.copy";

const number = (count: number) => count.toLocaleString("es");
const lines = (count: number) => (count === 1 ? "1 fila" : `${number(count)} filas`);

function joined(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

export const multiEditCopyEs: MultiEditCopy = {
  hint: {
    cells: (count: number, column: string) => `Vale para las ${number(count)} celdas elegidas de la columna ${column}.`,
    all: (column: string) => `Vale para todas las filas del resultado, también las que no se cargaron (columna ${column}).`,
  },
  bar: {
    cells: (count: number, column: string) => `Vale para las ${number(count)} celdas elegidas de la columna ${column}.`,
    all: (column: string) => `Vale para todas las filas del resultado (columna ${column}).`,
  },
  untouched: "El valor no cambió: no se modificó nada. Para llevar el valor de esta celda a las otras elegidas, escribe el valor encima, o mueve el cursor y borra y escribe un carácter.",
  setNull: {
    cells: (count: number) => `Definir las ${number(count)} celdas como nulo`,
    all: "Definir la columna entera como nulo",
  },
  refused: (reason: string) => `La edición no se hizo: ${reason}.`,
  reasons: {
    truncated: (row: string) => `la celda de la ${row} llegó cortada`,
    deleted: (row: string) => `la ${row} está marcada para eliminación; Deshacer cambio la devuelve`,
    keyTruncated: (row: string) => `la clave de la ${row} llegó cortada`,
    keyGenerated: (row: string) => `la clave de la ${row} la generó la base de datos; ejecuta de nuevo para editarla`,
    noRowHere: (row: string, table: string) => `en la ${row}, ${table} no tiene fila (la clave vino nula)`,
    generated: (row: string) => `la celda de la ${row} la rellenó la base de datos; ejecuta de nuevo para verla`,
  },
  row: (row: number) => `fila ${number(row)}`,
  newRow: (position: number) => `fila nueva ${number(position)}`,
  tooMany: "La edición vale para hasta 100.000 celdas a la vez: elige menos celdas, o elige la columna entera por el encabezado.",
  applying: (count: number) => `Aplicando el valor a ${formatCount(count, "celda", "celdas")}…`,
  applyingBusy: "Aplicando el valor a las celdas elegidas.",
  cancel: "Cancelar",

  unavailable: (reason: string) => `No disponible: ${reason}.`,
  wholeReasons: {
    join: "en un resultado de join, la columna entera no se modifica: elige las celdas de la columna (arrastra, o Shift+clic), y la edición vale para ellas",
    key: (column: string, table: string) => `${column} es de la clave de ${table}: en la columna entera, todas las filas quedarían con la misma clave`,
    repeatedKey: (column: string, table: string) => `${column}, de la clave de ${table}, aparece con el mismo nombre en más de una columna del resultado`,
    notRead: "la columna entera ejecuta de nuevo la sentencia del resultado, y no es solo de lectura",
    limit: "la sentencia limita las filas sin un orden, y la base de datos puede elegir otras filas al ejecutar de nuevo: agrega un ORDER BY, o elige las celdas de la columna",
    sample: "la sentencia sortea las filas, y la base de datos elegiría otras al ejecutar de nuevo: elige las celdas de la columna",
  },
  assignment: (column: string, literal: string) => `${column} = ${literal}`,
  allRows: (assignments: readonly string[]) => `En todas las filas del resultado: ${assignments.join("; ")}.`,
  headerPending: (assignment: string) => `Cambio pendiente en todas las filas: ${assignment}`,
  headerMark: "cambio pendiente en todas las filas",
  oneAtATime: "El de la columna entera es una sola sentencia, grabada primero, y no hay forma de revertirla.",
  wholeTitle: (read: string) => `Valor leído: ${read}`,
  ownTitle: (whole: string) => `Valor de la columna entera: ${whole}`,
  uncertain: "el valor de esta columna puede estar grabado solo en parte de las filas",
  undo: {
    columns: (names: readonly string[], cells: number) =>
      `Deshacer el cambio ${names.length === 1 ? `de la columna ${names[0]}` : `de las columnas ${joined(names)}`}${cells === 0 ? "" : ` y de ${cells === 1 ? "1 celda" : `${number(cells)} celdas`}`}`,
    wholeOnly: "El cambio de esta columna vale para todas las filas: elige la columna entera, por el encabezado, para deshacerlo.",
  },

  counting: "Contando las filas del resultado…",
  countFailed: "No se pudieron contar las filas del resultado.",
  tooLarge: "Guardar pasa de 32 MiB de cambios: guarda por partes, o usa la columna entera por el encabezado.",
  question: {
    title: (columns: readonly string[], rows: number, table: string) =>
      `¿Modificar ${columns.length <= 2 ? joined(columns) : `${number(columns.length)} columnas`} en ${lines(rows)} de ${table}?`,
    none: (table: string) => `No se modificará ninguna fila de ${table}`,
    goesTo: "El valor va a todas las filas que la sentencia del resultado devuelve ahora, también las que la cuadrícula no cargó:",
    noRows: "La sentencia del resultado no devuelve ninguna fila ahora: el cambio de la columna entera no modifica nada.",
    changed: (grid: number, counted: number) => `La cuadrícula tiene ${lines(grid)}, y la sentencia devuelve ${number(counted)} ahora: el resultado cambió desde que se leyó.`,
    kept: "Este resultado es de una sentencia anterior del script. La base de datos la ejecuta de nuevo ahora, después de las sentencias que vinieron después.",
    ties: "La sentencia limita las filas: si el orden tiene empates, la base de datos puede elegir otras filas que las de la cuadrícula.",
    triggers: "Los disparadores y las claves foráneas con ON UPDATE actúan sobre esas filas, y el número de arriba cuenta solo las de la tabla.",
    others: (count: number) => (count === 1 ? "Guardar graba también el otro cambio sin guardar." : `Guardar graba también los otros ${number(count)} cambios sin guardar.`),
    after: { result: "Después, la pestaña ejecuta la sentencia de nuevo, para mostrar lo que tiene la base de datos.", table: "Después, los registros se leen de nuevo.", kept: "Después, esta pestaña se queda con las filas que leyó, con el valor nuevo; Ejecutar esta sentencia lee todas de nuevo." },
    oneAtATime: "Esta base de datos no tiene log de transacciones: el cambio se graba al instante, y no hay forma de revertirlo; si la base de datos lo rechaza a la mitad, parte de las filas queda modificada.",
    why: "Ves este aviso siempre que un cambio vale para la columna entera.",
    confirm: (rows: number) => (rows === 0 ? "Guardar" : `Modificar ${lines(rows)}`),
    viewSql: "Ver SQL",
  },

  savingFor: (seconds: number) => `Guardando… ${number(seconds)} s`,
  failed: (columns: readonly string[]) => `El cambio ${columns.length === 1 ? `de la columna ${columns[0]}` : `de las columnas ${joined(columns)}`} falló. No se grabó nada.`,
  cancelled: "Guardar cancelado: no se grabó nada.",
  cancelledPartly: (applied: number, left: number) =>
    `Guardar cancelado: ${applied === 1 ? "1 cambio ya estaba grabado" : `${number(applied)} cambios ya estaban grabados`}; ${left === 1 ? "el otro sigue pendiente" : `los otros ${number(left)} siguen pendientes`}.`,
  unknown: "No se sabe si Guardar terminó: la sesión con la base de datos se cayó sin responder a la cancelación. Ejecuta la sentencia de nuevo para ver lo que tiene la base de datos.",
  writtenAnyway: (columns: readonly string[], affected: number, counted: number, left: number) =>
    `${columns.length === 1 ? `La columna ${columns[0]} se modificó` : `Las columnas ${joined(columns)} se modificaron`} en ${lines(affected)}, y no en ${counted === 1 ? "la 1 contada" : `las ${number(counted)} contadas`}: el resultado cambió desde el conteo. Esta base de datos no tiene log de transacciones, y el cambio quedó grabado${left === 0 ? "." : `; ${left === 1 ? "el otro sigue pendiente" : `los otros ${number(left)} siguen pendientes`}.`}`,
  failedMidway: (columns: readonly string[]) =>
    `El cambio ${columns.length === 1 ? `de la columna ${columns[0]}` : `de las columnas ${joined(columns)}`} falló a la mitad. Esta base de datos no tiene log de transacciones: parte de las filas puede haberse modificado. Ejecuta la sentencia de nuevo para ver lo que tiene la base de datos.`,
  otherRows: "Ejecuta la sentencia de nuevo para ver lo que tiene la base de datos en las otras filas.",

  saved: (columns: readonly string[], rows: number, others: number) =>
    `${columns.length === 1 ? `Columna ${columns[0]} actualizada` : `Columnas ${joined(columns)} actualizadas`} en ${lines(rows)}${others === 0 ? "" : `, y ${others === 1 ? "1 cambio guardado más" : `${number(others)} cambios guardados más`}`}.`,
  keptNote: (columns: readonly string[], rows: number) =>
    `${columns.length === 1 ? `Columna ${columns[0]} actualizada` : `Columnas ${joined(columns)} actualizadas`} en ${lines(rows)}; esta pestaña muestra solo las que leyó. Ejecutar esta sentencia lee todas de nuevo.`,
};
