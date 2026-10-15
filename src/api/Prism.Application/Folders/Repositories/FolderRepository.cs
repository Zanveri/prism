using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Folders.Domain;
using Prism.Application.Folders.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Folders.Repositories;

/// <summary>
/// Lê e grava as pastas pelo serviço do cofre (não há SQL). Cada escrita confere as regras de novo dentro
/// da função entregue ao `SaveAsync`: o serviço a roda com o semáforo tomado, sobre o documento mais
/// recente, e o handler só conferiu o que viu quando começou. Sem isso, duas criações do mesmo nome, ou
/// dois movimentos que juntos fechariam um ciclo, passariam juntos pela conferência e seriam gravados.
/// </summary>
internal sealed class FolderRepository(IVaultService vaultService) : IFolderRepository
{
    public Task<Result<Folder, ApiErrorDto>> GetByID(Guid id, CancellationToken cancellationToken)
    {
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<Folder, ApiErrorDto>(VaultErrors.From(read.Error)));

        var record = read.Value.Folders.FirstOrDefault(folder => folder.ID == id);
        if (record is null)
            return Task.FromResult(Result.Failure<Folder, ApiErrorDto>(FolderErrors.NotFound(id)));

        return Task.FromResult(Result.Success<Folder, ApiErrorDto>(Folder.Restore(record.ID, record.ParentID, record.Name, record.EnvironmentName, record.EnvironmentColor, record.Color, record.CreatedAt, record.UpdatedAt)));
    }

    public Task<UnitResult<ApiErrorDto>> Insert(Folder folder, CancellationToken cancellationToken)
        => vaultService.SaveOrRefuse(document =>
        {
            // A pasta pai pode ter sido excluída (estava vazia) depois da conferência: sem esta regra a filha ficaria órfã.
            if (folder.ParentID is { } parentID && !VaultFolders.ExistsByID(document, parentID))
                return FolderErrors.ParentNotFound(parentID);

            // RN-PASTA-002.
            if (VaultFolders.Exists(document, folder.Name, folder.ParentID))
                return FolderErrors.AlreadyExists(folder.Name);

            return document with { Folders = [.. document.Folders, ToRecord(folder)] };
        }, cancellationToken);

    public Task<UnitResult<ApiErrorDto>> Update(Folder folder, CancellationToken cancellationToken)
        => vaultService.SaveOrRefuse(document =>
        {
            if (!VaultFolders.ExistsByID(document, folder.ID))
                return FolderErrors.NotFound(folder.ID);

            if (folder.ParentID is { } parentID)
            {
                if (!VaultFolders.ExistsByID(document, parentID))
                    return FolderErrors.ParentNotFound(parentID);

                // RN-PASTA-003.
                if (VaultFolders.IsSelfOrDescendant(document, parentID, folder.ID))
                    return FolderErrors.Cycle();
            }

            // RN-PASTA-002, sem contar a própria pasta: salvar com o nome que ela já tem não é duplicidade.
            if (VaultFolders.Exists(document, folder.Name, folder.ParentID, folder.ID))
                return FolderErrors.AlreadyExists(folder.Name);

            return document with { Folders = [.. document.Folders.Select(record => record.ID == folder.ID ? ToRecord(folder) : record)] };
        }, cancellationToken);

    public Task<UnitResult<ApiErrorDto>> Delete(Guid id, CancellationToken cancellationToken)
        => vaultService.SaveOrRefuse(document =>
        {
            if (!VaultFolders.ExistsByID(document, id))
                return FolderErrors.NotFound(id);

            // RN-PASTA-004: uma subpasta ou conexão gravada depois da conferência também impede a exclusão.
            if (VaultFolders.HasChildren(document, id))
                return FolderErrors.NotEmpty();

            return document with { Folders = [.. document.Folders.Where(record => record.ID != id)] };
        }, cancellationToken);

    private static VaultFolderRecord ToRecord(Folder folder)
        => new(folder.ID, folder.ParentID, folder.Name, folder.CreatedAt, folder.UpdatedAt, folder.EnvironmentName, folder.EnvironmentColor, folder.Color);
}
