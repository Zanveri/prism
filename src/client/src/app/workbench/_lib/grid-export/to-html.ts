import type { QueryColumn } from "../query.schema";
import { gridExportCopy } from "./grid-export.copy";
import type { GridSlice } from "./grid-slice";
import { escapeHtml, isHtmlChar, stripUnaccepted } from "./text-escape";

/**
 * A folha de estilo é constante: nenhum estilo, classe ou atributo sai do dado. O `white-space` mantém as quebras de linha e as tabulações da
 * célula, e o nulo é a célula vazia (o que se copia dela é vazio) com o `NULL` apagado desenhado por CSS, como na grade.
 */
const style = [
  "table{border-collapse:collapse;font:14px/1.4 system-ui,sans-serif}",
  "th,td{border:1px solid #c8ccd4;padding:4px 8px;vertical-align:top;white-space:pre-wrap}",
  "th{background:#f1f3f6;text-align:left}",
  ".num{text-align:right}",
  `td.null::after{content:"${gridExportCopy.nullMark}";color:#8a909c;font-style:italic}`,
].join("\n");

/**
 * O recorte como um documento HTML completo: uma `<table>` com o cabeçalho em `<th>`. Tudo o que vem do dado (valor e nome de coluna) é escapado
 * (`&`, `<`, `>`, aspas) e os caracteres que um documento HTML válido não aceita (controle, DEL, C1, não-caracteres, par substituto solto) são
 * tirados, e `removed` diz quantos (o nome da coluna conta uma vez, e não por linha). Número à direita (classe `num`) e nulo na classe `null`. Nenhum
 * script, nenhum `style` nem evento: as únicas marcas são as do formato, e a política de conteúdo do próprio documento proíbe o resto. Sem colunas não há
 * linha `<tr>` alguma (o cabeçalho e o corpo ficam vazios): uma linha sem célula não é HTML válido.
 */
export function toHtml(slice: GridSlice): { text: string; removed: number } {
  let removed = 0;
  const safe = (text: string) => {
    const clean = stripUnaccepted(text, isHtmlChar);
    removed += clean.removed;
    return escapeHtml(clean.text);
  };
  const classOf = (column: QueryColumn) => (column.kind === "number" ? ' class="num"' : "");

  const header = slice.columns.map((column) => `<th scope="col"${classOf(column)}>${safe(column.name)}</th>`).join("");
  // Uma linha sem célula (recorte sem colunas) não é HTML válido: não se escreve `<tr>` para ela, nem para o cabeçalho.
  const rows = slice.rows
    .filter((row) => row.length > 0)
    .map((row) => `<tr>${row.map((value, index) => (value === null ? '<td class="null"></td>' : `<td${classOf(slice.columns[index])}>${safe(value)}</td>`)).join("")}</tr>\n`);

  return {
    text: [
      "<!DOCTYPE html>",
      '<html lang="pt-BR">',
      "<head>",
      '<meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
      `<title>${escapeHtml(gridExportCopy.documentTitle)}</title>`,
      `<style>\n${style}\n</style>`,
      "</head>",
      "<body>",
      "<table>",
      "<thead>",
      ...(header === "" ? [] : [`<tr>${header}</tr>`]),
      "</thead>",
      `<tbody>\n${rows.join("")}</tbody>`,
      "</table>",
      "</body>",
      "</html>",
      "",
    ].join("\n"),
    removed,
  };
}
