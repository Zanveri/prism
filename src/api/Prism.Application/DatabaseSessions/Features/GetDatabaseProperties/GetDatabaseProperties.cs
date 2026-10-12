using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.GetDatabaseProperties;

/// <summary>RN-CAT-010: as propriedades que o servidor informa do banco conectado, como `{ name, value }`; a tela escreve o rótulo de cada nome.</summary>
public sealed record GetDatabasePropertiesCommand(Guid SessionID) : IRequest<Result<IReadOnlyList<DatabasePropertyInfo>, ApiErrorDto>>;

internal sealed class GetDatabasePropertiesHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetDatabasePropertiesCommand, Result<IReadOnlyList<DatabasePropertyInfo>, ApiErrorDto>>
{
    public async Task<Result<IReadOnlyList<DatabasePropertyInfo>, ApiErrorDto>> Handle(GetDatabasePropertiesCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetPropertiesAsync(request.SessionID, cancellationToken)).MapError(DatabaseSessionErrors.From);
}
