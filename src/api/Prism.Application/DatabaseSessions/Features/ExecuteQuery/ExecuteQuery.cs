using CSharpFunctionalExtensions;
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

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e o SQL do usuário pode ter dado sensível.</summary>
    public override string ToString() => nameof(ExecuteQueryCommand);
}

internal sealed class ExecuteQueryHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<ExecuteQueryCommand, Result<QueryResultDto, ApiErrorDto>>
{
    /// <summary>O validator já recusou o que não é um inteiro da faixa: aqui só há o número ou a falta dele.</summary>
    public async Task<Result<QueryResultDto, ApiErrorDto>> Handle(ExecuteQueryCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.ExecuteAsync(request.SessionID, request.Sql, request.PageSize is { ValueKind: JsonValueKind.Number } pageSize ? pageSize.GetInt32() : QueryPaging.DefaultPageSize, cancellationToken)).Map(outcome => outcome.ToDto()).MapError(DatabaseSessionErrors.From);
}
