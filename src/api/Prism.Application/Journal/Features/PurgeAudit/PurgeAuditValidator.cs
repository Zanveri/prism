using FluentValidation;

namespace Prism.Application.Journal.Features.PurgeAudit;

public sealed class PurgeAuditValidator : AbstractValidator<PurgeAuditCommand>
{
    public PurgeAuditValidator()
    {
        RuleFor(x => x.Before)
            .Must(before => before != default)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("Informe a data limite para apagar os registros.");
    }
}
