using CSharpFunctionalExtensions;
using Prism.Application.Common.Protections;
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
    /// <summary>
    /// A pasta e as proteções que valem para ela (RN-PROT-004), da mesma leitura. Falha com 404 `FOLDER_NOT_FOUND` quando a pasta não existe, e com
    /// 401 `VAULT_LOCKED` quando o cofre fechou.
    /// </summary>
    Task<Result<(Folder Folder, EffectiveProtections Protections), ApiErrorDto>> GetByID(Guid id, CancellationToken cancellationToken);

    /// <summary>Devolve as proteções que valem para a pasta (RN-PROT-004), do documento gravado.</summary>
    Task<Result<EffectiveProtections, ApiErrorDto>> Insert(Folder folder, CancellationToken cancellationToken);

    /// <summary>
    /// Grava nome, pasta pai, ambiente, cor e proteções, os campos que a pasta muda. `userPassword` é a senha do usuário do Prism, que a mudança do
    /// somente leitura pede (RN-PROT-003): sem ela, 422 `USER_PASSWORD_REQUIRED`; errada, 422 `INVALID_PASSWORD` (e o quinto erro seguido, 401
    /// `VAULT_LOCKED`). Conferida na mesma operação do cofre que grava, só quando pedida. Devolve as proteções que valem (RN-PROT-004), do documento
    /// gravado.
    /// </summary>
    Task<Result<EffectiveProtections, ApiErrorDto>> Update(Folder folder, string? userPassword, CancellationToken cancellationToken);

    Task<UnitResult<ApiErrorDto>> Delete(Guid id, CancellationToken cancellationToken);
}
