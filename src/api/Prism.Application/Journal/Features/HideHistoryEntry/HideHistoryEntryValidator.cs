using FluentValidation;

namespace Prism.Application.Journal.Features.HideHistoryEntry;

public sealed class HideHistoryEntryValidator : AbstractValidator<HideHistoryEntryCommand>
{
    public HideHistoryEntryValidator()
    {
        RuleFor(x => x.Id)
            .GreaterThan(0)
            .WithErrorCode("JOURNAL_ENTRY_NOT_FOUND")
            .WithMessage("O identificador do registro deve ser positivo.");
    }
}
