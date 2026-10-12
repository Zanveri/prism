using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.CloseDatabaseSession;

/// <summary>RN-SESSAO-004: a tela fecha a sessão ao fechar a aba e ao desconectar a conexão.</summary>
public sealed record CloseDatabaseSessionCommand(Guid SessionID) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class CloseDatabaseSessionHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<CloseDatabaseSessionCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(CloseDatabaseSessionCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.CloseAsync(request.SessionID)).MapError(DatabaseSessionErrors.From);
}
