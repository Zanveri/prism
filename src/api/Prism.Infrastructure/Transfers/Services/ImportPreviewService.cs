using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Clients;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Readers;
using System.Runtime.InteropServices;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Transfers.Services;

/// <summary>Por que uma prévia da importação não sai: o arquivo, a leitura dele, o banco, a tabela de destino ou o mapeamento pedido.</summary>
public enum EImportPreviewFailure
{
    FileMissing,
    FileTooLarge,
    Unreadable,
    Database,
    TableNotFound,
    NotATable,
    MappingInvalid
}

/// <summary>
/// A recusa de uma prévia da importação, com o que a rota precisa para traduzi-la: a frase, a leitura que não seguiu (com o motivo e a linha), a falha do
/// banco (com a mensagem como veio), o campo do mapeamento recusado e o tamanho do arquivo grande demais.
/// </summary>
public sealed record ImportPreviewFailure(EImportPreviewFailure Kind, string Message, ImportReadFailure? Read = null, DatabaseFailure? Database = null, string? Field = null, long Size = 0)
{
    public override string ToString()
        => nameof(ImportPreviewFailure);
}

/// <summary>RN-IMPORT-009 a 011: o pedido da prévia convertida, com a conexão de destino já lida do cofre.</summary>
public sealed record ImportPreviewRequest(Guid FileID, string Format, ImportReaderOptions Options, ImportValueFormats Formats, ConnectionSettings Settings, string Schema, string Table, IReadOnlyList<ImportMappingEntry>? Mapping)
{
    public override string ToString()
        => nameof(ImportPreviewRequest);
}

/// <summary>RN-IMPORT-024: o pedido da prévia da cópia: a conexão de destino já lida do cofre, a tabela, os nomes das colunas pedidas da origem e o mapeamento, quando vem.</summary>
public sealed record CopyPreviewRequest(ConnectionSettings Settings, string Schema, string Table, IReadOnlyList<string> SourceColumns, IReadOnlyList<ImportMappingEntry>? Mapping)
{
    public override string ToString()
        => nameof(CopyPreviewRequest);
}

/// <summary>RN-IMPORT-024: a prévia da cópia: a tabela de destino e o mapeamento (o pedido, conferido, ou o sugerido pelo nome).</summary>
public sealed record CopyPreview(ImportTargetTable Table, IReadOnlyList<ImportMappingEntry> Mapping)
{
    public override string ToString()
        => nameof(CopyPreview);
}

/// <summary>
/// RN-IMPORT-007 e 009 a 011: as prévias da importação (as rotas `imports/read` e `imports/preview`). Leem o arquivo da pasta `transfers` pelo
/// identificador, em fluxo, sem mudá-lo nem tomá-lo; a prévia convertida lê o catálogo da tabela numa conexão à parte, que abre e fecha nela.
/// </summary>
public interface IImportPreviewService
{
    /// <summary>RN-IMPORT-008 e 017: a conferência do arquivo, sem lê-lo: nula quando ele existe e tem até 2 GiB.</summary>
    ImportFileRefusal? CheckFile(Guid fileID);

    /// <summary>RN-IMPORT-007: a prévia do arquivo: o que a leitura achou e as primeiras 20 linhas, como foram lidas.</summary>
    Task<Result<ImportFilePreview, ImportPreviewFailure>> ReadAsync(Guid fileID, string format, ImportReaderOptions options, CancellationToken cancellationToken);

    /// <summary>RN-IMPORT-009 a 011: a tabela, o mapeamento (o pedido, conferido, ou o automático) e as primeiras 20 linhas convertidas.</summary>
    Task<Result<ImportConvertedPreview, ImportPreviewFailure>> PreviewAsync(ImportPreviewRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// RN-IMPORT-024: a prévia da cópia (`copies/preview`): o catálogo da tabela de destino, numa conexão à parte, e o mapeamento (o pedido, conferido, ou
    /// o automático pelo nome das colunas da origem, que sempre existe). Não lê a origem.
    /// </summary>
    Task<Result<CopyPreview, ImportPreviewFailure>> PreviewCopyAsync(CopyPreviewRequest request, CancellationToken cancellationToken);
}

internal sealed class ImportPreviewService(IEnumerable<IDatabaseClient> clients, IImportFileClient files, ILogger logger) : IImportPreviewService
{
    private readonly Dictionary<EDatabaseEngine, IDatabaseClient> _clients = clients.ToDictionary(client => client.Engine);
    private readonly ILogger _logger = logger.ForContext<ImportPreviewService>();

    public ImportFileRefusal? CheckFile(Guid fileID)
        => files.Check(fileID);

