using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Transfers.Imports;

/// <summary>RN-IMPORT-007: uma linha da prévia do arquivo: a linha do arquivo, os valores como foram lidos (em texto, ou nulos) e se ela foi completada com nulo.</summary>
public sealed record ImportFileRow(long Line, IReadOnlyList<string?> Values, bool Short)
{
    public override string ToString()
        => nameof(ImportFileRow);
}

/// <summary>RN-IMPORT-007 e 008: a prévia do arquivo (`imports/read`): o que a leitura achou, quantas das primeiras colunas as linhas trazem, e as linhas.</summary>
public sealed record ImportFilePreview(ImportReadInfo Info, int ShownColumns, IReadOnlyList<ImportFileRow> Rows)
{
    public override string ToString()
        => nameof(ImportFilePreview);
}

/// <summary>RN-IMPORT-011: uma célula da prévia convertida: o valor como vai ao banco (o texto canônico, o binário como `0x`, ou nulo) e, quando não converte, o motivo.</summary>
public sealed record ImportPreviewCell(string? Value, string? Problem)
{
    public override string ToString()
        => nameof(ImportPreviewCell);
}

/// <summary>RN-IMPORT-011: uma linha da prévia convertida: a linha do arquivo, o problema da linha inteira, se ela foi completada com nulo e uma célula por coluna mapeada que cabe.</summary>
public sealed record ImportPreviewRow(long Line, string? Problem, bool Short, IReadOnlyList<ImportPreviewCell> Cells)
{
    public override string ToString()
        => nameof(ImportPreviewRow);
}

/// <summary>RN-IMPORT-012: uma chave estrangeira de outra tabela que aponta para a de destino, com a regra dela ao excluir.</summary>
public sealed record ImportReference(string Schema, string Table, string OnDelete)
{
    public override string ToString()
        => nameof(ImportReference);
}

/// <summary>RN-IMPORT-009 e 012: a tabela de destino como a prévia a lê no catálogo.</summary>
/// <param name="OneAtATime">RN-EDIT-012: o Informix sem log, em que cada linha é gravada sozinha.</param>
public sealed record ImportTargetTable(string Schema, string Name, bool OneAtATime, IReadOnlyList<ImportTargetColumn> Columns, IReadOnlyList<ImportReference> ReferencedBy)
{
    public override string ToString()
        => nameof(ImportTargetTable);
}

/// <summary>RN-IMPORT-009 a 011: a prévia convertida (`imports/preview`): a tabela, as colunas do arquivo, o mapeamento (o pedido, ou o sugerido) e as linhas.</summary>
public sealed record ImportConvertedPreview(ImportTargetTable Table, IReadOnlyList<string> Columns, IReadOnlyList<ImportMappingEntry> Mapping, int ShownColumns, IReadOnlyList<ImportPreviewRow> Rows)
{
    public override string ToString()
        => nameof(ImportConvertedPreview);
}

/// <summary>
/// RN-IMPORT-007, 008 e 011: as linhas das prévias, com o teto das respostas: as células cortadas nos 1.000 caracteres e só as primeiras colunas que
/// cabem em 8 MiB de células (o tamanho em bytes de UTF-8 do valor e do motivo de cada célula, nas linhas todas).
/// </summary>
public static class ImportPreviews
{
    /// <summary>RN-IMPORT-007: as linhas de dados da prévia.</summary>
    public const int Rows = 20;

    /// <summary>RN-IMPORT-008: o teto das células de uma resposta de prévia.</summary>
    public const long MaxCellBytes = 8L * 1024 * 1024;

    /// <summary>
    /// RN-IMPORT-007: a prévia do arquivo, os valores como foram lidos, antes de qualquer conversão. É nulo o que o arquivo e as opções do leitor dizem que
    /// é, qualquer que seja a coluna de destino: o nulo do arquivo, o campo igual ao "Texto do nulo" (sem as pontas, com "Tirar os espaços das pontas") e o
    /// campo vazio com "Campo vazio vira nulo". O resto vai como texto, sem tirar o apóstrofo da proteção nem as pontas, que dependem da coluna.
    /// </summary>
    public static ImportFilePreview FileRows(ImportReadInfo info, IReadOnlyList<ImportRecord> records, ImportValueRules rules)
    {
        var rows = records.Select(record => (record.Line, Values: record.Values.Select(value => FileValue(value, rules)).ToList(), record.Short)).ToList();
        var shown = Shown(info.Columns.Count, column => rows.Sum(row => Bytes(row.Values[column])));

        return new ImportFilePreview(info, shown, [.. rows.Select(row => new ImportFileRow(row.Line, row.Values.Take(shown).ToList(), row.Short))]);
    }

