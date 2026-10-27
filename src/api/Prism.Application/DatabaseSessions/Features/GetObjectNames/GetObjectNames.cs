using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.GetObjectNames;

/// <summary>
/// RN-BUSCA-002: o índice de nomes da busca, as tabelas e as visões de todos os esquemas do banco da sessão. A resposta é o próprio
/// `ObjectNamesInfo` da Infrastructure, pelo mesmo motivo do `GetSchemas`: é público e tem os campos que a tela valida.
/// </summary>
public sealed record GetObjectNamesCommand(Guid SessionID) : IRequest<Result<ObjectNamesInfo, ApiErrorDto>>;

internal sealed class GetObjectNamesHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<GetObjectNamesCommand, Result<ObjectNamesInfo, ApiErrorDto>>
{
    public async Task<Result<ObjectNamesInfo, ApiErrorDto>> Handle(GetObjectNamesCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.GetObjectNamesAsync(request.SessionID, cancellationToken)).MapError(DatabaseSessionErrors.From);
}
