namespace Prism.Infrastructure.Transfers.Imports;

/// <summary>RN-IMPORT-003 e as notas da seção 36: os formatos que a importação de dados lê, como o pedido os escreve.</summary>
public static class ImportFormats
{
    public const string Csv = "csv";
    public const string Tsv = "tsv";
    public const string Json = "json";
    public const string Xlsx = "xlsx";

    public static IReadOnlyList<string> All { get; } = [Csv, Tsv, Json, Xlsx];

    public static bool Exists(string? format)
        => format is not null && All.Contains(format, StringComparer.Ordinal);
}

/// <summary>RN-IMPORT-004 a 006: as opções do leitor de um formato, já com o padrão do Prism no que o pedido não trouxe.</summary>
public abstract record ImportReaderOptions;

/// <summary>
/// RN-IMPORT-004: o CSV e o TSV. `Encoding` é `auto` ou o nome de uma codificação (`utf-8`, `utf-16le`, `utf-16be`, `windows-1252`, `iso-8859-1`);
/// `Delimiter` nulo é o automático, e no TSV é sempre a tabulação. `NullText` vazio é "nenhum texto é nulo".
/// </summary>
public sealed record CsvImportOptions(string Encoding, string? Delimiter, bool Header, bool Quotes, string NullText, bool EmptyAsNull, bool Trim, bool SkipEmptyLines, bool UnguardFormulas) : ImportReaderOptions
{
    public static CsvImportOptions Default { get; } = new(ImportEncodings.Auto, null, Header: true, Quotes: true, NullText: string.Empty, EmptyAsNull: false, Trim: false, SkipEmptyLines: true, UnguardFormulas: true);

    /// <summary>O texto do nulo é dado da pessoa (e pode ser um valor da tabela): o `ToString()` não o imprime (RN-LOG-001).</summary>
    public override string ToString()
        => nameof(CsvImportOptions);
}

/// <summary>RN-IMPORT-005: o JSON. `Keys` são as colunas que a leitura achou (`imports/read`), mandadas de volta nos pedidos seguintes; nulo, a leitura as acha.</summary>
public sealed record JsonImportOptions(IReadOnlyList<string>? Keys) : ImportReaderOptions
{
    public override string ToString()
        => nameof(JsonImportOptions);
}

/// <summary>RN-IMPORT-006: o XLSX. `Sheet` nulo é a primeira planilha que não é oculta.</summary>
public sealed record XlsxImportOptions(string? Sheet, bool Header, bool SkipEmptyLines) : ImportReaderOptions
{
    public static XlsxImportOptions Default { get; } = new(null, Header: true, SkipEmptyLines: true);

    public override string ToString()
        => nameof(XlsxImportOptions);
}

/// <summary>RN-IMPORT-004: os nomes das codificações do pedido e da resposta.</summary>
public static class ImportEncodings
{
    public const string Auto = "auto";
    public const string Utf8 = "utf-8";
    public const string Utf16Le = "utf-16le";
    public const string Utf16Be = "utf-16be";
    public const string Windows1252 = "windows-1252";
    public const string Latin1 = "iso-8859-1";

    public static IReadOnlyList<string> All { get; } = [Auto, Utf8, Utf16Le, Utf16Be, Windows1252, Latin1];
}

/// <summary>RN-IMPORT-007 e 010: o separador decimal do texto que vai a uma coluna de número.</summary>
public enum EImportDecimal
{
    /// <summary>"Ponto (1234.56)", o padrão: nenhum separador de milhar.</summary>
    Point,

    /// <summary>"Vírgula (1234,56)": o ponto só com "Aceitar o ponto como separador de milhar".</summary>
    Comma
}

/// <summary>RN-IMPORT-007 e 010: a ordem da data no texto que vai a uma coluna de data, de data e hora ou de hora.</summary>
public enum EImportDates
{
    /// <summary>"aaaa-mm-dd", o padrão.</summary>
    Iso,

    /// <summary>"dd/mm/aaaa".</summary>
    DayMonthYear
}

/// <summary>RN-IMPORT-007: os formatos dos valores (`values` do pedido). Valem só para o texto: o número, a data e o lógico que o JSON e o XLSX trazem como tais já vêm na forma canônica.</summary>
public sealed record ImportValueFormats(EImportDecimal Decimal, bool ThousandsDot, EImportDates Dates)
{
    public static ImportValueFormats Default { get; } = new(EImportDecimal.Point, false, EImportDates.Iso);
}

/// <summary>
/// RN-IMPORT-004 e 010: o que o leitor diz de cada valor, para a conversão decidir o nulo, a proteção contra fórmula e as pontas. O CSV e o TSV dizem se o
/// campo veio entre aspas; o JSON e o XLSX, se o valor é texto (que passa pelos formatos da etapa Arquivo) ou já vem na forma canônica.
/// </summary>
public enum EImportValueSource
{
    /// <summary>O campo do CSV sem aspas: o único que o "Texto do nulo" torna nulo (afora o texto do nulo com o separador ou a aspa).</summary>
    Plain,

    /// <summary>O campo do CSV que começou por aspas.</summary>
    Quoted,

    /// <summary>O texto (string) do JSON e o texto de uma célula do XLSX.</summary>
    Text,

