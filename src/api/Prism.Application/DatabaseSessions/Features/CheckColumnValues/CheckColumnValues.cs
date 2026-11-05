using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Services;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Prism.Application.DatabaseSessions.Features.CheckColumnValues;

/// <summary>
/// RN-VAR-035: quais dos valores não existem na coluna (a conferência do valor digitado no diálogo, RN-VAR-031). Os `values` vêm na forma dos `params` (RN-VAR-032),
/// como o JSON que veio, para a forma errada ser `QUERY_INVALID` no campo. A sessão, o esquema e a tabela vêm da rota.
/// </summary>
public sealed record CheckColumnValuesCommand : IRequest<Result<ColumnValuesCheckDto, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid SessionID { get; init; }

    [JsonIgnore]
    public string Schema { get; init; } = string.Empty;

    [JsonIgnore]
    public string Table { get; init; } = string.Empty;

    public string? Column { get; init; }
    public JsonElement? Values { get; init; }

    /// <summary>RN-VAR-036: os valores são da pessoa.</summary>
    public override string ToString() => nameof(CheckColumnValuesCommand);
}

internal sealed class CheckColumnValuesHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<CheckColumnValuesCommand, Result<ColumnValuesCheckDto, ApiErrorDto>>
{
    public async Task<Result<ColumnValuesCheckDto, ApiErrorDto>> Handle(CheckColumnValuesCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.CheckColumnValuesAsync(request.SessionID, request.Schema, request.Table, request.Column!, QueryParameterRules.Read(request.Values), cancellationToken)).Map(missing => new ColumnValuesCheckDto(missing)).MapError(DatabaseSessionErrors.From);
}
