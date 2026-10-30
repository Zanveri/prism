using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Models;
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

internal sealed class ChangePasswordHandler(IVaultService vaultService, IJournalService? journalService = null, TimeProvider? timeProvider = null) : IRequestHandler<ChangePasswordCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(ChangePasswordCommand request, CancellationToken cancellationToken)
    {
        var clock = timeProvider ?? TimeProvider.System;
        var startedAt = clock.GetUtcNow();

        // Conferir a senha atual, recusar a igual, re-embrulhar e gravar são uma operação só do serviço, com o cofre reservado: uma conferência feita
        // aqui, fora do semáforo, poderia ser de um cofre que outro usuário já trocou quando a gravação acontecesse.
        var changed = await vaultService.ChangePasswordAsync(request.CurrentPassword, request.NewPassword, cancellationToken, journalService is null ? null : journalService.RekeyAsync, journalService is null ? null : journalService.RevertRekeyAsync);
        var endedAt = clock.GetUtcNow();
        var durationMs = Math.Max(0L, (long)(endedAt - startedAt).TotalMilliseconds);
        if (changed.IsFailure)
        {
            var error = VaultErrors.From(changed.Error);
            if (changed.Error == EVaultError.CurrentPasswordInvalid)
                journalService?.Record(new JournalEntryStart(startedAt, EJournalKind.Security, "Senha errada numa conferência", EJournalLevel.Warning, "Senha atual errada na troca de senha."), new JournalEntryEnd(endedAt, durationMs, EJournalOutcome.Error, ErrorCode: error.Type));

            return UnitResult.Failure(error);
        }

        journalService?.CommitRekey();
        journalService?.Record(new JournalEntryStart(startedAt, EJournalKind.Security, "Troca de senha", EJournalLevel.High, "Troca da senha do cofre e da chave do diário."), new JournalEntryEnd(endedAt, durationMs, EJournalOutcome.Ok));

        return UnitResult.Success<ApiErrorDto>();
    }
}
