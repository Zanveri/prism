import { formatCount } from "@/lib/utils/format";

import { gridSelectionCopy } from "../grid-selection.copy";
import { recordsCopy } from "../records.copy";

import type { GenerateSqlCopy } from "./generate-sql.copy";

const number = (count: number) => count.toLocaleString("es");

export const generateSqlCopyEs: GenerateSqlCopy = {
  items: gridSelectionCopy.menu.sql,
  menu: gridSelectionCopy.menu.generateSql,

  // Los comentarios del SQL generado son el propio texto generado (fixture de oro `generate-sql.json`): iguales en los tres idiomas.
  sql: {
    noKey: "Sem chave primária nem chave única: a condição usa todas as colunas, e linhas iguais seriam afetadas juntas.",
    skipped: {
      truncated: "Linhas da grade não geradas, com um valor que não pôde vir inteiro",
      binary: "Linhas da grade não geradas, com um valor binário, que o Informix não escreve como literal",
      literal:
        "Linhas da grade não geradas, com um valor que não cabe num literal (caractere de controle que não seja quebra de linha, retorno de carro nem tabulação; no Informix, também data e hora com mais de cinco casas de segundo ou lógico que não seja true nem false)",
      generated: "Linhas da grade não geradas, com um valor que o banco gerou e a grade não mostra (execute de novo para vê-lo)",
    },
  },

  reasons: {
    unavailable: (fragment: string) => `No disponible: ${fragment}.`,
    noRows: "El resultado no tiene filas.",
    onlyNewRows: "Las filas nuevas todavía no están en la base de datos: Ver SQL muestra su INSERT.",
    busy: "hay una sentencia en curso en la pestaña",
    refreshing: "la actualización automática está leyendo las filas de nuevo; inténtalo otra vez en un momento",
    oneTable: (reason: string) => `Solo en un resultado de una tabla: ${reason}.`,
    join: "en un resultado de combinación solo se modifican celdas",
    elsewhere: (table: string) => `${table}, escrita sin esquema, ahora apunta a otra tabla en la sesión`,
    keyIncomplete: (table: string, missing: readonly string[]) => `la clave de ${table} no está completa en el resultado: faltan ${missing.join(", ")}`,
    nothingToSet: "no hay columna fuera de la clave para actualizar",
    noCondition: "ninguna columna del resultado sirve de condición",
    nothingToInsert: "todas las columnas de la tabla en el resultado las genera la base de datos",
    view: (table: string) => `${table} es una vista: Prism no arma el DDL de las vistas`,
    notATable: (table: string) => `${table} no es una tabla: Prism solo arma el DDL de las tablas`,
  },

  dialog: {
    title: "Generar SQL",
    rows: (count: number) => formatCount(count, "fila", "filas"),
    separator: " · ",
    options: "Opciones",
    qualified: "Nombres completos (esquema.tabla)",
    compact: "SQL compacto (una línea por sentencia)",
    excludeGenerated: "Excluir las columnas que genera la base de datos",
    target: "Tabla de destino",
    schema: "Esquema",
    schemaHint: "Opcional. Los nombres como están en la base de datos: Prism pone las comillas.",
    table: "Tabla",
    tableMissing: "Indica la tabla de destino.",
    nameTooLong: "El nombre puede tener como máximo 128 caracteres.",
    nameControl: "El nombre no puede tener caracteres de control.",
    duplicateColumn: (name: string) => `El resultado tiene dos columnas llamadas ${name}: la base de datos rechazaría el INSERT.`,
    sqlLabel: "SQL generado",
    checking: "Comprobando la tabla y la clave de este resultado…",
    fetching: "Obteniendo los valores completos…",
    readingCatalog: "Leyendo el catálogo…",
    cancel: "Cancelar",
    targetFailed: "No se pudo determinar la tabla y la clave de este resultado.",
    catalogFailed: "No se pudo leer el catálogo de la tabla.",
    retry: "Reintentar",
    changed: "El resultado cambió desde que elegiste las filas. Elige las filas de nuevo y genera otra vez.",
    tooLarge: "El SQL pasaría de 1 MB, el límite del texto de una pestaña de consulta. Elige menos filas, o exporta como SQL (Exportar datos…).",
    close: "Cerrar",
    openInTab: "Abrir en una pestaña de consulta",
    copy: "Copiar",
    copied: "SQL copiado.",
    notCopied: recordsCopy.edit.menu.notCopied,
  },

  warnings: {
    skipped: (skipped: number, total: number) => {
      if (total === 1) return "La fila quedó fuera: el comentario al final del SQL dice por qué.";
      return skipped === 1
        ? `1 de las ${number(total)} filas quedó fuera: el comentario al final del SQL dice cuál y por qué.`
        : `${number(skipped)} de las ${number(total)} filas quedaron fuera: el comentario al final del SQL dice cuáles y por qué.`;
    },
    newRows: "Las filas nuevas aún no guardadas quedaron fuera: Ver SQL muestra su INSERT.",
    pending: (count: number) =>
      count === 1
        ? "1 fila tiene cambios sin guardar: el SQL usa los valores de la cuadrícula, y la condición, la clave leída de la base de datos."
        : `${number(count)} filas tienen cambios sin guardar: el SQL usa los valores de la cuadrícula, y la condición, la clave leída de la base de datos.`,
    readOnly: "La conexión es de solo lectura: el SQL que escribe será rechazado en ella.",
  },
};
