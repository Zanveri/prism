import { emptyCounts, type DocumentColumn, type DocumentContext, type DocumentWriter } from "./document";
import { gridExportCopy } from "./grid-export.copy";
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

const classOf = (column: DocumentColumn) => (column.kind === "number" ? ' class="num"' : "");

/**
 * RN-EXPORT-009: o documento HTML, o `HtmlExportWriter` da API: `<!DOCTYPE html>`, a política de conteúdo do próprio documento, que proíbe script, a
 * folha de estilo constante e uma `<table>`, com o nome da coluna em `<th>`, o número à direita (`num`) e o nulo na célula vazia da classe `null`. Tudo o
 * que vem do banco (os valores, os nomes das colunas e o da origem) sai sem o que um documento HTML não aceita (controle, DEL, C1, não-caractere, par
 * substituto solto), contado em `removedCharacters` (o nome conta uma vez, e não por linha), e escapado (`&`, `<`, `>` e as duas aspas). Com "Título com o
 * nome da origem" ele é o `<title>` e uma `<caption>`; sem, o `<title>` é "Resultado". Com "Nomes das colunas", a linha do `<thead>`.
 */
export function htmlWriter({ columns, sourceName, options }: DocumentContext): DocumentWriter {
  const o = options.html;
  const counts = emptyCounts();
  const safe = (text: string) => {
    const clean = stripUnaccepted(text, isHtmlChar);
    counts.removedCharacters += clean.removed;
    return escapeHtml(clean.text);
  };

  return {
    counts,
    begin: () => {
      const title = o.title ? safe(sourceName) : gridExportCopy.documentTitle;
      return [
        "<!DOCTYPE html>",
        '<html lang="pt-BR">',
        "<head>",
        '<meta charset="utf-8">',
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
        `<title>${title}</title>`,
        `<style>\n${style}\n</style>`,
        "</head>",
        "<body>",
        "<table>",
        ...(o.title ? [`<caption>${title}</caption>`] : []),
        "<thead>",
        ...(o.columnNames ? [`<tr>${columns.map((column) => `<th scope="col"${classOf(column)}>${safe(column.name)}</th>`).join("")}</tr>`] : []),
        "</thead>",
        "<tbody>",
        "",
      ].join("\n");
    },
    write: (row) => `<tr>${row.values.map((value, index) => (value === null ? '<td class="null"></td>' : `<td${classOf(columns[index])}>${safe(value)}</td>`)).join("")}</tr>\n`,
    end: () => "</tbody>\n</table>\n</body>\n</html>\n",
  };
}
