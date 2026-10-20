using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.ScriptFolders.Domain;
using Prism.Application.ScriptFolders.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.ScriptFolders.Repositories;

/// <summary>
/// Lê e grava as pastas de scripts pelo serviço do cofre. Toda regra que uma requisição concorrente poderia quebrar (RN-SCRIPT-007) é decidida de dentro da
/// função entregue ao `SaveAsync`, que o serviço roda com o semáforo tomado, sobre o documento mais recente: duas janelas não criam duas pastas irmãs de mesmo
/// nome, nem uma exclui a pasta em que a outra acabou de pôr um script. Não há conferência antes, no handler, como nos scripts: uma recusa dentro da gravação
/// não regrava o arquivo, e uma conferência antes não teria o que acelerar.
/// </summary>
internal sealed class ScriptFolderRepository(IVaultService vaultService) : IScriptFolderRepository
{
    public Task<UnitResult<ApiErrorDto>> Insert(ScriptFolder folder, CancellationToken cancellationToken)
        => vaultService.SaveOrRefuse(document =>
        {
            // A pasta pai pode ter sido excluída (estava vazia) por outra janela: sem esta regra a filha ficaria órfã.
            if (folder.ParentID is { } parentID && !VaultScriptFolders.ExistsByID(document, parentID))
                return ScriptFolderErrors.ParentNotFound();

            if (VaultScriptFolders.Exists(document, folder.Name, folder.ParentID))
                return ScriptFolderErrors.AlreadyExists(folder.Name, VaultScriptFolders.PathOf(document, folder.ParentID));

            return document with { ScriptFolders = [.. document.ScriptFolders, ToRecord(folder)] };
        }, cancellationToken);

    public async Task<Result<ScriptFolder, ApiErrorDto>> Update(Guid id, Func<ScriptFolder, bool> change, CancellationToken cancellationToken)
    {
        ScriptFolder? changed = null;

        var saved = await vaultService.SaveOrRefuse(document =>
        {
            var existing = document.ScriptFolders.FirstOrDefault(record => record.ID == id);
            if (existing is null)
                return ScriptFolderErrors.NotFound(id);

            var folder = ScriptFolder.Restore(existing.ID, existing.ParentID, existing.Name, existing.CreatedAt, existing.UpdatedAt);
            changed = folder;

            // Nada mudou: a mesma instância é "nada a gravar", e o `.bak` continua guardando a versão anterior de verdade.
            if (!change(folder))
                return document;

            if (folder.ParentID is { } parentID)
            {
                if (!VaultScriptFolders.ExistsByID(document, parentID))
                    return ScriptFolderErrors.DestinationNotFound();

                if (VaultScriptFolders.IsSelfOrDescendant(document, parentID, folder.ID))
                    return ScriptFolderErrors.Cycle();
            }

            // Sem contar a própria pasta: mudar só as maiúsculas do nome dela não é repetição.
            if (VaultScriptFolders.Exists(document, folder.Name, folder.ParentID, folder.ID))
                return ScriptFolderErrors.AlreadyExists(folder.Name, VaultScriptFolders.PathOf(document, folder.ParentID));

            var updated = ToRecord(folder);

            return document with { ScriptFolders = [.. document.ScriptFolders.Select(record => record.ID == id ? updated : record)] };
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        // A gravação que deu certo rodou a função, e a função que não recusou achou a pasta.
        return changed!;
    }

    public Task<UnitResult<ApiErrorDto>> Delete(Guid id, CancellationToken cancellationToken)
        => vaultService.SaveOrRefuse(document =>
        {
            var existing = document.ScriptFolders.FirstOrDefault(record => record.ID == id);
            if (existing is null)
                return ScriptFolderErrors.NotFound(id);

            // Uma subpasta ou um script que outra janela pôs na pasta depois da leitura da tela também impede a exclusão.
            var (folders, scripts) = VaultScriptFolders.Contents(document, id);
            if (folders > 0 || scripts > 0)
                return ScriptFolderErrors.NotEmpty(existing.Name, folders, scripts);

            return document with { ScriptFolders = [.. document.ScriptFolders.Where(record => record.ID != id)] };
        }, cancellationToken);

    private static VaultScriptFolderRecord ToRecord(ScriptFolder folder)
        => new(folder.ID, folder.ParentID, folder.Name, folder.CreatedAt, folder.UpdatedAt);
}
