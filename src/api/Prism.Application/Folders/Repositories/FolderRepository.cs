using CSharpFunctionalExtensions;
using Prism.Application.Common.Protections;
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
///
/// As proteções que valem (RN-PROT-004) dependem das pastas acima e saem do documento que a gravação acabou de escrever. A alteração que pede a
/// senha do usuário (RN-PROT-003: marcar ou desmarcar o somente leitura, ou tirar o herdado de uma conexão movendo a pasta acima dela) a confere na
/// mesma operação do cofre que grava (`SaveOrRefuseWithPassword`).
/// </summary>
internal sealed class FolderRepository(IVaultService vaultService) : IFolderRepository
{
    public Task<Result<(Folder Folder, EffectiveProtections Protections), ApiErrorDto>> GetByID(Guid id, CancellationToken cancellationToken)
    {
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<(Folder, EffectiveProtections), ApiErrorDto>(VaultErrors.From(read.Error)));

        var record = read.Value.Folders.FirstOrDefault(folder => folder.ID == id);
        if (record is null)
            return Task.FromResult(Result.Failure<(Folder, EffectiveProtections), ApiErrorDto>(FolderErrors.NotFound(id)));

        var folder = Folder.Restore(record.ID, record.ParentID, record.Name, record.EnvironmentName, record.EnvironmentColor, record.Color, record.ConfirmCommands, record.ReadOnly == true, record.CreatedAt, record.UpdatedAt, record.UseInternalDescriptions);

        return Task.FromResult(Result.Success<(Folder, EffectiveProtections), ApiErrorDto>((folder, ProtectionRules.Of(read.Value, record))));
    }

    public async Task<Result<EffectiveProtections, ApiErrorDto>> Insert(Folder folder, CancellationToken cancellationToken)
    {
        EffectiveProtections? protections = null;

        // RN-PROT-003: criar uma pasta já marcada não pede a senha do usuário (nada do que existe muda).
        var saved = await vaultService.SaveOrRefuse(document =>
        {
            // A pasta pai pode ter sido excluída (estava vazia) depois da conferência: sem esta regra a filha ficaria órfã.
            if (folder.ParentID is { } parentID && !VaultFolders.ExistsByID(document, parentID))
                return FolderErrors.ParentNotFound(parentID);

            // RN-PASTA-002.
            if (VaultFolders.Exists(document, folder.Name, folder.ParentID))
                return FolderErrors.AlreadyExists(folder.Name);

            var record = ToRecord(folder);
            var inserted = document with { Folders = [.. document.Folders, record] };
            protections = ProtectionRules.Of(inserted, record);

            return inserted;
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        // A gravação que deu certo rodou a função, e a função que não recusou calculou as proteções.
        return protections!;
    }

    public async Task<Result<EffectiveProtections, ApiErrorDto>> Update(Folder folder, string? userPassword, CancellationToken cancellationToken)
    {
        EffectiveProtections? protections = null;

        var saved = await vaultService.SaveOrRefuseWithPassword(document =>
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

            var record = ToRecord(folder);
            var updated = document with { Folders = [.. document.Folders.Select(existing => existing.ID == folder.ID ? record : existing)] };
            protections = ProtectionRules.Of(updated, record);

            return updated;
        }, userPassword, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        return protections!;
    }

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

    /// <summary>
    /// O padrão das proteções se grava nulo (RN-PROT-001 e 002): a pasta gravada antes delas e a de agora sem nada escolhido são iguais. A importação de
    /// conexões (RN-TRANSF-014) cria as pastas dela por aqui também.
    /// </summary>
    internal static VaultFolderRecord ToRecord(Folder folder)
        => new(folder.ID, folder.ParentID, folder.Name, folder.CreatedAt, folder.UpdatedAt, folder.EnvironmentName, folder.EnvironmentColor, folder.Color, folder.ConfirmCommands, ProtectionRules.ToRecord(folder.ReadOnly), folder.UseInternalDescriptions);
}
