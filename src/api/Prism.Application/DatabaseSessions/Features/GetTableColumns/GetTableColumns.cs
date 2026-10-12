using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.GetTableColumns;

/// <summary>RN-ARVORE-003: nome, tipo, se aceita nulo e se faz parte da chave primária. Esquema e tabela seguem como parâmetro até a consulta de catálogo.</summary>
public sealed record GetTableColumnsCommand(Guid SessionID, string Schema, string Table) : IRequest<Result<IReadOnlyList<ColumnInfo>, ApiErrorDto>>;

internal sealed class GetTableColumnsHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetTableColumnsCommand, Result<IReadOnlyList<ColumnInfo>, ApiErrorDto>>
{
    public async Task<Result<IReadOnlyList<ColumnInfo>, ApiErrorDto>> Handle(GetTableColumnsCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetColumnsAsync(request.SessionID, request.Schema, request.Table, cancellationToken)).MapError(DatabaseSessionErrors.From);
}
