using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.FetchNextPage;

/// <summary>RN-SQL-005 e 016: as próximas linhas do mesmo cursor, no tamanho de página com que ele foi aberto, sem executar de novo.</summary>
public sealed record FetchNextPageCommand(Guid SessionID) : IRequest<Result<QueryResultDto, ApiErrorDto>>;

internal sealed class FetchNextPageHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<FetchNextPageCommand, Result<QueryResultDto, ApiErrorDto>>
{
    public async Task<Result<QueryResultDto, ApiErrorDto>> Handle(FetchNextPageCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.FetchNextAsync(request.SessionID, cancellationToken)).Map(page => page.ToDto() with { Transaction = databaseSessionService.TransactionOf(request.SessionID)?.ToDto() }).MapError(DatabaseSessionErrors.From);
}
