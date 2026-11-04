import { formatCount } from "@/lib/utils/format";

import type { GridFilterCopy } from "./grid-filter.copy";

export const gridFilterCopyEs: GridFilterCopy = {
  menu: {
    filter: "Filtrar",
    label: "Filtrar",
    byValue: "Filtrar por valor…",
    cellValue: "Valor de la celda",
    custom: "Personalizado",
    clear: "Quitar todos los filtros y ordenaciones",
    noValue: "(valor de la celda)",
    typed: "…",
    unavailable: (reason: string) => `No se aplica: ${reason}.`,
  },

  reasons: {
    nullCell: "la celda es nula",
    truncated: "el valor llegó cortado, y la pantalla no lo tiene entero",
    binary: "la columna es binaria",
    controls: "el valor tiene un salto de línea, una tabulación u otro carácter de control",
    informix: "Informix no acepta este valor como literal",
    informixOrder: "Informix no ordena valores lógicos",
    emptyLike: "el valor está vacío, y “contiene” coincidiría con todo",
    textOnly: "solo vale en una columna de texto",
    newRow: "la fila nueva aún no está en la base de datos",
    busy: "hay una sentencia en curso en la pestaña",
    several: "el filtro del campo tiene más de una sentencia",
    open: "el filtro del campo deja comillas o un comentario abiertos",
    nothingToRemove: "no hay filtro ni orden",
    noValues: "no hay valores para elegir",
  },

  values: {
    title: (column: string) => `Filtrar ${column} por valor`,
    description: (rows: number, more: boolean) => `Los valores distintos de ${formatCount(rows, "la fila cargada", "las filas cargadas")}${more ? ", sin las que aún no se han leído" : ""}, de los más frecuentes a los menos.`,
    search: "Buscar valor",
    searchPlaceholder: "Buscar…",
    list: "Valores de la columna",
    nullValue: "NULL",
    emptyValue: "(vacío)",
    count: (count: number) => count.toLocaleString("es"),
    countLabel: (count: number) => formatCount(count, "vez", "veces"),
    selectAll: "Marcar todos",
    selectNone: "Desmarcar todos",
    noMatch: "Ningún valor tiene ese texto.",
    capped: (shown: number, total: number) => `Mostrando ${shown.toLocaleString("es")} de ${total.toLocaleString("es")} valores. Usa la búsqueda para encontrar los demás.`,
    unusable: (count: number) => (count === 1 ? "1 valor no entra en el filtro (cortado o con carácter de control)." : `${count.toLocaleString("es")} valores no entran en el filtro (cortados o con carácter de control).`),
    chosen: (count: number) => (count === 0 ? "Ningún valor marcado." : formatCount(count, "valor marcado", "valores marcados") + "."),
    apply: "Filtrar",
    cancel: "Cancelar",
  },

  custom: {
    label: (condition: string) => `Valor para ${condition}`,
    hint: "Enter filtra, Esc cancela. El valor entra como literal de la base de datos.",
    apply: "Filtrar",
    cancel: "Cancelar",
    controls: "El valor no puede tener tabulación ni otro carácter de control.",
    informix: "Informix no acepta este valor como literal de esta columna.",
  },

  placeholder: "Escribe una expresión SQL para filtrar los resultados (usa Ctrl+Espacio)",

  result: {
    label: "Filtro y orden del resultado",
    hint: "Lo que va junto con la sentencia: una condición, un orden (ORDER BY) o ambos. El texto del editor no cambia.",
    wrapped: "el filtro se aplicó por fuera de la sentencia (SELECT * FROM (…)), y el resultado no dice de qué tabla viene cada fila",
  },

  completion: {
    column: "columna",
    keyword: "palabra del filtro",
  },
};
