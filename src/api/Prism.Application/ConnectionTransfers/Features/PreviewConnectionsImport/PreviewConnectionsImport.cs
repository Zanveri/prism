using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.ConnectionTransfers.Models.Dtos;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.ConnectionFiles.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using ILogger = Serilog.ILogger;

namespace Prism.Application.ConnectionTransfers.Features.PreviewConnectionsImport;

/// <summary>RN-TRANSF-011: o texto do arquivo, a senha de exportação e o lugar escolhido (`TargetFolderID` nulo é a raiz do navegador). Nada é gravado.</summary>
public sealed record PreviewConnectionsImportCommand : IRequest<Result<ImportPreviewDto, ApiErrorDto>>
{
    public string Content { get; init; } = string.Empty;
    public string Passphrase { get; init; } = string.Empty;
    public Guid? TargetFolderID { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria o arquivo e a senha de exportação.</summary>
    public override string ToString()
        => nameof(PreviewConnectionsImportCommand);
}

internal sealed class PreviewConnectionsImportHandler(IVaultService vaultService, IConnectionFileService fileService, TimeProvider timeProvider, ILogger logger) : IRequestHandler<PreviewConnectionsImportCommand, Result<ImportPreviewDto, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<PreviewConnectionsImportHandler>();

    public async Task<Result<ImportPreviewDto, ApiErrorDto>> Handle(PreviewConnectionsImportCommand request, CancellationToken cancellationToken)
    {
        // Lida antes de abrir o arquivo: a prévia diz o que há no cofre aberto (os conflitos, o que já existe), e um cofre que outro usuário abriu no meio da
        // derivação não pode responder por ele.
        var generation = vaultService.Generation;

        var analysis = await ImportFiles.OpenAsync(fileService, request.Content, request.Passphrase, cancellationToken);
        if (analysis.IsFailure)
            return Refuse(analysis.Error);

        // Depois da derivação: o documento daquele instante, que a prévia só lê.
        var read = vaultService.Read();
        if (read.IsFailure)
            return Refuse(VaultErrors.From(read.Error));

        if (vaultService.Generation != generation)
            return Refuse(VaultErrors.From(EVaultError.Locked));

        // RN-TRANSF-014: o lugar escolhido que outra janela excluiu é 404, na prévia e na importação.
        if (request.TargetFolderID is { } targetID && !VaultFolders.ExistsByID(read.Value, targetID))
            return Refuse(FolderErrors.NotFound(targetID));

        // RN-TRANSF-011: com tudo o que pode ser importado marcado, e com "Importar com outro nome" (o padrão), para dizer o nome que cada conflito receberia.
        var importable = analysis.Value.Folders.Where(folder => folder.Candidate is not null).Select(folder => folder.Key)
            .Concat(analysis.Value.Connections.Where(connection => connection.Candidate is not null).Select(connection => connection.Key))
            .ToHashSet(StringComparer.Ordinal);
        var placement = ImportPlacement.Place(read.Value, request.TargetFolderID, analysis.Value, importable, EImportConflict.Rename, keepVerificationQueries: true, timeProvider.GetUtcNow().UtcDateTime);

        // RN-LOG-001: as contagens, nunca o arquivo, nomes, hosts, usuários ou senhas.
        _logger.Information("Prévia da importação de conexões: {Folders} pastas e {Connections} conexões no arquivo, {Invalid} não importáveis, {Merged} pastas que já existem e {Conflicts} conexões de nome tomado no lugar.", analysis.Value.Folders.Count, analysis.Value.Connections.Count, analysis.Value.InvalidCount, placement.MergedFolders, placement.Renamed);

        return Result.Success<ImportPreviewDto, ApiErrorDto>(ImportPreviewMappings.ToDto(analysis.Value, placement));
    }

    /// <summary>A recusa vai ao log só com o código (a classe da recusa, RN-LOG-001 e RN-TRANSF-010).</summary>
    private Result<ImportPreviewDto, ApiErrorDto> Refuse(ApiErrorDto error)
    {
        _logger.Information("Prévia da importação de conexões recusada ({Refusal:l}).", error.Type);

        return Result.Failure<ImportPreviewDto, ApiErrorDto>(error);
    }
}
