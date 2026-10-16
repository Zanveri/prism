using CSharpFunctionalExtensions;
using Prism.Application.ScriptFolders.Domain;
using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.ScriptFolders.Repositories;

/// <summary>
/// Internal, porque a assinatura trafega o domínio, que é internal. O cofre não tem restrições como um banco: o nome único entre as irmãs, a pasta pai que
/// existe, o ciclo e a pasta vazia (RN-SCRIPT-007) são conferidos dentro da gravação, e a recusa volta como o erro da API. O cofre fechado e o disco também,
/// pela tradução do `VaultErrors`.
/// </summary>
internal interface IScriptFolderRepository
{
    /// <summary>Falha com 404 `SCRIPT_FOLDER_NOT_FOUND` (a pasta pai), 409 `SCRIPT_FOLDER_ALREADY_EXISTS`, 401 `VAULT_LOCKED` ou 503 `VAULT_UNAVAILABLE`.</summary>
    Task<UnitResult<ApiErrorDto>> Insert(ScriptFolder folder, CancellationToken cancellationToken);

    /// <summary>
    /// Roda <paramref name="change"/> sobre a pasta como está no documento mais recente, dentro da gravação, e devolve a pasta depois dela. A função devolve se
    /// algo mudou; nada mudou não regrava o cofre. As falhas do `Insert`, mais 404 `SCRIPT_FOLDER_NOT_FOUND` (a pasta) e 409 `SCRIPT_FOLDER_CYCLE`.
    /// </summary>
    Task<Result<ScriptFolder, ApiErrorDto>> Update(Guid id, Func<ScriptFolder, bool> change, CancellationToken cancellationToken);

    /// <summary>Falha com 404 `SCRIPT_FOLDER_NOT_FOUND` e 409 `SCRIPT_FOLDER_NOT_EMPTY` (com `folders` e `scripts`).</summary>
    Task<UnitResult<ApiErrorDto>> Delete(Guid id, CancellationToken cancellationToken);
}