    /// <summary>
    /// RN-IMPORT-011: as células convertidas de cada linha, uma por coluna mapeada, na ordem do mapeamento, cada uma com o valor que vai ao banco ou a
    /// recusa do Prism (RN-IMPORT-010). A recusa do banco (no PostgreSQL) entra depois, em <see cref="WithDatabaseProblems"/>. Devolve também o valor
    /// convertido de cada célula, para a conferência do banco.
    /// </summary>
    public static (IReadOnlyList<ImportPreviewRow> Rows, IReadOnlyList<IReadOnlyList<ImportConverted?>> Converted) ConvertedRows(EDatabaseEngine engine, IReadOnlyList<ImportRecord> records, IReadOnlyList<ImportMappingEntry> mapping, IReadOnlyList<ImportTargetColumn> table, ImportValueRules rules, ImportValueFormats formats)
    {
        var targets = mapping.Select(entry => table.First(column => column.Name == entry.Target)).ToList();
        var rows = new List<ImportPreviewRow>(records.Count);
        var converted = new List<IReadOnlyList<ImportConverted?>>(records.Count);

        foreach (var record in records)
        {
            var cells = new ImportPreviewCell[mapping.Count];
            var values = new ImportConverted?[mapping.Count];
            for (var index = 0; index < mapping.Count; index++)
            {
                var result = ImportValues.Convert(engine, targets[index], record.Values[mapping[index].Source], rules, formats);
                values[index] = result.IsSuccess ? result.Value : null;
                cells[index] = result.IsSuccess ? new ImportPreviewCell(result.Value.Text is { } text ? ImportText.Cut(text, ImportText.MaxPreviewLength) : null, null) : new ImportPreviewCell(null, result.Error);
            }

            rows.Add(new ImportPreviewRow(record.Line, record.Problem?.Message, record.Short, cells));
            converted.Add(values);
        }

        return (rows, converted);
    }

    /// <summary>RN-IMPORT-011: as recusas do banco (a conversão que o PostgreSQL faria), célula por célula, sobre a prévia; nula é a célula que converte.</summary>
    public static IReadOnlyList<ImportPreviewRow> WithDatabaseProblems(IReadOnlyList<ImportPreviewRow> rows, IReadOnlyList<IReadOnlyList<string?>> problems)
        => [.. rows.Select((row, index) => row with
        {
            Cells = [.. row.Cells.Select((cell, column) => problems[index][column] is { } problem ? new ImportPreviewCell(null, problem) : cell)]
        })];

    /// <summary>RN-IMPORT-008: as linhas só com as primeiras colunas que cabem em 8 MiB de células, e quantas são.</summary>
    public static (int Shown, IReadOnlyList<ImportPreviewRow> Rows) Fit(IReadOnlyList<ImportPreviewRow> rows, int columns)
    {
        var shown = Shown(columns, column => rows.Sum(row => Bytes(row.Cells[column].Value) + Bytes(row.Cells[column].Problem)));

        return (shown, [.. rows.Select(row => row with { Cells = [.. row.Cells.Take(shown)] })]);
    }

    private static string? FileValue(ImportValue value, ImportValueRules rules)
    {
        if (value.Source == EImportValueSource.Null || value.Text is null)
            return null;

        var compared = rules.Trim ? ImportText.TrimEnds(value.Text) : value.Text;
        if (rules.NullText is { } nullText && compared == nullText && (value.Source == EImportValueSource.Plain || (value.Source == EImportValueSource.Quoted && rules.NullTextQuoted)))
            return null;

        if (rules.EmptyAsNull && compared.Length == 0)
            return null;

        return ImportText.Cut(value.Text, ImportText.MaxPreviewLength);
    }

    private static int Shown(int columns, Func<int, long> bytesOf)
    {
        long total = 0;
        for (var column = 0; column < columns; column++)
        {
            total += bytesOf(column);
            if (total > MaxCellBytes)
                return column;
        }

        return columns;
    }

    private static long Bytes(string? text)
        => text is null ? 0 : ImportText.Utf8Length(text);
}
