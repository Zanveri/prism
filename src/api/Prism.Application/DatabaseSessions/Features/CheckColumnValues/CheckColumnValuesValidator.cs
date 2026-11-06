using FluentValidation;
using FluentValidation.Results;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Extensions;
using Prism.Infrastructure.Databases.Clients;
using System.Resources;
using System.Text.Json;

namespace Prism.Application.DatabaseSessions.Features.CheckColumnValues;

/// <summary>
/// RN-VAR-035: a coluna, com `VALUES_INVALID` no campo, e os `values`, de 1 a 1.000 na forma dos `params` (RN-VAR-032), com `QUERY_INVALID` no campo (`values` ou
/// `values[3].value`). O valor que não converte para o tipo da coluna não é recusa: falta, na resposta.
/// </summary>
public sealed class CheckColumnValuesValidator : AbstractValidator<CheckColumnValuesCommand>
{
    private static readonly ResourceManager Texts = new(typeof(CheckColumnValuesValidator));

    private const string QueryInvalidCode = "QUERY_INVALID";

    public CheckColumnValuesValidator()
        => RuleFor(request => request).Custom((request, context) =>
        {
            if (ColumnValuesRules.ColumnRefusal(request.Column) is { } column)
                context.AddFailure(new ValidationFailure(column.Field, column.Message) { ErrorCode = ColumnValuesRules.InvalidCode });

            if (request.Values is not { ValueKind: JsonValueKind.Array } values || values.GetArrayLength() is 0 or > ColumnValuesRules.MaxCheckValues)
            {
                context.AddFailure(new ValidationFailure("values", Texts.Get("ValuesInvalid")) { ErrorCode = QueryInvalidCode });

                return;
            }

            foreach (var (field, message) in QueryParameterRules.Refusals(values, "values"))
                context.AddFailure(new ValidationFailure(field, message) { ErrorCode = QueryInvalidCode });
        });
}