    public async Task<Result<ImportFilePreview, ImportPreviewFailure>> ReadAsync(Guid fileID, string format, ImportReaderOptions options, CancellationToken cancellationToken)
    {
        var read = await ReadFileAsync(fileID, format, options, cancellationToken);
        if (read.IsFailure)
            return read.Error;

        return ImportPreviews.FileRows(read.Value.Info, read.Value.Records, read.Value.Rules);
    }

    public async Task<Result<ImportConvertedPreview, ImportPreviewFailure>> PreviewAsync(ImportPreviewRequest request, CancellationToken cancellationToken)
    {
        var read = await ReadFileAsync(request.FileID, request.Format, request.Options, cancellationToken);
        if (read.IsFailure)
            return read.Error;

        var (info, records, rules) = read.Value;
        var opened = await ConnectAsync(request.Settings, cancellationToken);
        if (opened.IsFailure)
            return new ImportPreviewFailure(EImportPreviewFailure.Database, opened.Error.Message, Database: opened.Error);

        await using var connection = opened.Value;
        var described = await DescribeAsync(connection, request.Settings.Engine, request.Schema, request.Table, cancellationToken);
        if (described.IsFailure)
            return described.Error;

        var table = described.Value;
        var mapping = request.Mapping ?? ImportMapping.Suggest(info.Columns, ByName(request.Options), table.Columns);
        if (request.Mapping is not null && ImportMapping.Refusal(request.Mapping, info.Columns.Count, table.Columns) is { } refusal)
            return new ImportPreviewFailure(EImportPreviewFailure.MappingInvalid, refusal.Message, Field: refusal.Field);

        var (rows, converted) = ImportPreviews.ConvertedRows(request.Settings.Engine, records, mapping, table.Columns, rules, request.Formats);
        var types = mapping.Select(entry => table.Columns.First(column => column.Name == entry.Target).Type).ToList();
        var checkedRows = await connection.CheckImportCastsAsync(types, [.. converted.Select(row => (IReadOnlyList<object?>)[.. row.Select(value => value?.Parameter.Value)])], cancellationToken);
        if (checkedRows.IsFailure)
            return new ImportPreviewFailure(EImportPreviewFailure.Database, checkedRows.Error.Message, Database: checkedRows.Error);

        var (shown, fitted) = ImportPreviews.Fit(ImportPreviews.WithDatabaseProblems(rows, checkedRows.Value), mapping.Count);
        _logger.Information("Prévia da importação lida: formato {Format}, {Rows} linhas, {Columns} colunas mapeadas.", request.Format, records.Count, mapping.Count);

        return new ImportConvertedPreview(table, info.Columns, mapping, shown, fitted);
    }

    public async Task<Result<CopyPreview, ImportPreviewFailure>> PreviewCopyAsync(CopyPreviewRequest request, CancellationToken cancellationToken)
    {
        var opened = await ConnectAsync(request.Settings, cancellationToken);
        if (opened.IsFailure)
            return new ImportPreviewFailure(EImportPreviewFailure.Database, opened.Error.Message, Database: opened.Error);

        await using var connection = opened.Value;
        var described = await DescribeAsync(connection, request.Settings.Engine, request.Schema, request.Table, cancellationToken);
        if (described.IsFailure)
            return described.Error;

        var table = described.Value;
        if (request.Mapping is not null && ImportMapping.Refusal(request.Mapping, request.SourceColumns.Count, table.Columns) is { } refusal)
            return new ImportPreviewFailure(EImportPreviewFailure.MappingInvalid, refusal.Message, Field: refusal.Field);

        var mapping = request.Mapping ?? ImportMapping.Suggest(request.SourceColumns, byName: true, table.Columns);
        _logger.Information("Prévia da cópia lida: {Columns} colunas da origem, {Mapped} mapeadas.", request.SourceColumns.Count, mapping.Count);

        return new CopyPreview(table, mapping);
    }

    /// <summary>
    /// RN-IMPORT-009 e 024: a tabela de destino, numa conexão à parte, com o prazo de trava: a que não existe e a que não é tabela, nos termos da edição
    /// (a visão, a materializada, a estrangeira, e "não é uma tabela comum").
    /// </summary>
    private static async Task<Result<ImportTargetTable, ImportPreviewFailure>> DescribeAsync(IDatabaseConnection connection, EDatabaseEngine engine, string schema, string table, CancellationToken cancellationToken)
    {
        var limited = await connection.LimitLockWaitAsync(cancellationToken);
        if (limited.IsFailure)
            return new ImportPreviewFailure(EImportPreviewFailure.Database, limited.Error.Message, Database: limited.Error);

        var described = await connection.DescribeImportTargetAsync(schema, table, cancellationToken);
        if (described.IsFailure)
            return new ImportPreviewFailure(EImportPreviewFailure.Database, described.Error.Message, Database: described.Error);

        var name = $"{schema}.{table}";
        if (described.Value is not { } catalog)
            return new ImportPreviewFailure(EImportPreviewFailure.TableNotFound, $"A tabela {name} não existe mais.");

        if (ImportTargets.NotATableReason(engine, catalog.Table.Kind) is { } kind)
            return new ImportPreviewFailure(EImportPreviewFailure.NotATable, $"Só uma tabela recebe linhas: {name} {kind}.");

        return ImportTargets.TableOf(engine, catalog);
    }

