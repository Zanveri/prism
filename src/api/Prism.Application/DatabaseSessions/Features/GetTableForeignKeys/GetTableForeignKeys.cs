using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.GetTableForeignKeys;

/// <summary>RN-ARVORE-003: nome, colunas e a tabela e as colunas referenciadas.</summary>
public sealed record GetTableForeignKeysCommand(Guid SessionID, string Schema, string Table) : IRequest<Result<IReadOnlyList<ForeignKeyInfo>, ApiErrorDto>>;

internal sealed class GetTableForeignKeysHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetTableForeignKeysCommand, Result<IReadOnlyList<ForeignKeyInfo>, ApiErrorDto>>
{
    public async Task<Result<IReadOnlyList<ForeignKeyInfo>, ApiErrorDto>> Handle(GetTableForeignKeysCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetForeignKeysAsync(request.SessionID, request.Schema, request.Table, cancellationToken)).MapError(DatabaseSessionErrors.From);
}
