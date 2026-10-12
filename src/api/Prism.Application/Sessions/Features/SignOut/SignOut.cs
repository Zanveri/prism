using CSharpFunctionalExtensions;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Sessions.Features.SignOut;

/// <summary>
/// RN-COFRE-008: fecha o cofre, o que encerra as sessões com os bancos e zera a chave na memória.
/// Nunca falha para quem chama: sair com o cofre já fechado também é sucesso, e devolver erro aqui só
/// prenderia a pessoa numa tela ao tentar sair.
/// </summary>
public sealed record SignOutCommand : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class SignOutHandler(IVaultService vaultService) : IRequestHandler<SignOutCommand, UnitResult<ApiErrorDto>>
{
    public Task<UnitResult<ApiErrorDto>> Handle(SignOutCommand request, CancellationToken cancellationToken)
    {
        vaultService.Lock();

        return Task.FromResult(UnitResult.Success<ApiErrorDto>());
    }
}
