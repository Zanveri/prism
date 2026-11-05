using CSharpFunctionalExtensions;
using Prism.Application.Scripts.Domain;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Scripts.Repositories;

/// <summary>
/// Internal, porque a assinatura trafega o domínio, que é internal. O cofre não tem restrições como um banco: o nome único (RN-SCRIPT-004) e a existência
/// do script são conferidos dentro da gravação, e a recusa volta como o erro da API. O cofre fechado e o disco também, pela tradução do `VaultErrors`.
/// </summary>
internal interface IScriptRepository
{
    /// <summary>Falha com 409 `SCRIPT_ALREADY_EXISTS`, 401 `VAULT_LOCKED` ou 503 `VAULT_UNAVAILABLE`.</summary>
    Task<UnitResult<ApiErrorDto>> Insert(Script script, CancellationToken cancellationToken);

    /// <summary>
    /// Roda <paramref name="change"/> sobre o script como está no documento mais recente, dentro da gravação, e devolve o script depois dela. A alteração do
    /// `PATCH` é parcial (o ausente fica), e por isso não pode partir de uma leitura de antes: um renomear e um gravar por cima ao mesmo tempo perderiam um
    /// dos dois. A função devolve se algo mudou; nada mudou não regrava o cofre. As falhas do `Insert`, mais 404 `SCRIPT_NOT_FOUND`.
    /// </summary>
    Task<Result<Script, ApiErrorDto>> Update(Guid id, Func<Script, bool> change, CancellationToken cancellationToken);

    /// <summary>
    /// RN-VAR-028: troca os valores lembrados do script (nulo os esquece), dentro da gravação, sem mexer no resto do registro nem na data de alteração: lembrar
    /// valores não é editar o script. As falhas do `Insert`, mais 404 `SCRIPT_NOT_FOUND`.
    /// </summary>
    Task<UnitResult<ApiErrorDto>> SaveRunValues(Guid id, VaultScriptRunValuesRecord? runValues, CancellationToken cancellationToken);

    /// <summary>Falha com 404 `SCRIPT_NOT_FOUND` quando o script não existe. Os valores lembrados (RN-VAR-028) estão no registro, e saem com ele.</summary>
    Task<UnitResult<ApiErrorDto>> Delete(Guid id, CancellationToken cancellationToken);
}
