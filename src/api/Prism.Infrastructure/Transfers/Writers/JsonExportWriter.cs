using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-010: a lista de objetos da RN-GRADE-007 (`to-json.ts` da tela), um por linha, com uma chave por coluna, na ordem do resultado (o nome
/// repetido ganha `_2`, `_3`…). Recuo de 2 espaços e LF, com uma quebra de linha no fim do arquivo. Com "Pôr o nome da origem", a lista vai um nível
/// para dentro, como o valor da chave com o nome da origem: `{ "pedido": [ … ] }`. Sem linhas, `[]` (ou `{ "pedido": [] }`). O número e o booleano
/// saem sem aspas (<see cref="ExportText.JsonValue"/>), e com "Datas em ISO 8601" a data e hora da coluna de data ganha o `T` e o fuso completo.
/// </summary>
internal sealed class JsonExportWriter(ExportWriterContext context, Stream output) : TextExportWriter(context, output)
{
    private readonly JsonExportOptions _options = (JsonExportOptions)context.Options;

    private readonly IReadOnlyList<string> _keys = [.. ExportText.UniqueKeys([.. context.Columns.Select(column => column.Name)]).Select(ExportText.JsonString)];

    private long _rows;

    private string Indent => _options.Wrap ? "    " : "  ";

    public override void Begin()
        => Output.Write(_options.Wrap ? $"{{\n  {ExportText.JsonString(Context.SourceName)}: [" : "[");

    public override void Write(IReadOnlyList<ExportCell> row)
    {
        Output.Write(_rows++ == 0 ? "\n" : ",\n");
        Output.Write(Indent);
        Output.Write("{\n");

        for (var index = 0; index < row.Count; index++)
        {
            Output.Write(Indent);
            Output.Write("  ");
            Output.Write(_keys[index]);
            Output.Write(": ");
            Output.Write(ExportText.JsonValue(Columns[index].Kind, ValueOf(row[index], Columns[index])));
            Output.Write(index < row.Count - 1 ? ",\n" : "\n");
        }

        Output.Write(Indent);
        Output.Write("}");
    }

    public override void End()
    {
        if (_rows == 0)
            Output.Write("]");
        else
            Output.Write(_options.Wrap ? "\n  ]" : "\n]");

        Output.Write(_options.Wrap ? "\n}\n" : "\n");
        Output.Flush();
    }

    private string? ValueOf(ExportCell cell, ExportColumn column)
        => TextOf(cell) is { } text && _options.IsoDates && column.Kind == "datetime" ? ExportText.IsoDateTime(text) : TextOf(cell);
}
