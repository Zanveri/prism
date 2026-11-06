using CSharpFunctionalExtensions;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Sessions.Features.SignOut;

/// <summary>
/// RN-COFRE-008: fecha o cofre, o que encerra as sessões com os bancos e zera a chave na memória.
/// Nunca falha para quem chama: sair com o cofre já fechado também é sucesso, e devolver erro aqui só
/// prenderia a pessoa numa tela ao tentar sair.
/// </summary>
public sealed record SignOutCommand : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class SignOutHandler(IVaultService vaultService, IJournalRecorder? journal = null, TimeProvider? timeProvider = null) : IRequestHandler<SignOutCommand, UnitResult<ApiErrorDto>>
{
    public Task<UnitResult<ApiErrorDto>> Handle(SignOutCommand request, CancellationToken cancellationToken)
    {
        if (journal is not null && vaultService.IsUnlocked)
        {
            var now = (timeProvider ?? TimeProvider.System).GetUtcNow();
            journal.Record(new JournalEntryStart(now, EJournalKind.Security, "Saída do cofre", EJournalLevel.Info, "Saída do cofre."), new JournalEntryEnd(now, 0, EJournalOutcome.Ok));
        }

        vaultService.Lock();

        return Task.FromResult(UnitResult.Success<ApiErrorDto>());
    }
}
