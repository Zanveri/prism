using CSharpFunctionalExtensions;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.DbeaverImports.Models;
using Prism.Application.DbeaverImports.Models.Dtos;
using Prism.Application.DbeaverImports.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.DbeaverSources.Services;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Services;
using System.Text.Json;
using ILogger = Serilog.ILogger;

namespace Prism.Application.DbeaverImports.Features.ImportFromDbeaver;

/// <summary>
/// RN-DBEAVER-016 e 017: a importação (`POST api/user/connections/dbeaver/import`): a cópia, o projeto, o lugar, "Levar as senhas", a porta DRDA de cada servidor Informix, as
/// chaves marcadas (de pastas e de conexões; as pastas do caminho de cada uma vão sozinhas), a escolha dos conflitos de nome (`rename`, o padrão, ou `skip`) e as chaves
/// das conexões marcadas que já existem no Prism e que podem ser sobrescritas (`Overwrite`; ausente ou nulo é nenhuma). A API lê a cópia de novo e confere tudo de novo:
/// não guarda nada da prévia.
/// </summary>
public sealed record ImportFromDbeaverCommand : IRequest<Result<ImportedDbeaverDto, ApiErrorDto>>
{
    public string? SourceId { get; init; }
    public string? Project { get; init; }
    public Guid? TargetFolderID { get; init; }
    public JsonElement? WithPasswords { get; init; }
    public IReadOnlyList<DbeaverDrdaPortDto?>? DrdaPorts { get; init; }
    public IReadOnlyList<string?>? Items { get; init; }
    public string? OnConflict { get; init; }
    public IReadOnlyList<string?>? Overwrite { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria o nome do projeto e os servidores do DBeaver.</summary>
    public override string ToString()
        => nameof(ImportFromDbeaverCommand);
}

internal sealed class ImportFromDbeaverHandler(IVaultService vaultService, IDbeaverSourceService source, IDbeaverImportRepository importRepository, TimeProvider timeProvider, ILogger logger, IJournalRecorder? journal = null) : IRequestHandler<ImportFromDbeaverCommand, Result<ImportedDbeaverDto, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<ImportFromDbeaverHandler>();

    public async Task<Result<ImportedDbeaverDto, ApiErrorDto>> Handle(ImportFromDbeaverCommand request, CancellationToken cancellationToken)
    {
        var startedAt = timeProvider.GetUtcNow();
        var generation = vaultService.Generation;
        var sourceId = DbeaverRequests.SourceIdOf(request.SourceId!);

        var prepared = DbeaverSources.Prepare(source, sourceId, request.Project, DbeaverRequests.WithPasswordsOf(request.WithPasswords), DbeaverRequests.DrdaPortsOf(request.DrdaPorts));
        if (prepared.IsFailure)
            return Refuse(sourceId, prepared.Error);

        var analysis = prepared.Value.Analysis;

        var items = request.Items ?? [];
        if (items.Any(key => key is null || (!analysis.FoldersByKey.ContainsKey(key) && !analysis.ConnectionsByKey.ContainsKey(key))))
            return Refuse(sourceId, DbeaverErrors.UnknownItem());

        var itemKeys = items.ToHashSet(StringComparer.Ordinal);
        if ((request.Overwrite ?? []).Any(key => key is null || !itemKeys.Contains(key) || !analysis.ConnectionsByKey.ContainsKey(key)))
            return Refuse(sourceId, DbeaverErrors.UnknownOverwrite());

        var selected = items
            .Where(key => analysis.FoldersByKey.TryGetValue(key!, out var folder) ? folder.Candidate is not null : analysis.ConnectionsByKey[key!].Candidate is not null)
            .Select(key => key!)
            .ToHashSet(StringComparer.Ordinal);
        var overwrite = (request.Overwrite ?? []).Select(key => key!).Where(selected.Contains).ToHashSet(StringComparer.Ordinal);

        var imported = await importRepository.Import(analysis, prepared.Value.Assembly, request.TargetFolderID, selected, overwrite, TransferRules.ConflictOf(request.OnConflict), generation, startedAt.UtcDateTime, cancellationToken);
        if (imported.IsFailure)
        {
            if (imported.Error.Type is "VAULT_LOCKED" or "VAULT_UNAVAILABLE")
                source.Delete(sourceId);

            return Refuse(sourceId, imported.Error);
        }

        source.Delete(sourceId);

        var result = imported.Value;
        var placed = result.Placed;
        var written = selected.Where(analysis.ConnectionsByKey.ContainsKey).Select(key => prepared.Value.Assembly.Items[key].Model).ToList();

        _logger.Information(
            "Importação do DBeaver {SourceId}: {Projects} projetos lidos, {CreatedFolders} pastas criadas, {MergedFolders} juntadas às que existiam, {CreatedConnections} conexões criadas, {Updated} atualizadas, {Kept} que já existiam e ficaram como estão, {Renamed} com outro nome, {Skipped} deixadas de fora, {Invalid} itens não importáveis, {WithPasswords} marcadas com senha, {CredentialsUnreadable} projetos com as senhas ilegíveis, {WithLeftOut} com algo de fora ({LeftOut}); pastas {FolderIDs}, conexões {ConnectionIDs} e atualizadas {UpdatedIDs}.",
            sourceId, prepared.Value.Included.Count, placed.CreatedFolderIDs.Count, placed.MergedFolders, placed.CreatedConnectionIDs.Count, result.UpdatedIDs.Count, result.Kept, placed.Renamed, placed.Skipped, analysis.InvalidCount,
            written.Count(model => model.PasswordFound && DbeaverRequests.WithPasswordsOf(request.WithPasswords)), prepared.Value.Included.Count(project => project.CredentialsUnreadable), written.Count(model => model.LeftOut.Count > 0),
            string.Join(',', written.SelectMany(model => model.LeftOut).GroupBy(code => code).OrderBy(group => group.Key, StringComparer.Ordinal).Select(group => $"{group.Key}={group.Count()}")),
            placed.CreatedFolderIDs, placed.CreatedConnectionIDs, result.UpdatedIDs);

        var endedAt = timeProvider.GetUtcNow();
        var totalConnections = placed.CreatedConnectionIDs.Count + result.UpdatedIDs.Count;
        journal?.Record(
            new JournalEntryStart(startedAt, EJournalKind.Connections, "Importação do DBeaver", EJournalLevel.Warning, $"Importação do DBeaver: {placed.CreatedConnectionIDs.Count} conexões criadas e {result.UpdatedIDs.Count} atualizadas."),
            new JournalEntryEnd(endedAt, Math.Max(0L, (long)(endedAt - startedAt).TotalMilliseconds), EJournalOutcome.Ok, RowCount: totalConnections));

        return Result.Success<ImportedDbeaverDto, ApiErrorDto>(new ImportedDbeaverDto
        {
            FolderIDs = placed.CreatedFolderIDs,
            ConnectionIDs = placed.CreatedConnectionIDs,
            UpdatedIDs = result.UpdatedIDs,
            MergedFolders = placed.MergedFolders,
            Renamed = placed.Renamed,
            Skipped = placed.Skipped
        });
    }

    private Result<ImportedDbeaverDto, ApiErrorDto> Refuse(Guid sourceId, ApiErrorDto error)
    {
        _logger.Information("Importação do DBeaver {SourceId} recusada ({Refusal:l}).", sourceId, error.Type);

        return Result.Failure<ImportedDbeaverDto, ApiErrorDto>(error);
    }
}
