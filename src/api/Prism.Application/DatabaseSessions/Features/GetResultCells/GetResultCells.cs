using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Text.Json.Serialization;

namespace Prism.Application.DatabaseSessions.Features.GetResultCells;

/// <summary>
/// RN-SQL-017: o valor completo das células que chegaram cortadas, para copiar e exportar. A sessão e o resultado vêm da rota; o corpo
/// leva as células, pela linha no resultado inteiro (contando o "carregar mais") e pela coluna. Responde `{ values: [{ row, column,
/// value }] }`, na ordem pedida, com `value` nulo na célula sem valor completo.
/// </summary>
public sealed record GetResultCellsCommand : IRequest<Result<ResultCellsDto, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid SessionID { get; init; }

    [JsonIgnore]
    public Guid ResultID { get; init; }

    public IReadOnlyList<CellRefDto>? Cells { get; init; }
}

internal sealed class GetResultCellsHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetResultCellsCommand, Result<ResultCellsDto, ApiErrorDto>>
{
    public Task<Result<ResultCellsDto, ApiErrorDto>> Handle(GetResultCellsCommand request, CancellationToken cancellationToken)
    {
        IReadOnlyList<CellPosition> cells = [.. (request.Cells ?? []).Select(cell => new CellPosition(cell.Row, cell.Column))];

        return Task.FromResult(databaseSessionService.GetCells(request.SessionID, request.ResultID, cells).Map(values => new ResultCellsDto([.. cells.Zip(values, (cell, value) => new CellValueDto(cell.Row, cell.Column, value))])).MapError(DatabaseSessionErrors.From));
    }
}
