using FluentValidation;
using FluentValidation.Results;
using Prism.Application.DatabaseSessions.Models;

namespace Prism.Application.DatabaseSessions.Features.GetColumnValues;

/// <summary>RN-VAR-035: a forma do pedido, cada recusa com `VALUES_INVALID` no campo (`ColumnValuesRules`). O catálogo confere o resto, na sessão.</summary>
public sealed class GetColumnValuesValidator : AbstractValidator<GetColumnValuesCommand>
{
    public GetColumnValuesValidator()
        => RuleFor(request => request).Custom((request, context) =>
        {
            foreach (var (field, message) in ColumnValuesRules.Refusals(request.Column, request.Search, request.Offset, request.Limit, request.Total))
                context.AddFailure(new ValidationFailure(field, message) { ErrorCode = ColumnValuesRules.InvalidCode });
        });
}
