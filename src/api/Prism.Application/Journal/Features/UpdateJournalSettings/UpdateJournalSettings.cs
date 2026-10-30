using CSharpFunctionalExtensions;
using Prism.Application.Journal.Models;
using Prism.Application.Journal.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;

namespace Prism.Application.Journal.Features.UpdateJournalSettings;

public sealed record UpdateJournalSettingsCommand : IRequest<Result<JournalSettingsDto, ApiErrorDto>>
{
    public int? RetentionDays { get; init; }

    public override string ToString() => nameof(UpdateJournalSettingsCommand);
}

internal sealed class UpdateJournalSettingsHandler(IJournalService journalService, TimeProvider? timeProvider = null) : IRequestHandler<UpdateJournalSettingsCommand, Result<JournalSettingsDto, ApiErrorDto>>
{
    public async Task<Result<JournalSettingsDto, ApiErrorDto>> Handle(UpdateJournalSettingsCommand request, CancellationToken cancellationToken)
    {
        var clock = timeProvider ?? TimeProvider.System;
        var startedAt = clock.GetUtcNow();

        var previousResult = await journalService.GetRetentionAsync(cancellationToken);
        if (previousResult.IsFailure)
            return Result.Failure<JournalSettingsDto, ApiErrorDto>(JournalErrors.From(previousResult.Error));

        var previousDays = previousResult.Value;
        int? targetDays = request.RetentionDays is null or 0 ? null : request.RetentionDays;

        var setResult = await journalService.SetRetentionAsync(targetDays, cancellationToken);
        if (setResult.IsFailure)
            return Result.Failure<JournalSettingsDto, ApiErrorDto>(JournalErrors.From(setResult.Error));

        if (previousDays != targetDays)
        {
            var shortened = previousDays is null
                ? targetDays is not null
                : targetDays is not null && targetDays.Value < previousDays.Value;

            var endedAt = clock.GetUtcNow();
            var durationMs = Math.Max(0L, (long)(endedAt - startedAt).TotalMilliseconds);
            var action = shortened ? "Guarda do diário encurtada" : "Guarda do diário alongada";
            var level = shortened ? EJournalLevel.High : EJournalLevel.Info;
            var reason = $"Guarda do diário alterada de {JournalFormat.FormatRetentionLabel(previousDays)} para {JournalFormat.FormatRetentionLabel(targetDays)}.";

            journalService.Record(
                new JournalEntryStart(startedAt, EJournalKind.Security, action, level, reason),
                new JournalEntryEnd(endedAt, durationMs, EJournalOutcome.Ok));
        }

        return Result.Success<JournalSettingsDto, ApiErrorDto>(new JournalSettingsDto
        {
            RetentionDays = targetDays ?? 0
        });
    }
}
