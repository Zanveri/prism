using CSharpFunctionalExtensions;
using Prism.Infrastructure.Transfers.Imports;
using System.Text.Json;
using System.Xml;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Transfers.Readers;

/// <summary>
/// RN-IMPORT-017: um leitor de arquivo da importação, em fluxo: abre (o cabeçalho, a codificação, as chaves do JSON, as partes do XLSX) e entrega uma
/// linha de dados por vez, com a memória de uma linha. Quem o cria é a prévia (as rotas `imports/read` e `imports/preview`) e, depois, o trabalho da
/// importação, que lê o mesmo arquivo do começo ao fim pelo mesmo caminho.
///
/// É uma integração com o disco e com o conteúdo do arquivo, que é de fora: o <see cref="Send{T}"/> tem o único `try` dela. As recusas da leitura (a
/// codificação inválida, a aspa que não fecha, os limites) saem como <see cref="ImportReadException"/> do fundo do leitor e voltam daqui como
/// <see cref="ImportReadFailure"/>, como as exceções dos leitores do .NET (o `JsonException` do `Utf8JsonReader`, o `XmlException` do `XmlReader`, o
/// `InvalidDataException` do `ZipArchive`) e a falha do disco. O cancelamento volta como a falha marcada `Canceled`, para o trabalho da importação, que
/// roda fora de uma requisição, terminar como cancelado sem uma exceção solta.
/// </summary>
internal abstract class ImportReader(Stream stream, ILogger logger) : IDisposable
{
    /// <summary>RN-IMPORT-008: as colunas do arquivo, no máximo (o máximo do Excel).</summary>
    public const int MaxColumns = 16384;

    /// <summary>RN-IMPORT-008: o nome de uma coluna do arquivo tem até 256 caracteres.</summary>
    public const int MaxColumnNameLength = 256;

    /// <summary>RN-IMPORT-008 e RN-EXPORT-017: cada valor tem até 64 MiB (o texto em bytes de UTF-8).</summary>
    public const long MaxValueBytes = 64L * 1024 * 1024;

    /// <summary>RN-IMPORT-008 e RN-EXPORT-017: cada linha tem até 256 MiB de valores somados.</summary>
    public const long MaxRowBytes = 256L * 1024 * 1024;

    private readonly ILogger _logger = logger.ForContext<ImportReader>();

    protected Stream Stream { get; } = stream;

    /// <summary>O que a leitura achou: a codificação, o separador, a chave da lista, as planilhas e os nomes das colunas do arquivo.</summary>
    public ImportReadInfo Info { get; protected set; } = new(null, null, null, null, null, []);

    public IReadOnlyList<string> Columns => Info.Columns;

    /// <summary>RN-IMPORT-014: o que já foi lido, em bytes (no XLSX, os descompactados da planilha), para o progresso.</summary>
    public abstract long Position { get; }

    /// <summary>RN-IMPORT-014: o tamanho do que se lê (no XLSX, o tamanho descompactado que o .zip declara para a planilha).</summary>
    public abstract long Size { get; }

    /// <summary>RN-IMPORT-020: as linhas vazias puladas até aqui (`skippedLines`).</summary>
    public long SkippedLines { get; protected set; }

    /// <summary>RN-IMPORT-020: as células com fórmula sem resultado guardado lidas até aqui, que chegaram vazias (`formulasWithoutValue`, XLSX).</summary>
    public long FormulasWithoutValue { get; protected set; }

    /// <summary>
    /// Abre o leitor do formato sobre o arquivo, já com o que vem antes da primeira linha de dados lido. O fluxo é do leitor: ele o descarta. Na
    /// recusa, o leitor já foi descartado.
    /// </summary>
    public static Result<ImportReader, ImportReadFailure> Open(string format, ImportReaderOptions options, Stream stream, ILogger logger, CancellationToken cancellationToken)
    {
        ImportReader reader = (format, options) switch
        {
            (ImportFormats.Csv or ImportFormats.Tsv, CsvImportOptions csv) => new CsvImportReader(stream, csv, format == ImportFormats.Tsv, logger),
            (ImportFormats.Json, JsonImportOptions json) => new JsonImportReader(stream, json, logger),
            (ImportFormats.Xlsx, XlsxImportOptions xlsx) => new XlsxImportReader(stream, xlsx, logger),
            _ => throw new InvalidOperationException($"O formato {format} não tem leitor com as opções {options.GetType().Name}.")
        };

        var begun = reader.Send(() =>
        {
            reader.Begin(cancellationToken);

            return true;
        });

        if (begun.IsSuccess)
            return reader;

        reader.Dispose();

        return begun.Error;
    }

