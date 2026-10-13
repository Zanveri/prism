using FluentValidation;
using Prism.Application.DatabaseSessions.Models;

namespace Prism.Application.DatabaseSessions.Features.GetEditTarget;

public sealed class GetEditTargetValidator : AbstractValidator<GetEditTargetCommand>
{
    public GetEditTargetValidator()
        => RuleFor(request => request.ResultID).MustNameTheResult();
}
