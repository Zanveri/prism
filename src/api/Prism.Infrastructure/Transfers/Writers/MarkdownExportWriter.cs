using Prism.Infrastructure.Transfers.Models;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-009: a tabela no estilo do GitHub (`to-markdown.ts` da tela): `| a | b |`, a linha de alinhamento (`---:` na coluna de número) e uma linha
/// por registro, com a célula escapada (<see cref="ExportText.MarkdownCell"/>). O nulo é o texto do "Nulo como", escapado como uma célula. O arquivo
/// termina em LF. Sem a linha de alinhamento o arquivo deixa de ser uma tabela do GitHub, como no DBeaver.
/// </summary>
internal sealed class MarkdownExportWriter(ExportWriterContext context, Stream output) : TextExportWriter(context, output)
{
    private readonly MarkdownExportOptions _options = (MarkdownExportOptions)context.Options;

    public override void Begin()
    {
        WriteLine(Columns.Select(column => ExportText.MarkdownCell(column.Name)));

        if (_options.AlignmentLine)
            WriteLine(Columns.Select(column => column.Kind == "number" ? "---:" : "---"));
    }

    public override void Write(IReadOnlyList<ExportCell> row)
        => WriteLine(row.Select(cell => ExportText.MarkdownCell(TextOf(cell) ?? _options.NullText)));

    public override void End()
        => Output.Flush();

    private void WriteLine(IEnumerable<string> cells)
    {
        Output.Write("| ");
        Output.Write(string.Join(" | ", cells));
        Output.Write(" |\n");
    }
}
