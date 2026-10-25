using CSharpFunctionalExtensions;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.DbeaverImports.Models;
using Prism.Application.DbeaverImports.Models.Dtos;
using Prism.Application.DbeaverImports.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.DbeaverSources.Services;
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

internal sealed class ImportFromDbeaverHandler(IVaultService vaultService, IDbeaverSourceService source, IDbeaverImportRepository importRepository, TimeProvider timeProvider, ILogger logger) : IRequestHandler<ImportFromDbeaverCommand, Result<ImportedDbeaverDto, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<ImportFromDbeaverHandler>();

    public async Task<Result<ImportedDbeaverDto, ApiErrorDto>> Handle(ImportFromDbeaverCommand request, CancellationToken cancellationToken)
    {
        // RN-DBEAVER-016: a geração é lida ANTES de abrir a cópia e conferida dentro da própria gravação, com a trava do cofre.
        var generation = vaultService.Generation;
        var sourceId = DbeaverRequests.SourceIdOf(request.SourceId!);

        var prepared = DbeaverSources.Prepare(source, sourceId, request.Project, DbeaverRequests.WithPasswordsOf(request.WithPasswords), DbeaverRequests.DrdaPortsOf(request.DrdaPorts));
        if (prepared.IsFailure)
            return Refuse(sourceId, prepared.Error);

        var analysis = prepared.Value.Analysis;

        // A chave que a cópia não tem só se sabe depois de lê-la (`IMPORT_INVALID`). A do item que não pode ser importado é ignorada: ele nunca fica marcado.
        var items = request.Items ?? [];
        if (items.Any(key => key is null || (!analysis.FoldersByKey.ContainsKey(key) && !analysis.ConnectionsByKey.ContainsKey(key))))
            return Refuse(sourceId, DbeaverErrors.UnknownItem());

        // RN-DBEAVER-017: as chaves de `overwrite` têm de ser de conexões marcadas. A chave de uma conexão que não está mais no cofre não é erro: entra como nova.
        var itemKeys = items.ToHashSet(StringComparer.Ordinal);
        if ((request.Overwrite ?? []).Any(key => key is null || !itemKeys.Contains(key) || !analysis.ConnectionsByKey.ContainsKey(key)))
            return Refuse(sourceId, DbeaverErrors.UnknownOverwrite());

        var selected = items
            .Where(key => analysis.FoldersByKey.TryGetValue(key!, out var folder) ? folder.Candidate is not null : analysis.ConnectionsByKey[key!].Candidate is not null)
            .Select(key => key!)
            .ToHashSet(StringComparer.Ordinal);
        var overwrite = (request.Overwrite ?? []).Select(key => key!).Where(selected.Contains).ToHashSet(StringComparer.Ordinal);

        var imported = await importRepository.Import(analysis, prepared.Value.Assembly, request.TargetFolderID, selected, overwrite, TransferRules.ConflictOf(request.OnConflict), generation, timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
        if (imported.IsFailure)
        {
            // O cofre que fechou (o 401 e o 503 da gravação) leva a cópia; a recusa que a pessoa corrige (o lugar que sumiu) a deixa, e o diálogo continua com ela.
            if (imported.Error.Type is "VAULT_LOCKED" or "VAULT_UNAVAILABLE")
                source.Delete(sourceId);

            return Refuse(sourceId, imported.Error);
        }

        // RN-DBEAVER-006: a cópia é apagada depois da importação que terminou com sucesso, também a que não criou nem atualizou nada.
        source.Delete(sourceId);

        var result = imported.Value;
        var placed = result.Placed;
        var written = selected.Where(analysis.ConnectionsByKey.ContainsKey).Select(key => prepared.Value.Assembly.Items[key].Model).ToList();

        // RN-LOG-001 e RN-DBEAVER-016: as contagens e os IDs criados e atualizados, nunca nomes, hosts, usuários, senhas, IDs do DBeaver, nomes de projetos ou caminhos.
        _logger.Information(
            "Importação do DBeaver {SourceId}: {Projects} projetos lidos, {CreatedFolders} pastas criadas, {MergedFolders} juntadas às que existiam, {CreatedConnections} conexões criadas, {Updated} atualizadas, {Kept} que já existiam e ficaram como estão, {Renamed} com outro nome, {Skipped} deixadas de fora, {Invalid} itens não importáveis, {WithPasswords} marcadas com senha, {CredentialsUnreadable} projetos com as senhas ilegíveis, {WithLeftOut} com algo de fora ({LeftOut}); pastas {FolderIDs}, conexões {ConnectionIDs} e atualizadas {UpdatedIDs}.",
            sourceId, prepared.Value.Included.Count, placed.CreatedFolderIDs.Count, placed.MergedFolders, placed.CreatedConnectionIDs.Count, result.UpdatedIDs.Count, result.Kept, placed.Renamed, placed.Skipped, analysis.InvalidCount,
            written.Count(model => model.PasswordFound && DbeaverRequests.WithPasswordsOf(request.WithPasswords)), prepared.Value.Included.Count(project => project.CredentialsUnreadable), written.Count(model => model.LeftOut.Count > 0),
            string.Join(',', written.SelectMany(model => model.LeftOut).GroupBy(code => code).OrderBy(group => group.Key, StringComparer.Ordinal).Select(group => $"{group.Key}={group.Count()}")),
            placed.CreatedFolderIDs, placed.CreatedConnectionIDs, result.UpdatedIDs);

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

    /// <summary>A recusa vai ao log só com o código (a classe da recusa, RN-LOG-001).</summary>
    private Result<ImportedDbeaverDto, ApiErrorDto> Refuse(Guid sourceId, ApiErrorDto error)
    {
        _logger.Information("Importação do DBeaver {SourceId} recusada ({Refusal:l}).", sourceId, error.Type);

        return Result.Failure<ImportedDbeaverDto, ApiErrorDto>(error);
    }
}
