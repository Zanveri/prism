using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.GetViewDefinition;

/// <summary>RN-CAT-006: o texto que o banco guarda para a visão, ou `{ definition: null }` quando ele não devolve nada.</summary>
public sealed record GetViewDefinitionCommand(Guid SessionID, string Schema, string View) : IRequest<Result<ViewDefinitionInfo, ApiErrorDto>>;

internal sealed class GetViewDefinitionHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetViewDefinitionCommand, Result<ViewDefinitionInfo, ApiErrorDto>>
{
    public async Task<Result<ViewDefinitionInfo, ApiErrorDto>> Handle(GetViewDefinitionCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetViewDefinitionAsync(request.SessionID, request.Schema, request.View, cancellationToken)).MapError(DatabaseSessionErrors.From);
}
