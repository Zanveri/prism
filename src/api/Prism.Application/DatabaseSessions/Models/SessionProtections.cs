using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Queries;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Models;

/// <summary>
/// RN-PROT-002 e 006: as rotas que executam um comando na conexão (`queries` e as da edição) perguntam ao cofre, a cada pedido, se a conexão da
/// sessão é somente leitura agora, pela opção dela ou de uma pasta acima. Mudar a proteção não fecha sessão nenhuma: o comando seguinte já segue a
/// regra nova.
/// </summary>
internal static class SessionProtections
{
    /// <summary>
    /// A sessão que não existe não é somente leitura aqui: a operação pedida responde `DATABASE_SESSION_NOT_FOUND` por conta própria. A conexão
    /// excluída (as sessões dela estão sendo fechadas, RN-CONN-014) responde como a sessão que não existe, e o cofre fechado é o 401 de sempre.
    /// </summary>
    public static async Task<Result<bool, ApiErrorDto>> IsReadOnly(this IConnectionQueries connectionQueries, IDatabaseSessionService databaseSessionService, Guid sessionID, CancellationToken cancellationToken)
    {
        if (databaseSessionService.ConnectionOf(sessionID) is not { } connectionID)
            return false;

        var read = await connectionQueries.IsReadOnly(connectionID, cancellationToken);
        if (read.IsFailure)
            return VaultErrors.From(read.Error);

        if (read.Value is not { } readOnly)
            return DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A conexão desta sessão foi excluída, e a sessão está sendo fechada."));

        return readOnly;
    }

    /// <summary>RN-PROT-002 e RN-EDIT-002: a edição de registros não existe numa conexão somente leitura, e a recusa vem antes de qualquer coisa ir ao banco.</summary>
    public static ApiErrorDto EditsRefusal()
        => DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ConnectionReadOnly, ReadOnlySql.EditsRefusal));
}
