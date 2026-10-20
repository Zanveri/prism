using CSharpFunctionalExtensions;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Services;
using System.Text.Json.Serialization;

namespace Prism.Application.DatabaseSessions.Features.GetEditTarget;

/// <summary>
/// RN-EDIT-002, 003 e 010: o que se edita no resultado, consultado no catálogo na primeira tentativa de editar. `CatalogSessionID` é a
/// sessão da árvore da mesma conexão, que só a tela conhece; sem ela a consulta vai numa conexão à parte. A sessão vem da rota.
/// `Purpose` (RN-GRADE-020): `edit`, o padrão (ausente ou nulo), ou `sql`, o pedido do "Gerar SQL" e do "Copiar como" do SQL e do DbUnit, que vale
/// também na conexão somente leitura.
/// </summary>
public sealed record GetEditTargetCommand : IRequest<Result<EditTargetDto, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid SessionID { get; init; }
    public Guid ResultID { get; init; }
    public Guid? CatalogSessionID { get; init; }
    public string? Purpose { get; init; }
}

internal sealed class GetEditTargetHandler(IConnectionQueries connectionQueries, IDatabaseSessionService databaseSessionService) : IRequestHandler<GetEditTargetCommand, Result<EditTargetDto, ApiErrorDto>>
{
    public async Task<Result<EditTargetDto, ApiErrorDto>> Handle(GetEditTargetCommand request, CancellationToken cancellationToken)
    {
        // RN-PROT-002: a edição de registros não existe numa conexão somente leitura (a dela ou a de uma pasta acima, no cofre agora).
        var readOnly = await connectionQueries.IsReadOnly(databaseSessionService, request.SessionID, cancellationToken);
        if (readOnly.IsFailure)
            return Result.Failure<EditTargetDto, ApiErrorDto>(readOnly.Error);

        // RN-GRADE-020: o pedido do "Gerar SQL" só lê o catálogo, e o SQL gerado não é executado: vale na conexão somente leitura, com tudo só leitura, e o
        // alvo dele não fica guardado para o "Salvar".
        if (readOnly.Value && request.Purpose == EditChangeRules.SqlPurpose)
            return (await databaseSessionService.GetReadOnlyEditTargetAsync(request.SessionID, request.ResultID, request.CatalogSessionID, ReadOnlySql.ResultReason, cancellationToken)).Map(target => target.ToDto()).MapError(DatabaseSessionErrors.From);

        if (readOnly.Value)
            return Result.Failure<EditTargetDto, ApiErrorDto>(SessionProtections.EditsRefusal());

        return (await databaseSessionService.GetEditTargetAsync(request.SessionID, request.ResultID, request.CatalogSessionID, cancellationToken)).Map(target => target.ToDto()).MapError(DatabaseSessionErrors.From);
    }
}
