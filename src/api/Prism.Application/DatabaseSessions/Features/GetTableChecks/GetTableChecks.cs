using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.GetTableChecks;

/// <summary>RN-CAT-005: o nome e a condição de cada restrição de conferência da tabela.</summary>
public sealed record GetTableChecksCommand(Guid SessionID, string Schema, string Table) : IRequest<Result<IReadOnlyList<CheckConstraintInfo>, ApiErrorDto>>;

internal sealed class GetTableChecksHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetTableChecksCommand, Result<IReadOnlyList<CheckConstraintInfo>, ApiErrorDto>>
{
    public async Task<Result<IReadOnlyList<CheckConstraintInfo>, ApiErrorDto>> Handle(GetTableChecksCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetChecksAsync(request.SessionID, request.Schema, request.Table, cancellationToken)).MapError(DatabaseSessionErrors.From);
}
