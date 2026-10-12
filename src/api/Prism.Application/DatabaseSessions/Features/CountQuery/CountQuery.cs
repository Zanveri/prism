using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.CountQuery;

/// <summary>RN-SQL-006: o total só é contado quando o usuário pede.</summary>
public sealed record CountQueryCommand(Guid SessionID) : IRequest<Result<QueryCountDto, ApiErrorDto>>;

internal sealed class CountQueryHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<CountQueryCommand, Result<QueryCountDto, ApiErrorDto>>
{
    public async Task<Result<QueryCountDto, ApiErrorDto>> Handle(CountQueryCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.CountAsync(request.SessionID, cancellationToken)).Map(total => new QueryCountDto(total)).MapError(DatabaseSessionErrors.From);
}