    /// <summary>O número, o `true` e o `false` do JSON e o número, a data e o lógico de uma célula do XLSX, já na forma canônica.</summary>
    Canonical,

    /// <summary>O objeto ou a lista dentro de um valor do JSON, no texto JSON como está no arquivo.</summary>
    Json,

    /// <summary>O nulo do arquivo: o `null` do JSON, a célula vazia do XLSX, o valor que falta na linha com menos valores que o cabeçalho.</summary>
    Null,

    /// <summary>
    /// RN-IMPORT-026: o texto de um valor da origem da cópia (o do servidor PostgreSQL, ou o que o Prism escreve do valor do driver da IBM), já na forma
    /// canônica: o nulo é só o da origem, e o texto do nulo, o vazio, a proteção contra fórmula e as pontas não valem.
    /// </summary>
    Copied
}

/// <summary>Um valor do arquivo, como o leitor o entrega, antes de qualquer conversão. Leva dado da pessoa: o `ToString()` não o imprime (RN-LOG-001).</summary>
public readonly record struct ImportValue(string? Text, EImportValueSource Source)
{
    public static ImportValue Null { get; } = new(null, EImportValueSource.Null);

    public override string ToString()
        => nameof(ImportValue);
}

/// <summary>RN-IMPORT-004 a 006 e 016: o problema de uma linha na leitura (os valores a mais, o item que não é objeto, o erro do Excel), com a coluna do arquivo quando é de um valor.</summary>
public sealed record ImportProblem(string Message, int? Column = null)
{
    public override string ToString()
        => nameof(ImportProblem);
}

/// <summary>
/// Uma linha de dados do arquivo, com um valor por coluna do arquivo. `Line` é a linha do arquivo (a física em que o registro começa, no CSV), o número
/// da linha da planilha (no XLSX) ou o número do item na lista, a partir de 1 (no JSON). `Short` diz que faltavam valores e que eles foram completados
/// com nulo (RN-IMPORT-004).
/// </summary>
public sealed record ImportRecord(long Line, IReadOnlyList<ImportValue> Values, ImportProblem? Problem, bool Short)
{
    public override string ToString()
        => nameof(ImportRecord);
}

/// <summary>As notas da seção 36: o motivo de `IMPORT_FILE_UNREADABLE`.</summary>
public enum EImportReadReason
{
    Encoding,
    Format,
    Sheet,
    Limits,
    System
}

/// <summary>
/// RN-IMPORT-004 a 008 e 016: a leitura que não segue, com a frase da regra (sem caminho) e a linha quando se sabe. `ValueTooLarge` é o valor acima de 64
/// MiB ou a linha acima de 256 MiB (`IMPORT_VALUE_TOO_LARGE` no trabalho; nas prévias, `IMPORT_FILE_UNREADABLE` com o motivo `limits`), com a coluna do
/// arquivo quando é de um valor. `Canceled` é a leitura interrompida pelo cancelamento pedido, que não é uma recusa do arquivo: quem lê decide o que
/// ela é (a prévia devolve o cancelamento da requisição; o trabalho da importação fica `canceled`).
/// </summary>
public sealed record ImportReadFailure(EImportReadReason Reason, string Message, long? Line = null, bool ValueTooLarge = false, string? Column = null)
{
    public bool Canceled { get; init; }

    public override string ToString()
        => nameof(ImportReadFailure);
}

/// <summary>RN-IMPORT-004: a codificação que a leitura usou, e se o arquivo começa pelo BOM dela.</summary>
public sealed record ImportEncodingInfo(string Name, bool Bom);

/// <summary>RN-IMPORT-006: uma planilha da pasta de trabalho, na ordem dela.</summary>
public sealed record ImportSheetInfo(string Name, bool Hidden)
{
    public override string ToString()
        => nameof(ImportSheetInfo);
}

/// <summary>
/// RN-IMPORT-007: o que a leitura achou: a codificação e o separador (CSV e TSV), a chave da lista (JSON), as planilhas e a lida (XLSX) e os nomes das
/// colunas do arquivo, todos. O que não é do formato é nulo.
/// </summary>
public sealed record ImportReadInfo(ImportEncodingInfo? Encoding, string? Delimiter, string? ListKey, IReadOnlyList<ImportSheetInfo>? Sheets, string? Sheet, IReadOnlyList<string> Columns)
{
    public override string ToString()
        => nameof(ImportReadInfo);
}

/// <summary>RN-IMPORT-008 e 017: por que o arquivo da importação não abre: ele não está na pasta (`IMPORT_FILE_MISSING`), passa de 2 GiB (`IMPORT_FILE_TOO_LARGE`) ou o sistema não deixa lê-lo.</summary>
public enum EImportFileRefusal
{
    Missing,
    TooLarge,
    Unreadable
}

/// <param name="Size">O tamanho do arquivo grande demais, em bytes.</param>
/// <param name="Reason">A frase do arquivo que o sistema não deixa ler, sem o caminho.</param>
public sealed record ImportFileRefusal(EImportFileRefusal Kind, long Size = 0, string? Reason = null)
{
    public override string ToString()
        => nameof(ImportFileRefusal);
}
