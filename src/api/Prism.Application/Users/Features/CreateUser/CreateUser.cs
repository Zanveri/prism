using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Sessions.Models.Dtos;
using Prism.Application.Users.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Users.Features.CreateUser;

/// <summary>Cria o usuário e já entra com ele (RN-COFRE-007: o cofre aberto antes só fecha quando a criação dá certo).</summary>
public sealed record CreateUserCommand : IRequest<Result<SessionDto, ApiErrorDto>>
{
    public string UserName { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e esta é a senha.</summary>
    public override string ToString() => nameof(CreateUserCommand);
}

internal sealed class CreateUserHandler(IVaultService vaultService) : IRequestHandler<CreateUserCommand, Result<SessionDto, ApiErrorDto>>
{
    public async Task<Result<SessionDto, ApiErrorDto>> Handle(CreateUserCommand request, CancellationToken cancellationToken)
    {
        // A senha segue como veio: espaço nas pontas faz parte dela.
        var userName = UserNameRules.Normalize(request.UserName);

        var created = await vaultService.CreateAsync(userName, request.Password, cancellationToken);
        if (created.IsFailure)
            return Result.Failure<SessionDto, ApiErrorDto>(VaultErrors.From(created.Error));

        return Result.Success<SessionDto, ApiErrorDto>(new SessionDto { Unlocked = true, UserName = userName });
    }
}
