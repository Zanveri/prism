using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Sessions.Models.Dtos;
using Prism.Application.Users.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Sessions.Features.SignIn;

/// <summary>
/// Abre o cofre do usuário (RN-COFRE-007: o aberto antes fecha, mesmo que esta entrada falhe). Não há
/// validator: nome fora das regras (de dispositivo do Windows, com caminho, vazio ou ausente) responde
/// 401 `INVALID_CREDENTIALS` como uma senha errada, depois do mesmo trabalho de derivação
/// (RN-COFRE-006), e nunca 422, que diria a quem tenta o que é um nome válido.
/// </summary>
public sealed record SignInCommand : IRequest<Result<SessionDto, ApiErrorDto>>
{
    public string UserName { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e esta é a senha.</summary>
    public override string ToString() => nameof(SignInCommand);
}

internal sealed class SignInHandler(IVaultService vaultService) : IRequestHandler<SignInCommand, Result<SessionDto, ApiErrorDto>>
{
    public async Task<Result<SessionDto, ApiErrorDto>> Handle(SignInCommand request, CancellationToken cancellationToken)
    {
        // Só normaliza; quem recusa o que não é um nome de cofre é o próprio serviço, e com a derivação feita. A senha segue como veio.
        var userName = UserNameRules.Normalize(request.UserName);

        var unlocked = await vaultService.UnlockAsync(userName, request.Password, cancellationToken);
        if (unlocked.IsFailure)
            return Result.Failure<SessionDto, ApiErrorDto>(VaultErrors.From(unlocked.Error));

        return Result.Success<SessionDto, ApiErrorDto>(new SessionDto { Unlocked = true, UserName = userName });
    }
}
