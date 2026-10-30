using FluentValidation;

namespace Prism.Application.Journal.Features.GetAuditEntry;

public sealed class GetAuditEntryValidator : AbstractValidator<GetAuditEntryCommand>
{
    public GetAuditEntryValidator()
    {
        RuleFor(x => x.Id)
            .GreaterThan(0)
            .WithErrorCode("JOURNAL_ENTRY_NOT_FOUND")
            .WithMessage("O identificador do registro deve ser positivo.");
    }
}
