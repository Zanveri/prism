using FluentValidation;
using Prism.Application.DatabaseSessions.Models;

namespace Prism.Application.DatabaseSessions.Features.PreviewEdits;

public sealed class PreviewEditsValidator : AbstractValidator<PreviewEditsCommand>
{
    public PreviewEditsValidator()
    {
        RuleFor(request => request.ResultID).MustNameTheResult();
        RuleFor(request => request.Changes).MustBeChanges();
    }
}
