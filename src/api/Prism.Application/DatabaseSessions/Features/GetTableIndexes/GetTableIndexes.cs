using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.GetTableIndexes;

/// <summary>RN-ARVORE-003: nome, colunas e se é único.</summary>
public sealed record GetTableIndexesCommand(Guid SessionID, string Schema, string Table) : IRequest<Result<IReadOnlyList<IndexInfo>, ApiErrorDto>>;

internal sealed class GetTableIndexesHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetTableIndexesCommand, Result<IReadOnlyList<IndexInfo>, ApiErrorDto>>
{
    public async Task<Result<IReadOnlyList<IndexInfo>, ApiErrorDto>> Handle(GetTableIndexesCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetIndexesAsync(request.SessionID, request.Schema, request.Table, cancellationToken)).MapError(DatabaseSessionErrors.From);
}
