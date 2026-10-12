using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.GetTableReferencedBy;

/// <summary>RN-CAT-004: as chaves estrangeiras de outras tabelas, e da própria, que apontam para esta. Esquema e tabela seguem como parâmetro até a consulta de catálogo.</summary>
public sealed record GetTableReferencedByCommand(Guid SessionID, string Schema, string Table) : IRequest<Result<IReadOnlyList<ReferencingForeignKeyInfo>, ApiErrorDto>>;

internal sealed class GetTableReferencedByHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetTableReferencedByCommand, Result<IReadOnlyList<ReferencingForeignKeyInfo>, ApiErrorDto>>
{
    public async Task<Result<IReadOnlyList<ReferencingForeignKeyInfo>, ApiErrorDto>> Handle(GetTableReferencedByCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetReferencingForeignKeysAsync(request.SessionID, request.Schema, request.Table, cancellationToken)).MapError(DatabaseSessionErrors.From);
}
