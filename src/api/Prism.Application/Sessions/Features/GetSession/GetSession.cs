using CSharpFunctionalExtensions;
using Prism.Application.Sessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Sessions.Features.GetSession;

/// <summary>Diz à tela se há cofre aberto e de quem é. Nunca falha: cofre fechado é uma resposta, e não um erro.</summary>
public sealed record GetSessionCommand : IRequest<Result<SessionDto, ApiErrorDto>>;

internal sealed class GetSessionHandler(IVaultService vaultService) : IRequestHandler<GetSessionCommand, Result<SessionDto, ApiErrorDto>>
{
    public Task<Result<SessionDto, ApiErrorDto>> Handle(GetSessionCommand request, CancellationToken cancellationToken)
    {
        // Uma leitura só: ler `IsUnlocked` e depois `UserName` poderia pegar um cofre que fechou no meio e dar `unlocked: true` sem nome.
        var userName = vaultService.UserName;

        return Task.FromResult(Result.Success<SessionDto, ApiErrorDto>(new SessionDto { Unlocked = userName is not null, UserName = userName }));
    }
}
