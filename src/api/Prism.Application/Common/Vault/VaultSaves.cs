using CSharpFunctionalExtensions;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Common.Vault;

internal static class VaultSaves
{
    /// <summary>
    /// A função do `SaveAsync` não tem como falhar, então a recusa de uma regra é anotada numa variável e o
    /// documento volta como entrou (a mesma instância, e o serviço do cofre não regrava por isso). Quem lê a
    /// variável é o código depois do `await`, quando a função já rodou. A recusa vale mesmo que a gravação falhe
    /// ou que o cofre tenha fechado: é ela que explica o pedido do usuário, e uma função que não rodou não recusou nada.
    /// </summary>
    public static async Task<UnitResult<ApiErrorDto>> SaveOrRefuse(this IVaultService vaultService, Func<VaultDocument, Result<VaultDocument, ApiErrorDto>> change, CancellationToken cancellationToken)
    {
        ApiErrorDto? refusal = null;

        var saved = await vaultService.SaveAsync(document =>
        {
            var changed = change(document);
            if (changed.IsSuccess)
                return changed.Value;

            refusal = changed.Error;

            return document;
        }, cancellationToken);

        if (refusal is not null)
            return UnitResult.Failure(refusal);

        if (saved.IsFailure)
            return UnitResult.Failure(VaultErrors.From(saved.Error));

        return UnitResult.Success<ApiErrorDto>();
    }
}
