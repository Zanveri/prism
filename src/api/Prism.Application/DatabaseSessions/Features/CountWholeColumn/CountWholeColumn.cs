using CSharpFunctionalExtensions;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;
using System.Text.Json.Serialization;

namespace Prism.Application.DatabaseSessions.Features.CountWholeColumn;

/// <summary>
/// RN-EDIT-019 e 023: a contagem da coluna inteira, antes da pergunta do "Salvar", na sessão da aba. `changes` leva só a alteração da coluna inteira
/// (`updateAll`). Responde `{ rows }`.
/// </summary>
public sealed record CountWholeColumnCommand : IRequest<Result<WholeColumnCountDto, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid SessionID { get; init; }
    public Guid ResultID { get; init; }
    public IReadOnlyList<EditChangeDto>? Changes { get; init; }

    /// <summary>RN-LOG-001: os valores das células são dados do usuário.</summary>
    public override string ToString() => nameof(CountWholeColumnCommand);
}

internal sealed class CountWholeColumnHandler(IConnectionQueries connectionQueries, IDatabaseSessionService databaseSessionService) : IRequestHandler<CountWholeColumnCommand, Result<WholeColumnCountDto, ApiErrorDto>>
{
    public async Task<Result<WholeColumnCountDto, ApiErrorDto>> Handle(CountWholeColumnCommand request, CancellationToken cancellationToken)
    {
        // RN-PROT-002: a edição de registros, e com ela a contagem da coluna inteira, não existe numa conexão somente leitura.
        var readOnly = await connectionQueries.IsReadOnly(databaseSessionService, request.SessionID, cancellationToken);
        if (readOnly.IsFailure)
            return Result.Failure<WholeColumnCountDto, ApiErrorDto>(readOnly.Error);

        if (readOnly.Value)
            return Result.Failure<WholeColumnCountDto, ApiErrorDto>(SessionProtections.EditsRefusal());

        return (await databaseSessionService.CountWholeColumnAsync(request.SessionID, request.ResultID, request.Changes.ToChanges(), cancellationToken)).Map(rows => new WholeColumnCountDto(rows)).MapError(DatabaseSessionErrors.From);
    }
}
