using CSharpFunctionalExtensions;
using Prism.Application.Folders.Domain;
using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.Folders.Repositories;

/// <summary>
/// Internal, e não pública como a `IFolderQueries`: a assinatura trafega o domínio, que é internal.
/// Expor um tipo internal em interface pública não compila.
///
/// O cofre não tem restrições como um banco, então a falha de uma gravação não é só a do disco: as
/// regras que o banco garantiria por chave única e chave estrangeira (RN-PASTA-002 a 004) são conferidas
/// de novo dentro da própria gravação, e a recusa volta como o erro da API. O cofre fechado e o disco
/// também, pela tradução do `VaultErrors`.
/// </summary>
internal interface IFolderRepository
{
    /// <summary>Falha com 404 `FOLDER_NOT_FOUND` quando a pasta não existe, e com 401 `VAULT_LOCKED` quando o cofre fechou.</summary>
    Task<Result<Folder, ApiErrorDto>> GetByID(Guid id, CancellationToken cancellationToken);

    Task<UnitResult<ApiErrorDto>> Insert(Folder folder, CancellationToken cancellationToken);

    /// <summary>Grava nome, pasta pai e ambiente, os campos que a pasta muda.</summary>
    Task<UnitResult<ApiErrorDto>> Update(Folder folder, CancellationToken cancellationToken);

    Task<UnitResult<ApiErrorDto>> Delete(Guid id, CancellationToken cancellationToken);
}
