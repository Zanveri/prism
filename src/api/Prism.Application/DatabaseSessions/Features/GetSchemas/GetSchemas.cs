using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.GetSchemas;

/// <summary>
/// RN-ARVORE-001. A resposta é o próprio `SchemaInfo` da Infrastructure: é público e tem os campos que a tela valida, então não ganha
/// um DTO igual a ele. Vale o mesmo para os objetos, as colunas, os índices e as chaves estrangeiras.
/// </summary>
public sealed record GetSchemasCommand(Guid SessionID) : IRequest<Result<IReadOnlyList<SchemaInfo>, ApiErrorDto>>;

internal sealed class GetSchemasHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetSchemasCommand, Result<IReadOnlyList<SchemaInfo>, ApiErrorDto>>
{
    public async Task<Result<IReadOnlyList<SchemaInfo>, ApiErrorDto>> Handle(GetSchemasCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetSchemasAsync(request.SessionID, cancellationToken)).MapError(DatabaseSessionErrors.From);
}
