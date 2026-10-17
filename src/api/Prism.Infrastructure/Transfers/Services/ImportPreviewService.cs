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
        var limited = await connection.LimitLockWaitAsync(cancellationToken);
        if (limited.IsFailure)
            return new ImportPreviewFailure(EImportPreviewFailure.Database, limited.Error.Message, Database: limited.Error);

        var described = await connection.DescribeImportTargetAsync(request.Schema, request.Table, cancellationToken);
        if (described.IsFailure)
            return new ImportPreviewFailure(EImportPreviewFailure.Database, described.Error.Message, Database: described.Error);

        var name = $"{request.Schema}.{request.Table}";
        if (described.Value is not { } catalog)
            return new ImportPreviewFailure(EImportPreviewFailure.TableNotFound, $"A tabela {name} não existe mais.");

        if (NotATableReason(request.Settings.Engine, catalog.Table.Kind) is { } kind)
            return new ImportPreviewFailure(EImportPreviewFailure.NotATable, $"Só uma tabela recebe linhas: {name} {kind}.");

        var table = Table(request.Settings.Engine, catalog);
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
                return Result.Failure<(ImportReadInfo, IReadOnlyList<ImportRecord>, ImportValueRules), ImportPreviewFailure>(Unreadable(started.Error));

            using var reader = started.Value;
            var records = new List<ImportRecord>(ImportPreviews.Rows);
            while (records.Count < ImportPreviews.Rows)
            {
                var next = reader.Next(cancellationToken);
                if (next.IsFailure)
                    return Unreadable(next.Error);

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

    /// <summary>
    /// RN-IMPORT-009, nos termos da edição (RN-EDIT-002): o que não é uma tabela comum. A tabela particionada do PostgreSQL é uma tabela; o apelido do Db2,
    /// a tabela temporária global, a tabela tipada e a tabela externa do Informix "não são uma tabela comum".
    /// </summary>
    private static string? NotATableReason(EDatabaseEngine engine, string kind)
        => kind switch
        {
            "table" => null,
            "view" => "é uma visão",
            "materializedView" => "é uma visão materializada",
            "foreign" when engine == EDatabaseEngine.PostgreSql => "é uma tabela estrangeira",
            _ => "não é uma tabela comum"
        };

    /// <summary>RN-IMPORT-009 e 012: a tabela como a prévia a mostra: as colunas com a classe de cada uma e as chaves de outras tabelas que apontam para ela.</summary>
    private static ImportTargetTable Table(EDatabaseEngine engine, ImportCatalog catalog)
    {
        var columns = catalog.Table.Columns.OrderBy(column => column.Position).Select(column => ImportColumns.Of(engine, column, catalog.BaseTypes.GetValueOrDefault(column.Name))).ToList();
        var references = catalog.ReferencedBy
            .Where(reference => !(reference.ReferencingSchema == catalog.Table.Schema && reference.ReferencingTable == catalog.Table.Name))
            .Select(reference => new ImportReference(reference.ReferencingSchema, reference.ReferencingTable, reference.OnDelete ?? ForeignKeyRule.NoAction))
            .ToList();

        return new ImportTargetTable(catalog.Table.Schema, catalog.Table.Name, catalog.Table.OneAtATime, columns, references);
    }

    private static ImportPreviewFailure Unreadable(ImportReadFailure failure)
        => new(EImportPreviewFailure.Unreadable, failure.Message, Read: failure);

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
