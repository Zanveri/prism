using FluentValidation;
using Prism.Infrastructure.Databases.Models;
using System.Text.Json;

namespace Prism.Application.DatabaseSessions.Features.ExecuteQuery;

public sealed class ExecuteQueryValidator : AbstractValidator<ExecuteQueryCommand>
{
    public ExecuteQueryValidator()
    {
        // Seção 6 da especificação: SQL vazio ou só de espaços é 422 `QUERY_INVALID`. O texto não é aparado nem alterado: o que passa vai ao banco como está (RN-SQL-003).
        RuleFor(request => request.Sql).Must(sql => !string.IsNullOrWhiteSpace(sql)).WithMessage("Informe o comando SQL.").WithErrorCode("QUERY_INVALID");

        // RN-SQL-016: um inteiro de 50 a 1000, ou nada (vale 200). Texto, número com casas e número fora da faixa são o mesmo `QUERY_INVALID`, no campo.
        RuleFor(request => request.PageSize).Must(BeAbsentOrAnAcceptedPageSize).WithMessage($"As linhas por busca devem ser um número inteiro de {QueryPaging.MinPageSize} a {QueryPaging.MaxPageSize}.").WithErrorCode("QUERY_INVALID");
    }

    private static bool BeAbsentOrAnAcceptedPageSize(JsonElement? pageSize)
        => pageSize is null or { ValueKind: JsonValueKind.Null } || (pageSize.Value.ValueKind == JsonValueKind.Number && pageSize.Value.TryGetInt32(out var size) && size is >= QueryPaging.MinPageSize and <= QueryPaging.MaxPageSize);
}
