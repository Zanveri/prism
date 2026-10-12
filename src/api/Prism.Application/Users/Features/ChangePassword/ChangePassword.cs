using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Users.Features.ChangePassword;

/// <summary>
/// RN-COFRE-013: troca a senha do usuário do cofre aberto. As duas senhas seguem como vieram (espaço nas pontas faz parte delas, como na
/// criação e na entrada). Não há usuário no corpo: a troca é sempre do cofre que está aberto, então ninguém troca a senha de outro.
/// </summary>
public sealed record ChangePasswordCommand : IRequest<UnitResult<ApiErrorDto>>
{
    public string CurrentPassword { get; init; } = string.Empty;
    public string NewPassword { get; init; } = string.Empty;

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e estas são as senhas.</summary>
    public override string ToString() => nameof(ChangePasswordCommand);
}

internal sealed class ChangePasswordHandler(IVaultService vaultService) : IRequestHandler<ChangePasswordCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(ChangePasswordCommand request, CancellationToken cancellationToken)
    {
        // Conferir a senha atual, recusar a igual, re-embrulhar e gravar são uma operação só do serviço, com o cofre reservado: uma conferência feita
        // aqui, fora do semáforo, poderia ser de um cofre que outro usuário já trocou quando a gravação acontecesse.
        var changed = await vaultService.ChangePasswordAsync(request.CurrentPassword, request.NewPassword, cancellationToken);
        if (changed.IsFailure)
            return UnitResult.Failure(VaultErrors.From(changed.Error));

        return UnitResult.Success<ApiErrorDto>();
    }
}
