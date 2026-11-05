using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Prism.Application.DatabaseSessions.Features.ExecuteVariableQuery;

/// <summary>
/// RN-VAR-034: a consulta de uma variável (RN-VAR-011), na sessão da rota, como um comando, mas sem virar o resultado da tela. A sessão vem da rota (`[JsonIgnore]`),
/// como no `ExecuteQueryCommand`. Não entra no diário: a RN-AUDIT-002 não a lista entre os comandos registrados.
/// </summary>
public sealed record ExecuteVariableQueryCommand : IRequest<Result<VariableQueryResultDto, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid SessionID { get; init; }
    public string Sql { get; init; } = string.Empty;

    /// <summary>RN-VAR-032: os valores dos marcadores, na forma dos `params` do `queries`, que chegam como o JSON que veio para a forma errada ser `QUERY_INVALID` no campo.</summary>
    public JsonElement? Params { get; init; }

    /// <summary>RN-VAR-034: as linhas que a consulta lê, de 1 a 10.000; ausente ou nulo, 10.000. Chega como o JSON que veio, como o `pageSize` do `queries`.</summary>
    public JsonElement? MaxRows { get; init; }

    /// <summary>RN-VAR-036: o SQL e os valores são da pessoa.</summary>
    public override string ToString() => nameof(ExecuteVariableQueryCommand);

    /// <summary>O `maxRows` já conferido pelo validator.</summary>
    internal int RowLimit()
        => MaxRows is { ValueKind: JsonValueKind.Number } rows ? rows.GetInt32() : QueryPaging.MaxVariableRows;
}

internal sealed class ExecuteVariableQueryHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<ExecuteVariableQueryCommand, Result<VariableQueryResultDto, ApiErrorDto>>
{
    public async Task<Result<VariableQueryResultDto, ApiErrorDto>> Handle(ExecuteVariableQueryCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.ExecuteVariableAsync(request.SessionID, request.Sql, QueryParameterRules.Read(request.Params), request.RowLimit(), cancellationToken)).Map(rows => rows.ToDto()).MapError(DatabaseSessionErrors.From);
}
