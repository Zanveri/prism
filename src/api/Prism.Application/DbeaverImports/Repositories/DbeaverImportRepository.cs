using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.DbeaverImports.Models;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.DbeaverImports.Repositories;

/// <summary>
/// Grava a importação do DBeaver pelo serviço do cofre, como o `ConnectionImportRepository`: tudo o que outra janela pode ter mudado entre a prévia e a importação (o lugar,
/// os nomes, as proteções das pastas acima, a conexão que foi excluída ou mudada) é decidido dentro da função do `SaveAsync`, com o semáforo tomado e o documento mais
/// recente. A leitura da cópia e a decifração das senhas vieram antes, fora da trava (RN-DBEAVER-007 e 008).
/// </summary>
internal sealed class DbeaverImportRepository(IVaultService vaultService) : IDbeaverImportRepository
{
    public async Task<Result<DbeaverPlacementResult, ApiErrorDto>> Import(ImportAnalysis analysis, DbeaverAssembly assembly, Guid? targetFolderID, IReadOnlySet<string> selected, IReadOnlySet<string> overwriteKeys, EImportConflict onConflict, long generation, DateTime now, CancellationToken cancellationToken)
    {
        DbeaverPlacementResult? placed = null;

        var saved = await vaultService.SaveOrRefuse(document =>
        {
            // O cofre que fechou durante a leitura, ou que outro usuário abriu, não recebe a importação. A geração só muda com o semáforo tomado (abrir, fechar,
            // trocar de usuário), então a lida aqui é a do documento que a função recebeu.
            if (vaultService.Generation != generation)
                return VaultErrors.From(EVaultError.Locked);

            // O lugar escolhido que outra janela excluiu: nada é gravado.
            if (targetFolderID is { } targetID && !VaultFolders.ExistsByID(document, targetID))
                return FolderErrors.NotFound(targetID);

            placed = DbeaverPlacement.Apply(document, targetFolderID, analysis, assembly, selected, overwriteKeys, onConflict, now);

            return placed.Document;
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        // A gravação que deu certo rodou a função, e a função que não recusou fez a conta.
        return placed!;
    }
}
