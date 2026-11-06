using FluentValidation;
using FluentValidation.Results;
using Prism.Application.Scripts.Models;
using Prism.Core.Extensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using System.Resources;
using System.Text.Json;

namespace Prism.Application.DatabaseSessions.Features.ExecuteVariableQuery;

/// <summary>
/// RN-VAR-034, a forma, antes de qualquer coisa ir ao banco: o `sql` vazio ou de mais de 1 MB, os `params` como na RN-VAR-032 e o `maxRows` fora de 1 a 10.000 são
/// `QUERY_INVALID`, no campo (em camelCase, como a especificação o escreve). Um comando só, os marcadores contra os valores e a leitura são do registro de sessões.
/// </summary>
public sealed class ExecuteVariableQueryValidator : AbstractValidator<ExecuteVariableQueryCommand>
{
    private static readonly ResourceManager Texts = new(typeof(ExecuteVariableQueryValidator));

    private const string Code = "QUERY_INVALID";

    public ExecuteVariableQueryValidator()
        => RuleFor(request => request).Custom((request, context) =>
        {
            if (string.IsNullOrWhiteSpace(request.Sql))
                context.AddFailure(new ValidationFailure("sql", Texts.Get("SqlRequired")) { ErrorCode = Code });
            else if (!ScriptRules.FitsTheLimit(request.Sql))
                context.AddFailure(new ValidationFailure("sql", Texts.Get("SqlTooLarge")) { ErrorCode = Code });

            foreach (var (field, message) in QueryParameterRules.Refusals(request.Params, "params"))
                context.AddFailure(new ValidationFailure(field, message) { ErrorCode = Code });

            if (!BeAbsentOrAnAcceptedRowLimit(request.MaxRows))
                context.AddFailure(new ValidationFailure("maxRows", Texts.Get("MaxRowsInvalid")) { ErrorCode = Code });
        });

    private static bool BeAbsentOrAnAcceptedRowLimit(JsonElement? maxRows)
        => maxRows is null or { ValueKind: JsonValueKind.Null } || (maxRows.Value.ValueKind == JsonValueKind.Number && maxRows.Value.TryGetInt32(out var rows) && rows is >= 1 and <= QueryPaging.MaxVariableRows);
}
