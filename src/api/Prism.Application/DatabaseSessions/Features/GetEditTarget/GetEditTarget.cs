using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;
using System.Text.Json.Serialization;

namespace Prism.Application.DatabaseSessions.Features.GetEditTarget;

/// <summary>
/// RN-EDIT-002, 003 e 010: o que se edita no resultado, consultado no catálogo na primeira tentativa de editar. `CatalogSessionID` é a
/// sessão da árvore da mesma conexão, que só a tela conhece; sem ela a consulta vai numa conexão à parte. A sessão vem da rota.
/// </summary>
public sealed record GetEditTargetCommand : IRequest<Result<EditTargetDto, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid SessionID { get; init; }
    public Guid ResultID { get; init; }
    public Guid? CatalogSessionID { get; init; }
}

internal sealed class GetEditTargetHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetEditTargetCommand, Result<EditTargetDto, ApiErrorDto>>
{
    public async Task<Result<EditTargetDto, ApiErrorDto>> Handle(GetEditTargetCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetEditTargetAsync(request.SessionID, request.ResultID, request.CatalogSessionID, cancellationToken)).Map(target => target.ToDto()).MapError(DatabaseSessionErrors.From);
}
