namespace Prism.Infrastructure.Transfers.Models;

/// <summary>RN-EXPORT-006 e 011: o binário como a grade o escreve (`0x…`), como o nulo do formato (o valor nem é pedido ao leitor) ou, no SQL, como literal do banco.</summary>
public enum EExportBinary
{
    Hex,
    Null,
    Literal
}

/// <summary>RN-EXPORT-007: as aspas do CSV, só quando precisa, em todos os textos (e nos nomes das colunas) ou em todos os valores.</summary>
public enum ECsvQuoting
{
    Auto,
    Text,
    All
}

/// <summary>
/// RN-EXPORT-006 a 013: as opções do formato escolhido, já conferidas (`ExportOptionsReader`), com o padrão do Prism no que não veio. Um record por
/// formato, todos com o binário. Os nomes da tabela de destino (SQL e DbUnit) são texto do banco, e os records que os levam não os imprimem.
/// </summary>
public abstract record ExportFormatOptions(EExportBinary Binary);

/// <param name="Delimiter">`;`, `,`, a tabulação ou `|`.</param>
/// <param name="LineBreak">`\r\n` ou `\n`: toda linha termina nela, também a última.</param>
public sealed record CsvExportOptions(string Delimiter, bool Header, ECsvQuoting Quoting, bool FormulaGuard, string LineBreak, string NullText, EExportBinary Binary) : ExportFormatOptions(Binary);

/// <param name="MaxWidth">0 é sem limite.</param>
public sealed record TxtExportOptions(bool Header, bool HeaderLine, bool EdgeDelimiters, int MinWidth, int MaxWidth, bool ShowNull, string LineBreak, EExportBinary Binary) : ExportFormatOptions(Binary);

public sealed record HtmlExportOptions(bool Title, bool ColumnNames, EExportBinary Binary) : ExportFormatOptions(Binary);

public sealed record MarkdownExportOptions(bool AlignmentLine, string NullText, EExportBinary Binary) : ExportFormatOptions(Binary);

/// <param name="Wrap">"Pôr o nome da origem": `{ "pedido": [ … ] }`.</param>
public sealed record JsonExportOptions(bool Wrap, bool IsoDates, EExportBinary Binary) : ExportFormatOptions(Binary);

/// <param name="ShortArrays">"PHP 5.4 ou mais novo", com `[...]`; falso é o padrão, `array(...)`.</param>
public sealed record SourceCodeExportOptions(bool ShortArrays, bool SingleQuotes, bool IsoDates, EExportBinary Binary) : ExportFormatOptions(Binary);

/// <param name="Schema">O esquema de destino; nulo ou vazio, sem esquema. Quem o resolve a partir da origem é quem começa a exportação.</param>
/// <param name="Table">A tabela de destino, já resolvida (a da origem quando não veio).</param>
public sealed record SqlExportOptions(string? Schema, string Table, bool OmitSchema, int RowsPerStatement, EExportBinary Binary) : ExportFormatOptions(Binary)
{
    public override string ToString()
        => nameof(SqlExportOptions);
}

public sealed record XmlExportOptions(bool Doctype, EExportBinary Binary) : ExportFormatOptions(Binary);

/// <param name="Table">O nome do elemento de cada linha, já resolvido (a tabela da origem quando não veio).</param>
/// <param name="MarkNulls">"Escrever [NULL]"; falso é o padrão, o atributo omitido.</param>
public sealed record DbUnitExportOptions(string Table, bool UpperCase, bool MarkNulls, EExportBinary Binary) : ExportFormatOptions(Binary)
{
    public override string ToString()
        => nameof(DbUnitExportOptions);
}

public sealed record XlsxExportOptions(EExportBinary Binary) : ExportFormatOptions(Binary);
