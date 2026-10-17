using Prism.Infrastructure.Transfers.Models;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-004 e seção 6: os formatos da exportação de dados, pelo nome que a rota recebe (`format`), e o escritor de cada um. O formato da lista
/// que ainda não tem escritor (XML, DbUnit e XLSX, nesta entrega) é recusado ao começar, no campo `format`, até ganhar o dele.
/// </summary>
public static class ExportFormats
{
    public const string Csv = "csv";
    public const string SourceCode = "sourceCode";
    public const string DbUnit = "dbUnit";
    public const string Html = "html";
    public const string Json = "json";
    public const string Markdown = "markdown";
    public const string Sql = "sql";
    public const string Txt = "txt";
    public const string Xlsx = "xlsx";
    public const string Xml = "xml";

    /// <summary>Na ordem da lista do assistente (RN-EXPORT-004).</summary>
    public static IReadOnlyList<string> All { get; } = [Csv, SourceCode, DbUnit, Html, Json, Markdown, Sql, Txt, Xlsx, Xml];

    private static readonly Dictionary<string, Func<ExportWriterContext, Stream, ExportWriter>> Writers = new(StringComparer.Ordinal)
    {
        [Csv] = (context, output) => new CsvExportWriter(context, output),
        [Txt] = (context, output) => new TxtExportWriter(context, output),
        [Html] = (context, output) => new HtmlExportWriter(context, output),
        [Markdown] = (context, output) => new MarkdownExportWriter(context, output),
        [Json] = (context, output) => new JsonExportWriter(context, output),
        [SourceCode] = (context, output) => new SourceCodeExportWriter(context, output),
        [Sql] = (context, output) => new SqlExportWriter(context, output)
    };

    public static bool Exists(string? format)
        => format is not null && All.Contains(format, StringComparer.Ordinal);

    /// <summary>RN-EXPORT-014: o formato é texto (vai para a área de transferência, leva BOM, se compacta em .zip). Só o XLSX não é.</summary>
    public static bool IsText(string format)
        => format != Xlsx;

    /// <summary>O formato já tem escritor nesta versão da API.</summary>
    public static bool IsWritten(string format)
        => Writers.ContainsKey(format);

    internal static ExportWriter Create(string format, ExportWriterContext context, Stream output)
        => Writers[format](context, output);
}
