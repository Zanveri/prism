using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.GetSchemaDiagram;

/// <summary>RN-CAT-008: as tabelas do esquema e as chaves estrangeiras que saem delas, numa chamada só, para a tela desenhar o esquema inteiro.</summary>
public sealed record GetSchemaDiagramCommand(Guid SessionID, string Schema) : IRequest<Result<SchemaDiagramInfo, ApiErrorDto>>;

internal sealed class GetSchemaDiagramHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetSchemaDiagramCommand, Result<SchemaDiagramInfo, ApiErrorDto>>
{
    public async Task<Result<SchemaDiagramInfo, ApiErrorDto>> Handle(GetSchemaDiagramCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetDiagramAsync(request.SessionID, request.Schema, cancellationToken)).MapError(DatabaseSessionErrors.From);
}
