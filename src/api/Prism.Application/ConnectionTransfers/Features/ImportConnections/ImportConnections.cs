using CSharpFunctionalExtensions;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.ConnectionTransfers.Models.Dtos;
using Prism.Application.ConnectionTransfers.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.ConnectionFiles.Services;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Services;
using ILogger = Serilog.ILogger;

namespace Prism.Application.ConnectionTransfers.Features.ImportConnections;

/// <summary>
/// RN-TRANSF-014: o arquivo, a senha de exportação, o lugar (`TargetFolderID` nulo é a raiz), as chaves marcadas do arquivo (de pastas e de conexões; as
/// pastas do caminho de cada uma vão sozinhas), a escolha dos conflitos (`rename`, o padrão, ou `skip`) e a caixa "Manter as consultas de verificação do
/// arquivo" (`KeepVerificationQueries`, falsa quando ausente ou nula). A API lê o arquivo de novo e confere tudo de novo: não guarda nada da prévia.
/// </summary>
public sealed record ImportConnectionsCommand : IRequest<Result<ImportedConnectionsDto, ApiErrorDto>>
{
    public string Content { get; init; } = string.Empty;
    public string Passphrase { get; init; } = string.Empty;
    public Guid? TargetFolderID { get; init; }
    public IReadOnlyList<string?>? Items { get; init; }
    public string? OnConflict { get; init; }
    public bool? KeepVerificationQueries { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria o arquivo e a senha de exportação.</summary>
    public override string ToString()
        => nameof(ImportConnectionsCommand);
}

internal sealed class ImportConnectionsHandler(IVaultService vaultService, IConnectionFileService fileService, IConnectionImportRepository importRepository, TimeProvider timeProvider, ILogger logger, IJournalRecorder? journal = null) : IRequestHandler<ImportConnectionsCommand, Result<ImportedConnectionsDto, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<ImportConnectionsHandler>();

    public async Task<Result<ImportedConnectionsDto, ApiErrorDto>> Handle(ImportConnectionsCommand request, CancellationToken cancellationToken)
    {
        var startedAt = timeProvider.GetUtcNow();
        var generation = vaultService.Generation;

        var analysis = await ImportFiles.OpenAsync(fileService, request.Content, request.Passphrase, cancellationToken);
        if (analysis.IsFailure)
            return Refuse(analysis.Error);

        var items = request.Items ?? [];
        if (items.Any(key => key is null || (!analysis.Value.FoldersByKey.ContainsKey(key) && !analysis.Value.ConnectionsByKey.ContainsKey(key))))
            return Refuse(TransferErrors.UnknownItem());

        var selected = items
            .Where(key => analysis.Value.FoldersByKey.TryGetValue(key!, out var folder) ? folder.Candidate is not null : analysis.Value.ConnectionsByKey[key!].Candidate is not null)
            .Select(key => key!)
            .ToHashSet(StringComparer.Ordinal);

        var keep = request.KeepVerificationQueries == true;
        var imported = await importRepository.Import(analysis.Value, request.TargetFolderID, selected, TransferRules.ConflictOf(request.OnConflict), keep, generation, startedAt.UtcDateTime, cancellationToken);
        if (imported.IsFailure)
            return Refuse(imported.Error);

        var placed = imported.Value;

        _logger.Information(
            "Importação de conexões: {CreatedFolders} pastas criadas, {MergedFolders} juntadas às que existiam, {CreatedConnections} conexões criadas, {Renamed} com outro nome, {Skipped} deixadas de fora, {Invalid} itens não importáveis, {Strengthened} com a proteção ou o ambiente gravados, {QueriesKept} consultas de verificação próprias mantidas e {QueriesReplaced} trocadas pela do banco; pastas {FolderIDs} e conexões {ConnectionIDs}.",
            placed.CreatedFolderIDs.Count, placed.MergedFolders, placed.CreatedConnectionIDs.Count, placed.Renamed, placed.Skipped, analysis.Value.InvalidCount, placed.Strengthened, placed.QueriesKept, placed.QueriesReplaced, placed.CreatedFolderIDs, placed.CreatedConnectionIDs);

        var endedAt = timeProvider.GetUtcNow();
        journal?.Record(
            new JournalEntryStart(startedAt, EJournalKind.Connections, "Importação de conexões", EJournalLevel.Warning, $"Importação de conexões: {placed.CreatedConnectionIDs.Count} conexões e {placed.CreatedFolderIDs.Count} pastas criadas."),
            new JournalEntryEnd(endedAt, Math.Max(0L, (long)(endedAt - startedAt).TotalMilliseconds), EJournalOutcome.Ok, RowCount: placed.CreatedConnectionIDs.Count));

        return Result.Success<ImportedConnectionsDto, ApiErrorDto>(new ImportedConnectionsDto
        {
            FolderIDs = placed.CreatedFolderIDs,
            ConnectionIDs = placed.CreatedConnectionIDs,
            MergedFolders = placed.MergedFolders,
            Renamed = placed.Renamed,
            Skipped = placed.Skipped
        });
    }

    private Result<ImportedConnectionsDto, ApiErrorDto> Refuse(ApiErrorDto error)
    {
        _logger.Information("Importação de conexões recusada ({Refusal:l}).", error.Type);

        return Result.Failure<ImportedConnectionsDto, ApiErrorDto>(error);
    }
}
