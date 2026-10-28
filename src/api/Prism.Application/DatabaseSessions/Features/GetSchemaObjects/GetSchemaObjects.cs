using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.GetSchemaObjects;

/// <param name="Kind">`tables`, `views`, `routines` ou `sequences` (o validator recusa outro valor). O esquema segue como parâmetro até a consulta de catálogo: nunca entra em SQL por concatenação.</param>
public sealed record GetSchemaObjectsCommand(Guid SessionID, string Schema, string Kind) : IRequest<Result<IReadOnlyList<DatabaseObjectInfo>, ApiErrorDto>>;

internal sealed class GetSchemaObjectsHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetSchemaObjectsCommand, Result<IReadOnlyList<DatabaseObjectInfo>, ApiErrorDto>>
{
    public async Task<Result<IReadOnlyList<DatabaseObjectInfo>, ApiErrorDto>> Handle(GetSchemaObjectsCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetObjectsAsync(request.SessionID, request.Schema, request.Kind, cancellationToken)).MapError(DatabaseSessionErrors.From);
}
