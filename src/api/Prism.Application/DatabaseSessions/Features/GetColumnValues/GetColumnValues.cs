using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Prism.Application.DatabaseSessions.Features.GetColumnValues;

/// <summary>
/// RN-VAR-035: os valores diferentes e não nulos de uma coluna, para a escolha do diálogo (RN-VAR-031) e o `random.of` (RN-VAR-010). A sessão, o esquema e a tabela
/// vêm da rota (`[JsonIgnore]`); os números e o `total` chegam como o JSON que veio, para o tipo errado ser `VALUES_INVALID` no campo, e não o 400 do MVC.
/// </summary>
public sealed record GetColumnValuesCommand : IRequest<Result<ColumnValuesDto, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid SessionID { get; init; }

    [JsonIgnore]
    public string Schema { get; init; } = string.Empty;

    [JsonIgnore]
    public string Table { get; init; } = string.Empty;

    public string? Column { get; init; }
    public string? Description { get; init; }

    /// <summary>RN-VAR-036: o texto da busca nunca vai ao log.</summary>
    public string? Search { get; init; }
    public JsonElement? Offset { get; init; }
    public JsonElement? Limit { get; init; }
    public JsonElement? Total { get; init; }

    /// <summary>RN-VAR-036: a busca é texto da pessoa.</summary>
    public override string ToString() => nameof(GetColumnValuesCommand);

    /// <summary>O pedido já conferido pelo validator.</summary>
    internal ColumnValuesRequest ToRequest()
    {
        var (offset, limit, total) = ColumnValuesRules.Read(Offset, Limit, Total);

        return new ColumnValuesRequest(Column!, Description, Search, offset, limit, total);
    }
}

internal sealed class GetColumnValuesHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetColumnValuesCommand, Result<ColumnValuesDto, ApiErrorDto>>
{
    public async Task<Result<ColumnValuesDto, ApiErrorDto>> Handle(GetColumnValuesCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetColumnValuesAsync(request.SessionID, request.Schema, request.Table, request.ToRequest(), cancellationToken)).Map(page => page.ToDto()).MapError(DatabaseSessionErrors.From);
}
