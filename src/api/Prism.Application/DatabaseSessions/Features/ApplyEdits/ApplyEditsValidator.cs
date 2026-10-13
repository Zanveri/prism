using FluentValidation;
using Prism.Application.DatabaseSessions.Models;

namespace Prism.Application.DatabaseSessions.Features.ApplyEdits;

public sealed class ApplyEditsValidator : AbstractValidator<ApplyEditsCommand>
{
    public ApplyEditsValidator()
    {
        RuleFor(request => request.ResultID).MustNameTheResult();
        RuleFor(request => request.Changes).MustBeChanges();
    }
}