    /// <summary>
    /// O arquivo aberto, o leitor e as primeiras 20 linhas de dados. A leitura é síncrona (o arquivo é local, e a codificação automática e as chaves do JSON
    /// o percorrem inteiro): roda fora da thread da requisição, que a interrompe pelo token; o leitor fecha o arquivo em qualquer saída.
    /// </summary>
    private async Task<Result<(ImportReadInfo Info, IReadOnlyList<ImportRecord> Records, ImportValueRules Rules), ImportPreviewFailure>> ReadFileAsync(Guid fileID, string format, ImportReaderOptions options, CancellationToken cancellationToken)
    {
        var opened = files.Open(fileID);
        if (opened.IsFailure)
            return FileFailure(opened.Error);

        return await Task.Run(() =>
        {
            var started = ImportReader.Open(format, options, opened.Value, _logger, cancellationToken);
            if (started.IsFailure)
                return Result.Failure<(ImportReadInfo, IReadOnlyList<ImportRecord>, ImportValueRules), ImportPreviewFailure>(Unreadable(started.Error, cancellationToken));

            using var reader = started.Value;
            var records = new List<ImportRecord>(ImportPreviews.Rows);
            while (records.Count < ImportPreviews.Rows)
            {
                var next = reader.Next(cancellationToken);
                if (next.IsFailure)
                    return Unreadable(next.Error, cancellationToken);

                if (next.Value is not { } record)
                    break;

                records.Add(record);
            }

            var rules = options is CsvImportOptions csv ? ImportValueRules.Of(csv, reader.Info.Delimiter) : ImportValueRules.None;

            return Result.Success<(ImportReadInfo, IReadOnlyList<ImportRecord>, ImportValueRules), ImportPreviewFailure>((reader.Info, records, rules));
        }, CancellationToken.None);
    }

    /// <summary>RN-IMPORT-009: com cabeçalho, e no JSON, o automático é pelo nome; sem cabeçalho, pela posição.</summary>
    private static bool ByName(ImportReaderOptions options)
        => options switch
        {
            CsvImportOptions csv => csv.Header,
            XlsxImportOptions xlsx => xlsx.Header,
            _ => true
        };

    private static ImportPreviewFailure Unreadable(ImportReadFailure failure)
        => new(EImportPreviewFailure.Unreadable, failure.Message, Read: failure);

    /// <summary>A leitura que o cancelamento da requisição interrompeu não é uma recusa do arquivo: o cancelamento sobe, como sempre subiu.</summary>
    private static ImportPreviewFailure Unreadable(ImportReadFailure failure, CancellationToken cancellationToken)
    {
        if (failure.Canceled)
            cancellationToken.ThrowIfCancellationRequested();

        return Unreadable(failure);
    }

    private static ImportPreviewFailure FileFailure(ImportFileRefusal refusal)
        => refusal.Kind switch
        {
            EImportFileRefusal.Missing => new ImportPreviewFailure(EImportPreviewFailure.FileMissing, "O arquivo escolhido não está mais com o Prism. Escolha o arquivo de novo."),
            EImportFileRefusal.TooLarge => new ImportPreviewFailure(EImportPreviewFailure.FileTooLarge, ImportText.TooLarge(refusal.Size), Size: refusal.Size),
            _ => Unreadable(new ImportReadFailure(EImportReadReason.System, refusal.Reason ?? "Não foi possível ler o arquivo copiado."))
        };

    /// <summary>RN-ABERTO-006: como no registro de sessões, o banco sem client é o Db2 ou o Informix numa plataforma para a qual a IBM não publica o driver.</summary>
    private Task<Result<IDatabaseConnection, DatabaseFailure>> ConnectAsync(ConnectionSettings settings, CancellationToken cancellationToken)
        => _clients.TryGetValue(settings.Engine, out var client)
            ? client.OpenAsync(settings, cancellationToken)
            : Task.FromResult(Result.Failure<IDatabaseConnection, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ConnectionFailed, $"O Prism para {RuntimeInformation.RuntimeIdentifier} ainda não conecta em Db2 e Informix: a IBM não publica o driver para ela.")));
}
