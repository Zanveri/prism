using FluentValidation;
using FluentValidation.Results;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Text;
using System.Text.Json;

namespace Prism.Application.DatabaseSessions.Features.ExecuteQuery;

public sealed class ExecuteQueryValidator : AbstractValidator<ExecuteQueryCommand>
{
    private const int MaxHistoryTextBytes = 256 * 1024;
    private static readonly HashSet<string> AcceptedOrigins = new(StringComparer.Ordinal) { "editor", "script", "values", "statement", "rerun", "filter", "auto-refresh", "other", "records", "ddl", "build" };

    public ExecuteQueryValidator(IDatabaseSessionService databaseSessionService)
    {
        // Seção 6 da especificação: SQL vazio ou só de espaços é 422 `QUERY_INVALID`. O texto não é aparado nem alterado: o que passa vai ao banco como está (RN-SQL-003).
        RuleFor(request => request.Sql).Must(sql => !string.IsNullOrWhiteSpace(sql)).WithMessage("Informe o comando SQL.").WithErrorCode("QUERY_INVALID");

        // RN-SQL-016: um inteiro de 50 a 1000, ou nada (vale 200). Texto, número com casas e número fora da faixa são o mesmo `QUERY_INVALID`, no campo.
        RuleFor(request => request.PageSize).Must(BeAbsentOrAnAcceptedPageSize).WithMessage($"As linhas por busca devem ser um número inteiro de {QueryPaging.MinPageSize} a {QueryPaging.MaxPageSize}.").WithErrorCode("QUERY_INVALID");

        // RN-GRADE-011: o filtro com `;`, com aspas ou comentário sem fechar, que termina em comentário, com parênteses sem par ou com mais
        // de um `ORDER BY` é `FILTER_INVALID`, no campo. Quem lê é o registro de sessões, porque as aspas e os comentários são os do banco
        // da sessão; sem a sessão, nada aqui, e a execução responde que ela não existe.
        RuleFor(request => request.Filter).Custom((filter, context) =>
        {
            if (databaseSessionService.FilterRefusal(context.InstanceToValidate.SessionID, filter, HasParameters(context.InstanceToValidate.Params)) is { } refusal)
                context.AddFailure(new ValidationFailure(nameof(ExecuteQueryCommand.Filter), refusal) { ErrorCode = "FILTER_INVALID" });
        });

        // RN-VAR-032: a forma dos `params`, campo por campo (`params[3].value`, `params[3].type`) ou a lista (`params`): `QUERY_INVALID`, sem nada ir ao banco. Os marcadores
        // do texto contra os valores, e o que o banco da sessão não guarda, são do registro de sessões (`QUERY_PARAMETERS_MISMATCH`, `QUERY_INVALID` no campo).
        RuleFor(request => request.Params).Custom((parameters, context) =>
        {
            foreach (var (field, message) in QueryParameterRules.Refusals(parameters, "params"))
                context.AddFailure(new ValidationFailure(field, message) { ErrorCode = "QUERY_INVALID" });
        });

        // RN-SQL-024: uma lista de até 20 identificadores de resultado, ou nada (a sessão esquece os guardados). Mais que isso, ou uma entrada que
        // não é um identificador (nula, texto qualquer, número), é o mesmo `QUERY_INVALID`, no campo, como o `pageSize` fora da forma: nada vai ao banco.
        RuleFor(request => request.Keep).Must(BeAbsentOrAList).WithMessage("Informe em keep uma lista de identificadores de resultado (resultID).").WithErrorCode("QUERY_INVALID");
        RuleFor(request => request.Keep).Must(keep => keep is not { ValueKind: JsonValueKind.Array } list || list.GetArrayLength() <= QueryPaging.MaxKeptResults).WithMessage($"Guarde no máximo {QueryPaging.MaxKeptResults} resultados (keep).").WithErrorCode("QUERY_INVALID");

        // RN-AUDIT-002 e RN-DIARIO-007: a origem tem de ser uma das conhecidas, ou nula (vale `other`), e o historyText até 256 KiB em UTF-8.
        RuleFor(request => request.Origin).Must(origin => origin is null || AcceptedOrigins.Contains(origin)).WithMessage("A origem do comando não é válida.").WithErrorCode("QUERY_INVALID");
        RuleFor(request => request.HistoryText).Must(text => text is null || (!string.IsNullOrWhiteSpace(text) && Encoding.UTF8.GetByteCount(text) <= MaxHistoryTextBytes)).WithMessage("O texto do histórico não é válido.").WithErrorCode("QUERY_INVALID");
    }

    /// <summary>Os `params` têm ao menos um valor? Só então o filtro não pode ter marcador. A forma errada é recusada pela regra dos próprios `params`.</summary>
    private static bool HasParameters(JsonElement? parameters)
        => parameters is { ValueKind: JsonValueKind.Array } list && list.GetArrayLength() > 0;

    private static bool BeAbsentOrAnAcceptedPageSize(JsonElement? pageSize)
        => pageSize is null or { ValueKind: JsonValueKind.Null } || (pageSize.Value.ValueKind == JsonValueKind.Number && pageSize.Value.TryGetInt32(out var size) && size is >= QueryPaging.MinPageSize and <= QueryPaging.MaxPageSize);

    private static bool BeAbsentOrAList(JsonElement? keep)
        => keep is null or { ValueKind: JsonValueKind.Null } || (keep.Value.ValueKind == JsonValueKind.Array && keep.Value.EnumerateArray().All(entry => entry.ValueKind == JsonValueKind.String && entry.TryGetGuid(out _)));
}
