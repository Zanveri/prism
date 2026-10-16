using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-007: o CSV. O cabeçalho (os nomes das colunas, com a mesma proteção contra fórmula e as mesmas aspas, como texto) e uma linha por registro,
/// cada uma terminada pela quebra de linha escolhida, também a última. Com os padrões e o BOM, o arquivo é o do "Exportar CSV" (RN-TABELA-006) para as
/// mesmas linhas, byte a byte. Sem linhas, só o cabeçalho; sem cabeçalho, nada.
/// </summary>
internal sealed class CsvExportWriter(ExportWriterContext context, Stream output) : TextExportWriter(context, output)
{
    private readonly CsvExportOptions _options = (CsvExportOptions)context.Options;

    private CsvFieldOptions Field => new(_options.Delimiter, _options.Quoting, _options.FormulaGuard, _options.NullText);

    public override void Begin()
    {
        if (!_options.Header)
            return;

        var field = Field;
        for (var index = 0; index < Columns.Count; index++)
            WriteField(index, Columns[index].Name, "text", field);

        Output.Write(_options.LineBreak);
    }

    public override void Write(IReadOnlyList<ExportCell> row)
    {
        var field = Field;
        for (var index = 0; index < row.Count; index++)
            WriteField(index, TextOf(row[index]), Columns[index].Kind, field);

        Output.Write(_options.LineBreak);
    }

    public override void End()
        => Output.Flush();

    /// <summary>Cada campo vai direto ao arquivo, depois do separador: a linha não é montada num texto só, que copiaria de novo o valor grande.</summary>
    private void WriteField(int index, string? value, string kind, CsvFieldOptions field)
    {
        if (index > 0)
            Output.Write(_options.Delimiter);

        ExportText.WriteCsvField(Output, value, kind, field);
    }
}
