using FluentValidation;

namespace Prism.Application.Journal.Features.HideConnectionHistory;

public sealed class HideConnectionHistoryValidator : AbstractValidator<HideConnectionHistoryCommand>
{
    public HideConnectionHistoryValidator()
    {
        RuleFor(x => x.ConnectionId)
            .Must(id => !string.IsNullOrWhiteSpace(id) && Guid.TryParse(id, out var parsed) && parsed != Guid.Empty)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("Informe uma conexão válida para limpar o histórico.");
    }
}
