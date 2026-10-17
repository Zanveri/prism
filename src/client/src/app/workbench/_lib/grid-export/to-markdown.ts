import { emptyCounts, type DocumentContext, type DocumentWriter } from "./document";

/**
 * O que o Markdown lê como outra coisa dentro de uma célula: a barra invertida e a vertical (a tabela), os que abrem formatação (`*`, `_`, a crase, o til,
 * o colchete) e os que abrem marcação ou entidade de HTML (`<` e `&`). Os cinco primeiros ganham barra invertida; `<` e `&` viram a entidade.
 */
const special = /[\\|`*_~[\]<&]/g;

/** Uma célula da tabela, com o escape acima e a quebra de linha como `<br>`: a mesma da exportação da API (RN-EXPORT-009), conferida pela fixture `markdown-cell.json` (RN-EXPORT-024). */
export function markdownCell(text: string): string {
  const escaped = text.replace(special, (char) => (char === "<" ? "&lt;" : char === "&" ? "&amp;" : `\\${char}`));
  // Depois do escape: o <br> que a quebra de linha vira é nosso, e não pode ser escapado.
  return escaped.replace(/\r\n|\r|\n/g, "<br>");
}

/**
 * RN-EXPORT-009: a tabela no estilo do GitHub, o `MarkdownExportWriter` da API: `| a | b |`, a linha de alinhamento (`---:` à direita na coluna de número)
 * e uma linha por registro, com a célula escapada (`markdownCell`). O nulo é o texto do "Nulo como", escapado como uma célula. Termina em LF. Sem a linha de
 * alinhamento o texto deixa de ser uma tabela do GitHub, como no DBeaver.
 */
export function markdownWriter({ columns, options }: DocumentContext): DocumentWriter {
  const o = options.markdown;
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |\n`;
  return {
    counts: emptyCounts(),
    begin: () => `${line(columns.map((column) => markdownCell(column.name)))}${o.alignmentLine ? line(columns.map((column) => (column.kind === "number" ? "---:" : "---"))) : ""}`,
    write: (row) => line(row.values.map((value) => markdownCell(value ?? o.nullText))),
    end: () => "",
  };
}
