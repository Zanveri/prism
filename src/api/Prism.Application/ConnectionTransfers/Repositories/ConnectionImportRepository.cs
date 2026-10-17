using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.ConnectionTransfers.Repositories;

/// <summary>
/// Grava a importação pelo serviço do cofre, como os outros repositories: tudo o que outra janela pode ter mudado entre a prévia e a importação (o lugar, os
/// nomes, as proteções das pastas acima) é decidido dentro da função do `SaveAsync`, com o semáforo tomado e o documento mais recente, como nas pastas de
/// scripts (RN-SCRIPT-007). A leitura e a abertura do arquivo vieram antes, fora da trava (RN-TRANSF-010).
/// </summary>
internal sealed class ConnectionImportRepository(IVaultService vaultService) : IConnectionImportRepository
{
    public async Task<Result<ImportPlacementResult, ApiErrorDto>> Import(ImportAnalysis analysis, Guid? targetFolderID, IReadOnlySet<string> selected, EImportConflict onConflict, bool keepVerificationQueries, long generation, DateTime now, CancellationToken cancellationToken)
    {
        ImportPlacementResult? placed = null;

        var saved = await vaultService.SaveOrRefuse(document =>
        {
            // RN-TRANSF-014: o cofre que fechou durante a derivação, ou que outro usuário abriu, não recebe a importação. A geração só muda com o semáforo
            // tomado (abrir, fechar, trocar de usuário), então a lida aqui é a do documento que a função recebeu.
            if (vaultService.Generation != generation)
                return VaultErrors.From(EVaultError.Locked);

            // O lugar escolhido que outra janela excluiu: nada é gravado. A pasta do arquivo que ia se juntar a uma excluída no meio é simplesmente criada.
            if (targetFolderID is { } targetID && !VaultFolders.ExistsByID(document, targetID))
                return FolderErrors.NotFound(targetID);

            placed = ImportPlacement.Place(document, targetFolderID, analysis, selected, onConflict, keepVerificationQueries, now);

            return placed.Document;
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        // A gravação que deu certo rodou a função, e a função que não recusou fez a conta.
        return placed!;
    }
}
