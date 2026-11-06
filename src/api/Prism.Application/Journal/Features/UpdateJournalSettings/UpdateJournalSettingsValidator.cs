using Prism.Core.Extensions;
using System.Resources;
using FluentValidation;
using Prism.Application.Journal.Models;

namespace Prism.Application.Journal.Features.UpdateJournalSettings;

public sealed class UpdateJournalSettingsValidator : AbstractValidator<UpdateJournalSettingsCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>UpdateJournalSettingsValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(UpdateJournalSettingsValidator));

    public UpdateJournalSettingsValidator()
    {
        RuleFor(x => x.RetentionDays)
            .Must(days => days is null || JournalFormat.AllowedRetentionDays.Contains(days.Value))
            .WithErrorCode("JOURNAL_SETTINGS_INVALID")
            .WithMessage(_ => Texts.Get("RetentionInvalid"));
    }
}