    /// <summary>A linha de dados seguinte, ou nula no fim do arquivo.</summary>
    public Result<ImportRecord?, ImportReadFailure> Next(CancellationToken cancellationToken)
        => Send(() => ReadNext(cancellationToken));

    public virtual void Dispose()
        => Stream.Dispose();

    /// <summary>O que vem antes da primeira linha de dados: a codificação, o separador, o cabeçalho, a forma do JSON, as partes da pasta de trabalho.</summary>
    protected abstract void Begin(CancellationToken cancellationToken);

    protected abstract ImportRecord? ReadNext(CancellationToken cancellationToken);

    /// <summary>
    /// RN-IMPORT-008: a recusa do valor acima de 64 MiB, com a linha e a coluna do arquivo, nas palavras de cada formato: `place` é "da linha 1.234 do
    /// arquivo", "do item 1.234 da lista" ou "da linha 1.234 da planilha Pedidos".
    /// </summary>
    protected static ImportReadException ValueTooLarge(string place, long line, string column)
        => new(new ImportReadFailure(EImportReadReason.Limits, $"Um valor {place}, coluna {column}, passa de 64 MiB, e o Prism não o importa.", line, ValueTooLarge: true, Column: column));

    /// <summary>RN-IMPORT-008: a recusa da linha acima de 256 MiB de valores; `row` é "A linha 1.234 do arquivo", "O item 1.234 da lista" ou "A linha 1.234 da planilha Pedidos".</summary>
    protected static ImportReadException RowTooLarge(string row, bool feminine, long line)
        => new(new ImportReadFailure(EImportReadReason.Limits, $"{row} passa de 256 MiB de valores, e o Prism não {(feminine ? "a" : "o")} importa.", line, ValueTooLarge: true));

    protected static ImportReadException TooManyColumns(long? line)
        => new(new ImportReadFailure(EImportReadReason.Limits, $"O arquivo tem mais de {ImportText.Thousands(MaxColumns)} colunas.", line));

    protected static ImportReadException ColumnNameTooLong(int position)
        => new(new ImportReadFailure(EImportReadReason.Limits, $"O nome da coluna {ImportText.Thousands(position + 1)} do arquivo passa de {MaxColumnNameLength} caracteres."));

    /// <summary>
    /// O único `try` da leitura. O log recebe a classe do erro e o `HResult`, nunca a mensagem, que pode trazer o caminho ou um pedaço do conteúdo do
    /// arquivo (RN-LOG-001); o que não é do arquivo nem do disco (um defeito do leitor) leva também a pilha.
    /// </summary>
    private Result<T, ImportReadFailure> Send<T>(Func<T> call)
    {
        try
        {
            return call();
        }
        catch (OperationCanceledException)
        {
            return new ImportReadFailure(EImportReadReason.System, "A leitura do arquivo foi cancelada.") { Canceled = true };
        }
        catch (Exception exception)
        {
            var failure = FailureOf(exception);
            if (exception is ImportReadException)
                return failure;

            if (exception is IOException or UnauthorizedAccessException or JsonException or XmlException or InvalidDataException)
                _logger.Information("A leitura do arquivo da importação parou ({ExceptionType}, HResult {HResult}).", exception.GetType().Name, exception.HResult);
            else
                _logger.Error("A leitura do arquivo da importação falhou ({ExceptionType}).{NewLine}{StackTrace}", exception.GetType().Name, Environment.NewLine, exception.StackTrace);

            return failure;
        }
    }

    private ImportReadFailure FailureOf(Exception exception)
        => exception switch
        {
            ImportReadException read => read.Failure,
            JsonException json => JsonImportReader.Malformed(json),
            XmlException => new ImportReadFailure(EImportReadReason.Format, "A planilha tem uma parte que não é um XML válido, e o Prism não a lê. No Excel, salve-a de novo como .xlsx."),
            InvalidDataException => new ImportReadFailure(EImportReadReason.Format, "O .xlsx está estragado: o Prism não consegue descompactá-lo. No Excel, salve-o de novo como .xlsx."),
            IOException or UnauthorizedAccessException => new ImportReadFailure(EImportReadReason.System, $"Não foi possível ler o arquivo copiado (código {exception.HResult & 0xFFFF})."),
            _ => new ImportReadFailure(EImportReadReason.System, $"Não foi possível ler o arquivo ({exception.GetType().Name}).")
        };
}

/// <summary>Uma recusa da leitura, do fundo do leitor até o <c>Send</c> dele, que a devolve como <see cref="ImportReadFailure"/>. Não sai do leitor.</summary>
internal sealed class ImportReadException(ImportReadFailure failure) : Exception(nameof(ImportReadException))
{
    public ImportReadFailure Failure { get; } = failure;
}

