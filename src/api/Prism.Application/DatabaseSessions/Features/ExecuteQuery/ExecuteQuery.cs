using CSharpFunctionalExtensions;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Prism.Application.DatabaseSessions.Features.ExecuteQuery;

/// <summary>
/// RN-SQL-001 e 003: um comando, enviado ao banco como está. A sessão vem da rota, e o `[JsonIgnore]` impede que o corpo a escolha: o
/// controller completa o comando com `with { SessionID = id }`.
/// </summary>
public sealed record ExecuteQueryCommand : IRequest<Result<QueryResultDto, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid SessionID { get; init; }
    public string Sql { get; init; } = string.Empty;

    /// <summary>
    /// RN-SQL-016: as linhas por busca, de 50 a 1000; ausente (ou nulo), 200. Chega como o JSON que veio, e não como inteiro, para o
    /// texto e o número com casas serem recusados pelo validator com `QUERY_INVALID` no campo, como o SQL vazio: lidos como inteiro, o
    /// MVC os recusaria antes, com 400 e em outro formato.
    /// </summary>
    public JsonElement? PageSize { get; init; }

    /// <summary>
    /// RN-GRADE-011: o filtro do resultado, o texto do campo (condição, ordem ou as duas, como na RN-TABELA-010), que a API junta ao
    /// comando ou põe por fora dele. Ausente, nulo ou só de espaços, o comando vai sem filtro.
    /// </summary>
    public string? Filter { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e o SQL do usuário pode ter dado sensível.</summary>
    public override string ToString() => nameof(ExecuteQueryCommand);
}

internal sealed class ExecuteQueryHandler(IConnectionQueries connectionQueries, IDatabaseSessionService databaseSessionService) : IRequestHandler<ExecuteQueryCommand, Result<QueryResultDto, ApiErrorDto>>
{
    /// <summary>
    /// O validator já recusou o que não é um inteiro da faixa (aqui só há o número ou a falta dele) e o filtro que não se junta ao
    /// comando. Sem filtro (nulo ou só de espaços), o comando vai como veio. RN-PROT-002 e 006: a conexão somente leitura é a do cofre agora,
    /// e o registro de sessões recusa o que não é leitura antes de ir ao banco.
    /// </summary>
    public async Task<Result<QueryResultDto, ApiErrorDto>> Handle(ExecuteQueryCommand request, CancellationToken cancellationToken)
    {
        var readOnly = await connectionQueries.IsReadOnly(databaseSessionService, request.SessionID, cancellationToken);
        if (readOnly.IsFailure)
            return Result.Failure<QueryResultDto, ApiErrorDto>(readOnly.Error);

        var pageSize = request.PageSize is { ValueKind: JsonValueKind.Number } size ? size.GetInt32() : QueryPaging.DefaultPageSize;
        var filter = string.IsNullOrWhiteSpace(request.Filter) ? null : request.Filter;
        var outcome = await databaseSessionService.ExecuteAsync(request.SessionID, request.Sql, filter, pageSize, readOnly.Value, cancellationToken);

        return outcome.Map(executed => executed.ToDto()).MapError(DatabaseSessionErrors.From);
    }
}
