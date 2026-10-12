import type { GridSlice } from "./grid-slice";

/**
 * O que o Markdown lê como outra coisa dentro de uma célula: a barra invertida e a vertical (a tabela), os que abrem formatação (`*`, `_`, a crase, o til,
 * o colchete) e os que abrem marcação ou entidade de HTML (`<` e `&`). Os cinco primeiros ganham barra invertida; `<` e `&` viram a entidade.
 */
const special = /[\\|`*_~[\]<&]/g;

function cell(text: string): string {
  const escaped = text.replace(special, (char) => (char === "<" ? "&lt;" : char === "&" ? "&amp;" : `\\${char}`));
  // Depois do escape: o <br> que a quebra de linha vira é nosso, e não pode ser escapado.
  return escaped.replace(/\r\n|\r|\n/g, "<br>");
}

/**
 * O recorte como tabela no estilo do GitHub: a linha dos nomes, a do alinhamento (`---:`, à direita, na coluna `number`) e uma por registro. Dentro da
 * célula a barra invertida e a vertical são escapadas, a quebra de linha (\n, \r\n ou \r) vira `<br>`, o HTML do dado vira entidade e a formatação do
 * Markdown (`*`, `_`, crase, til, colchete) é escapada. O nulo é uma célula vazia. Sem colunas não há tabela.
 */
export function toMarkdown(slice: GridSlice): string {
  if (slice.columns.length === 0) return "";

  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const lines = [
    line(slice.columns.map((column) => cell(column.name))),
    line(slice.columns.map((column) => (column.kind === "number" ? "---:" : "---"))),
    ...slice.rows.map((row) => line(row.map((value) => (value === null ? "" : cell(value))))),
  ];

  return `${lines.join("\n")}\n`;
}
