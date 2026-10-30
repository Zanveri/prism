using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Sessions.Models.Dtos;
using Prism.Application.Users.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Clients;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using System.Globalization;

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

internal sealed class SignInHandler(IVaultService vaultService, ISignInAttemptsFile? attemptsFile = null, IJournalRecorder? journal = null, TimeProvider? timeProvider = null) : IRequestHandler<SignInCommand, Result<SessionDto, ApiErrorDto>>
{
    public async Task<Result<SessionDto, ApiErrorDto>> Handle(SignInCommand request, CancellationToken cancellationToken)
    {
        var clock = timeProvider ?? TimeProvider.System;
        var startedAt = clock.GetUtcNow();

        // Só normaliza; quem recusa o que não é um nome de cofre é o próprio serviço, e com a derivação feita. A senha segue como veio.
        var userName = UserNameRules.Normalize(request.UserName);

        var unlocked = await vaultService.UnlockAsync(userName, request.Password, cancellationToken);
        var endedAt = clock.GetUtcNow();
        if (unlocked.IsFailure)
        {
            if (unlocked.Error == EVaultError.InvalidCredentials)
                attemptsFile?.Add(userName, TimeZoneInfo.ConvertTime(endedAt, clock.LocalTimeZone));

            return Result.Failure<SessionDto, ApiErrorDto>(VaultErrors.From(unlocked.Error));
        }

        var attempts = attemptsFile?.Take(userName) ?? [];
        if (attempts.Count > 0)
        {
            var summary = FormatWrongAttempts(attempts, clock.LocalTimeZone);
            journal?.Record(new JournalEntryStart(endedAt, EJournalKind.Security, summary, EJournalLevel.High, summary), new JournalEntryEnd(endedAt, 0, EJournalOutcome.Ok));
        }

        var durationMs = Math.Max(0L, (long)(endedAt - startedAt).TotalMilliseconds);
        journal?.Record(new JournalEntryStart(startedAt, EJournalKind.Security, "Entrada no cofre", EJournalLevel.Info, "Entrada no cofre."), new JournalEntryEnd(endedAt, durationMs, EJournalOutcome.Ok));

        return Result.Success<SessionDto, ApiErrorDto>(new SessionDto { Unlocked = true, UserName = userName });
    }

    private static string FormatWrongAttempts(IReadOnlyList<DateTimeOffset> attempts, TimeZoneInfo timeZone)
    {
        var parts = new List<string>(attempts.Count);
        DateOnly? previousDay = null;
        foreach (var attempt in attempts)
        {
            var local = TimeZoneInfo.ConvertTime(attempt, timeZone);
            var day = DateOnly.FromDateTime(local.DateTime);
            parts.Add(previousDay == day ? local.ToString("HH:mm", CultureInfo.InvariantCulture) : local.ToString("dd/MM HH:mm", CultureInfo.InvariantCulture));
            previousDay = day;
        }

        var times = string.Join(", ", parts);

        return attempts.Count == 1
            ? $"1 entrada com senha errada desde a última ({times})"
            : $"{attempts.Count} entradas com senha errada desde a última ({times})";
    }
}
