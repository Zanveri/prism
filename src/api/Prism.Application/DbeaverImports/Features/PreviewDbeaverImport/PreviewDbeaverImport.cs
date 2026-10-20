using CSharpFunctionalExtensions;
using Prism.Application.Common.Protections;
using Prism.Application.Common.Vault;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.ConnectionTransfers.Models.Dtos;
using Prism.Application.DbeaverImports.Models;
using Prism.Application.DbeaverImports.Models.Dtos;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.DbeaverSources.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using System.Text.Json;
using ILogger = Serilog.ILogger;

namespace Prism.Application.DbeaverImports.Features.PreviewDbeaverImport;

/// <summary>
/// RN-DBEAVER-015: a prévia (`POST api/user/connections/dbeaver/import/preview`): a cópia (`SourceId`), o projeto (`Project`, o nome exato; nulo é "Todos os projetos"), o
/// lugar (`TargetFolderID` nulo é a raiz), "Levar as senhas" (`WithPasswords`: ausente ou nulo é verdadeiro) e a porta DRDA de cada servidor Informix (`DrdaPorts`).
/// Nada é gravado, e a cópia não é apagada: cada pedido lê e decifra de novo.
/// </summary>
public sealed record PreviewDbeaverImportCommand : IRequest<Result<DbeaverPreviewDto, ApiErrorDto>>
{
    public string? SourceId { get; init; }
    public string? Project { get; init; }
    public Guid? TargetFolderID { get; init; }
    public JsonElement? WithPasswords { get; init; }
    public IReadOnlyList<DbeaverDrdaPortDto?>? DrdaPorts { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria o nome do projeto e os servidores do DBeaver.</summary>
    public override string ToString()
        => nameof(PreviewDbeaverImportCommand);
}

internal sealed class PreviewDbeaverImportHandler(IVaultService vaultService, IDbeaverSourceService source, IDatabaseSessionService sessions, TimeProvider timeProvider, ILogger logger) : IRequestHandler<PreviewDbeaverImportCommand, Result<DbeaverPreviewDto, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<PreviewDbeaverImportHandler>();

    public Task<Result<DbeaverPreviewDto, ApiErrorDto>> Handle(PreviewDbeaverImportCommand request, CancellationToken cancellationToken)
    {
        // Lida antes de abrir a cópia: a prévia diz o que há no cofre aberto (o que já existe, os conflitos), e um cofre que outro usuário abriu no meio da leitura
        // não pode responder por ele.
        var generation = vaultService.Generation;
        var sourceId = DbeaverRequests.SourceIdOf(request.SourceId!);

        var prepared = DbeaverSources.Prepare(source, sourceId, request.Project, DbeaverRequests.WithPasswordsOf(request.WithPasswords), DbeaverRequests.DrdaPortsOf(request.DrdaPorts));
        if (prepared.IsFailure)
            return Task.FromResult(Refuse(prepared.Error));

        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Refuse(VaultErrors.From(read.Error)));

        if (vaultService.Generation != generation)
            return Task.FromResult(Refuse(VaultErrors.From(EVaultError.Locked)));

        // RN-TRANSF-014: o lugar escolhido que outra janela excluiu é 404, na prévia e na importação.
        var document = read.Value;
        if (request.TargetFolderID is { } targetID && !VaultFolders.ExistsByID(document, targetID))
            return Task.FromResult(Refuse(FolderErrors.NotFound(targetID)));

        var analysis = prepared.Value.Analysis;
        var assembly = prepared.Value.Assembly;
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var index = DbeaverReimport.Index(document);
        var folders = ProtectionRules.FoldersOf(document);

        // RN-DBEAVER-017: a que já existe no Prism não é um conflito de nome nem é posta; a prévia dela é o que sobrescrever mudaria.
        var existing = new Dictionary<string, (VaultConnectionRecord Record, OverwriteFlags Flags)>(StringComparer.Ordinal);
        foreach (var item in analysis.Connections.Where(connection => connection.Candidate is not null))
        {
            var dbeaver = assembly.Items[item.Key];
            if (!index.TryGetValue(DbeaverReimport.OriginKey(dbeaver.ProjectName, dbeaver.Model.ID), out var record))
                continue;

            var nameTaken = document.Connections.Any(other => other.ID != record.ID && other.FolderID == record.FolderID && string.Equals(other.Name, item.Candidate!.Name, StringComparison.OrdinalIgnoreCase));
            existing[item.Key] = (record, DbeaverReimport.Plan(record, item.Candidate!, item.Origin!, dbeaver.DrdaPort is not null, nameTaken, now).Flags);
        }

