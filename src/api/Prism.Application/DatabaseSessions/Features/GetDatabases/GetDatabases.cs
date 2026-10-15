using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.GetDatabases;

/// <summary>RN-ARVORE-006: os bancos do servidor da sessão, como `{ name, isCurrent }`, com o da sessão primeiro.</summary>
public sealed record GetDatabasesCommand(Guid SessionID) : IRequest<Result<IReadOnlyList<DatabaseInfo>, ApiErrorDto>>;

internal sealed class GetDatabasesHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetDatabasesCommand, Result<IReadOnlyList<DatabaseInfo>, ApiErrorDto>>
{
    public async Task<Result<IReadOnlyList<DatabaseInfo>, ApiErrorDto>> Handle(GetDatabasesCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetDatabasesAsync(request.SessionID, cancellationToken)).MapError(DatabaseSessionErrors.From);
}
