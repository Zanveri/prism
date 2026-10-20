using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.ScriptFolders.Models;
using Prism.Application.ScriptFolders.Repositories;
using Prism.Application.Scripts.Domain;
using Prism.Application.Scripts.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Scripts.Repositories;

/// <summary>
/// Lê e grava os scripts pelo serviço do cofre (RN-SCRIPT-002: cifrados como o resto do cofre). Toda regra que uma requisição concorrente poderia quebrar é
/// decidida de dentro da função entregue ao `SaveAsync`, que o serviço roda com o semáforo tomado, sobre o documento mais recente: o nome único, a
/// existência do script e a da pasta de scripts para onde ele vai (RN-SCRIPT-007: a janela que exclui a pasta vazia e a que põe um script nela não passam
/// juntas). Não há conferência antes, no handler, porque uma recusa dentro da gravação não regrava o arquivo e uma conferência antes não teria
/// o que acelerar. A recusa devolve o documento que recebeu, e o serviço não regrava por isso.
/// </summary>
internal sealed class ScriptRepository(IVaultService vaultService) : IScriptRepository
{
    public Task<UnitResult<ApiErrorDto>> Insert(Script script, CancellationToken cancellationToken)
        => vaultService.SaveOrRefuse(document =>
        {
            // RN-SCRIPT-010: a pasta escolhida no campo "Pasta", que outra janela pode ter excluído depois da leitura da tela.
            if (script.FolderID is { } folderID && !VaultScriptFolders.ExistsByID(document, folderID))
                return ScriptFolderErrors.ChosenNotFound();

            // RN-SCRIPT-004.
            if (NameIsTaken(document, script))
                return ScriptErrors.AlreadyExists(script.Name);

            return document with { Scripts = [.. document.Scripts, ToRecord(script)] };
        }, cancellationToken);

    public async Task<Result<Script, ApiErrorDto>> Update(Guid id, Func<Script, bool> change, CancellationToken cancellationToken)
    {
        Script? changed = null;

        var saved = await vaultService.SaveOrRefuse(document =>
        {
            var existing = document.Scripts.FirstOrDefault(record => record.ID == id);
            if (existing is null)
                return ScriptErrors.NotFound(id);

            var script = Script.Restore(existing.ID, existing.Name, existing.Sql, existing.ConnectionID, existing.Database, existing.Icon, existing.Color, existing.FolderID, existing.CreatedAt, existing.UpdatedAt);
            changed = script;

            // Nada mudou: a mesma instância é "nada a gravar", e o `.bak` continua guardando a versão anterior de verdade.
            if (!change(script))
                return document;

            // RN-SCRIPT-009: a pasta de destino do "Mover para…", só quando ela mudou (mover não confere nome, e o resto da alteração não olha a pasta).
            if (script.FolderID is { } folderID && folderID != existing.FolderID && !VaultScriptFolders.ExistsByID(document, folderID))
                return ScriptFolderErrors.DestinationNotFound();

            // RN-SCRIPT-004, sem contar o próprio script: mudar só as maiúsculas do nome dele não é duplicidade.
            if (NameIsTaken(document, script))
                return ScriptErrors.AlreadyExists(script.Name);

            var updated = ToRecord(script);

            return document with { Scripts = [.. document.Scripts.Select(record => record.ID == id ? updated : record)] };
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        // A gravação que deu certo rodou a função, e a função que não recusou achou o script.
        return changed!;
    }

    public Task<UnitResult<ApiErrorDto>> Delete(Guid id, CancellationToken cancellationToken)
        => vaultService.SaveOrRefuse(document =>
        {
            if (!document.Scripts.Any(record => record.ID == id))
                return ScriptErrors.NotFound(id);

            return document with { Scripts = [.. document.Scripts.Where(record => record.ID != id)] };
        }, cancellationToken);

    /// <summary>RN-SCRIPT-004: o nome é único entre os scripts do usuário, sem diferenciar maiúsculas. O próprio script não colide com o nome que já tem.</summary>
    private static bool NameIsTaken(VaultDocument document, Script script)
        => document.Scripts.Any(record => record.ID != script.ID && string.Equals(record.Name, script.Name, StringComparison.OrdinalIgnoreCase));

    private static VaultScriptRecord ToRecord(Script script)
        => new(script.ID, script.Name, script.Sql, script.ConnectionID, script.Database, script.CreatedAt, script.UpdatedAt, script.Icon, script.Color, script.FolderID);
}