        // RN-TRANSF-011: com tudo o que pode ser importado marcado, e com "Importar com outro nome" (o padrão), para dizer o nome que cada conflito receberia.
        var importable = analysis.Folders.Where(folder => folder.Candidate is not null).Select(folder => folder.Key)
            .Concat(analysis.Connections.Where(connection => connection.Candidate is not null && !existing.ContainsKey(connection.Key)).Select(connection => connection.Key))
            .ToHashSet(StringComparer.Ordinal);
        var placement = ImportPlacement.Place(document, request.TargetFolderID, analysis, importable, EImportConflict.Rename, keepVerificationQueries: true, now);

        var notes = DbeaverSources.Notes(prepared.Value);
        var dto = new DbeaverPreviewDto
        {
            Folders = [.. analysis.Folders.Select(folder => new DbeaverPreviewFolderDto(ImportPreviewMappings.ToDto(folder, placement)) { NameCut = assembly.CutFolders.Contains(folder.Key) })],
            Connections = [.. analysis.Connections.Select(connection => ToDto(connection, assembly, placement, existing, folders, generation))],
            Notes = notes
        };

        // RN-LOG-001: as contagens, nunca nomes, hosts, usuários, senhas, IDs do DBeaver, nomes de projeto ou caminhos.
        _logger.Information(
            "Prévia da importação do DBeaver {SourceId}: {Projects} projetos lidos, {Folders} pastas e {Connections} conexões, {Invalid} não importáveis, {Existing} que já existem no Prism, {Merged} pastas que já existem e {Conflicts} conexões de nome tomado no lugar.",
            sourceId, prepared.Value.Included.Count, analysis.Folders.Count, analysis.Connections.Count, analysis.InvalidCount, existing.Count, placement.MergedFolders, placement.Renamed);

        return Task.FromResult(Result.Success<DbeaverPreviewDto, ApiErrorDto>(dto));
    }

    private DbeaverPreviewConnectionDto ToDto(
        ImportConnectionItem connection, DbeaverAssembly assembly, ImportPlacementResult placement,
        IReadOnlyDictionary<string, (VaultConnectionRecord Record, OverwriteFlags Flags)> existing, IReadOnlyDictionary<Guid, VaultFolderRecord> folders, long generation)
    {
        var dbeaver = assembly.Items[connection.Key];
        var model = dbeaver.Model;
        var importable = connection.Candidate is not null;
        var isExisting = existing.TryGetValue(connection.Key, out var match);

        // A que já existe não foi posta (nem é um conflito de nome): a prévia dela é a de uma colocação sem nada.
        var placed = isExisting ? new ConnectionPlacement(null, Conflict: false, null, Skipped: false, Strengthening.None) : placement.Connections.GetValueOrDefault(connection.Key);

        return new DbeaverPreviewConnectionDto(ImportPreviewMappings.ToDto(connection, placed))
        {
            Server = model.Server,
            DbeaverPort = model.SqliPort,
            DrdaPort = dbeaver.DrdaPort,
            AuthModel = model.AuthModel,
            DbeaverType = model.DbeaverType,
            Existing = isExisting ? ToDto(match.Record, folders, sessions.HasSession(match.Record.ID, generation)) : null,
            Overwrite = isExisting ? ToDto(match.Flags) : null,
            LeftOut = importable ? model.LeftOut : []
        };
    }

    private static DbeaverExistingDto ToDto(VaultConnectionRecord record, IReadOnlyDictionary<Guid, VaultFolderRecord> folders, bool connected)
        => new()
        {
            ConnectionID = record.ID,
            Name = record.Name,
            Path = DbeaverReimport.PathOf(folders, record.FolderID),
            Connected = connected,
            Host = record.Host,
            Port = record.Port,
            Database = record.Database,
            UserName = record.UserName,
            EnvironmentName = record.EnvironmentName
        };

    private static DbeaverOverwriteDto ToDto(OverwriteFlags flags)
        => new()
        {
            Name = flags.Name,
            Engine = flags.Engine,
            Host = flags.Host,
            Port = flags.Port,
            Database = flags.Database,
            UserName = flags.UserName,
            Password = flags.Password,
            Environment = flags.Environment,
            KeepsName = flags.KeepsName,
            DropsPassword = flags.DropsPassword
        };

    /// <summary>A recusa vai ao log só com o código (a classe da recusa, RN-LOG-001).</summary>
    private Result<DbeaverPreviewDto, ApiErrorDto> Refuse(ApiErrorDto error)
    {
        _logger.Information("Prévia da importação do DBeaver recusada ({Refusal:l}).", error.Type);

        return Result.Failure<DbeaverPreviewDto, ApiErrorDto>(error);
    }
}
