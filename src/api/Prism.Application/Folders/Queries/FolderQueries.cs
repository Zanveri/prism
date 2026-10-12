using Prism.Application.Folders.Repositories;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Folders.Queries;

internal sealed class FolderQueries(IVaultService vaultService) : IFolderQueries
{
    public Task<bool> Exists(string name, Guid? parentID, CancellationToken cancellationToken)
        => Task.FromResult(VaultFolders.Exists(Document(), name, parentID));

    public Task<bool> ExistsByID(Guid id, CancellationToken cancellationToken)
        => Task.FromResult(VaultFolders.ExistsByID(Document(), id));

    public Task<bool> HasChildren(Guid id, CancellationToken cancellationToken)
        => Task.FromResult(VaultFolders.HasChildren(Document(), id));

    public Task<bool> IsSelfOrDescendant(Guid candidateID, Guid ancestorID, CancellationToken cancellationToken)
        => Task.FromResult(VaultFolders.IsSelfOrDescendant(Document(), candidateID, ancestorID));

    /// <summary>
    /// Uma leitura por pergunta. Cofre fechado é um documento sem pastas, e a resposta é a de "nada achado":
    /// a pergunta não leu nada, então não pode decidir um 404 (ver `IFolderQueries`). A gravação que vem
    /// depois responde `VAULT_LOCKED`.
    /// </summary>
    private VaultDocument Document()
    {
        var read = vaultService.Read();

        return read.IsSuccess ? read.Value : new VaultDocument(string.Empty, [], []);
    }
}
