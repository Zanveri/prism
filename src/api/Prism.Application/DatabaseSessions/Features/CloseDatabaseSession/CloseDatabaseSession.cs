using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.DatabaseSessions.Features.CloseDatabaseSession;

/// <summary>
/// RN-SESSAO-004: a tela fecha a sessão ao fechar a aba e ao desconectar a conexão. RN-REDE-002: fechada a última sessão da conexão, o segredo que ela não grava
/// sai da memória, e o próximo acesso o pede de novo (RN-REDE-006). A sessão que caiu sozinha não passa por aqui: a tela a reabre sem pedir nada.
/// </summary>
public sealed record CloseDatabaseSessionCommand(Guid SessionID) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class CloseDatabaseSessionHandler(IDatabaseSessionService databaseSessionService, IVaultService? vaultService = null, IUnsavedSecretsService? unsavedSecrets = null) : IRequestHandler<CloseDatabaseSessionCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(CloseDatabaseSessionCommand request, CancellationToken cancellationToken)
    {
        var connectionID = databaseSessionService.ConnectionOf(request.SessionID);
        var closed = await databaseSessionService.CloseAsync(request.SessionID);

        if (closed.IsSuccess && connectionID is { } id && vaultService is not null && !databaseSessionService.HasSession(id, vaultService.Generation))
            unsavedSecrets?.Forget(id);

        return closed.MapError(DatabaseSessionErrors.From);
    }
}
