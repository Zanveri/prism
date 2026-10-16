using Prism.Infrastructure.Transfers.Models;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-009: o documento HTML da RN-GRADE-007 (`to-html.ts` da tela): a política de conteúdo do próprio documento, que proíbe script, a folha de
/// estilo constante e uma `table`, com o nome da coluna em `th`, o número alinhado à direita (`num`) e o nulo na célula vazia, com o `NULL` apagado
/// desenhado pela folha de estilo. Tudo o que vem do banco (os valores, os nomes das colunas e o da origem) sai sem o que o documento não aceita, contado
/// (o nome conta uma vez, e não por linha), e escapado. Com "Título com o nome da origem", ele é o `title` e uma `caption`; sem, o `title` é "Resultado".
/// </summary>
internal sealed class HtmlExportWriter(ExportWriterContext context, Stream output) : TextExportWriter(context, output)
{
    /// <summary>Constante: nenhum estilo, classe ou atributo sai do dado. O `white-space` mantém as quebras de linha e as tabulações da célula.</summary>
    private const string Style = "table{border-collapse:collapse;font:14px/1.4 system-ui,sans-serif}\nth,td{border:1px solid #c8ccd4;padding:4px 8px;vertical-align:top;white-space:pre-wrap}\nth{background:#f1f3f6;text-align:left}\n.num{text-align:right}\ntd.null::after{content:\"NULL\";color:#8a909c;font-style:italic}";

    /// <summary>O título do documento sem o nome da origem, como o da tela.</summary>
    private const string DocumentTitle = "Resultado";

    private readonly HtmlExportOptions _options = (HtmlExportOptions)context.Options;

    public override void Begin()
    {
        var title = DocumentTitle;
        if (_options.Title)
            title = Safe(Context.SourceName);

        Output.Write("<!DOCTYPE html>\n<html lang=\"pt-BR\">\n<head>\n<meta charset=\"utf-8\">\n<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">\n");
        Output.Write($"<title>{title}</title>\n<style>\n{Style}\n</style>\n</head>\n<body>\n<table>\n");

        if (_options.Title)
            Output.Write($"<caption>{title}</caption>\n");

        Output.Write("<thead>\n");
        if (_options.ColumnNames)
            Output.Write($"<tr>{string.Concat(Columns.Select(column => $"<th scope=\"col\"{ClassOf(column)}>{Safe(column.Name)}</th>"))}</tr>\n");

        Output.Write("</thead>\n<tbody>\n");
    }

    public override void Write(IReadOnlyList<ExportCell> row)
    {
        Output.Write("<tr>");
        for (var index = 0; index < row.Count; index++)
        {
            if (TextOf(row[index]) is { } text)
                Output.Write($"<td{ClassOf(Columns[index])}>{Safe(text)}</td>");
            else
                Output.Write("<td class=\"null\"></td>");
        }

        Output.Write("</tr>\n");
    }

    public override void End()
    {
        Output.Write("</tbody>\n</table>\n</body>\n</html>\n");
        Output.Flush();
    }

    private static string ClassOf(ExportColumn column)
        => column.Kind == "number" ? " class=\"num\"" : string.Empty;

    private string Safe(string text)
    {
        var escaped = ExportText.HtmlText(text, out var removed);
        Counts.RemovedCharacters += removed;

        return escaped;
    }
}
