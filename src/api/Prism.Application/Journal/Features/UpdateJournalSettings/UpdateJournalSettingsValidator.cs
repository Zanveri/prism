using FluentValidation;
using Prism.Application.Journal.Models;

namespace Prism.Application.Journal.Features.UpdateJournalSettings;

public sealed class UpdateJournalSettingsValidator : AbstractValidator<UpdateJournalSettingsCommand>
{
    public UpdateJournalSettingsValidator()
    {
        RuleFor(x => x.RetentionDays)
            .Must(days => days is null || JournalFormat.AllowedRetentionDays.Contains(days.Value))
            .WithErrorCode("JOURNAL_SETTINGS_INVALID")
            .WithMessage("O período de guarda deve ser 30, 90, 180, 365 dias ou Sempre (0).");
    }
}
