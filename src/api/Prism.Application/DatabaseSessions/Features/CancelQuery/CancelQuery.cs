using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.CancelQuery;

/// <summary>RN-SQL-010: interrompe o comando e a contagem em andamento; um cursor aberto e parado não é afetado.</summary>
public sealed record CancelQueryCommand(Guid SessionID) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class CancelQueryHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<CancelQueryCommand, UnitResult<ApiErrorDto>>
{
    public Task<UnitResult<ApiErrorDto>> Handle(CancelQueryCommand request, CancellationToken cancellationToken)
        => Task.FromResult(databaseSessionService.Cancel(request.SessionID).MapError(DatabaseSessionErrors.From));
}
