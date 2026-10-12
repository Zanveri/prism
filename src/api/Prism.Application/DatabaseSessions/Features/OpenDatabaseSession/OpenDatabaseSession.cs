using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.DatabaseSessions.Features.OpenDatabaseSession;

public sealed record OpenDatabaseSessionCommand : IRequest<Result<DatabaseSessionDto, ApiErrorDto>>
{
    public Guid ConnectionID { get; init; }
}

internal sealed class OpenDatabaseSessionHandler(IConnectionQueries connectionQueries, IDatabaseSessionService databaseSessionService, IVaultService vaultService) : IRequestHandler<OpenDatabaseSessionCommand, Result<DatabaseSessionDto, ApiErrorDto>>
{
    public async Task<Result<DatabaseSessionDto, ApiErrorDto>> Handle(OpenDatabaseSessionCommand request, CancellationToken cancellationToken)
    {
        // A geração do cofre é lida ANTES das credenciais: a sessão abre fora do semáforo do cofre, e o cofre aberto pode ser trocado ou
        // fechado até a conexão ficar pronta. O registro de sessões confere a geração ao registrar e, se ela mudou, descarta a conexão
        // (`VaultChanged`, que vira 401 `VAULT_LOCKED`): uma senha lida de um cofre não abre sessão no outro.
        var generation = vaultService.Generation;

        // Cofre fechado é 401; só um sucesso com `null` é "não existe" (404).
        var read = await connectionQueries.GetRecordByID(request.ConnectionID, cancellationToken);
        if (read.IsFailure)
            return Result.Failure<DatabaseSessionDto, ApiErrorDto>(VaultErrors.From(read.Error));

        if (read.Value is not { } record)
            return Result.Failure<DatabaseSessionDto, ApiErrorDto>(ConnectionErrors.NotFound(request.ConnectionID));

        var settings = new ConnectionSettings(record.Engine, record.Host, record.Port, record.Database, record.UserName, record.Password);

        var opened = await databaseSessionService.OpenAsync(record.ID, settings, generation, cancellationToken);
        if (opened.IsFailure)
            return Result.Failure<DatabaseSessionDto, ApiErrorDto>(DatabaseSessionErrors.From(opened.Error));

        // RN-CONN-014: a exclusão da conexão pode terminar enquanto esta abre. O `CloseByConnectionAsync` dela não acha uma sessão que ainda não
        // está no registro, e a sessão ficaria aberta para uma conexão que não existe mais. A exclusão grava antes de fechar as sessões, então
        // uma leitura feita depois do registro da sessão já a enxerga: sem a conexão (ou com o cofre fechado), a sessão não fica.
        var confirmed = await connectionQueries.GetRecordByID(request.ConnectionID, cancellationToken);
        if (confirmed is { IsSuccess: true, Value: not null })
            return Result.Success<DatabaseSessionDto, ApiErrorDto>(opened.Value.ToDto());

        await databaseSessionService.CloseAsync(opened.Value.ID);

        return Result.Failure<DatabaseSessionDto, ApiErrorDto>(confirmed.IsFailure ? VaultErrors.From(confirmed.Error) : ConnectionErrors.NotFound(request.ConnectionID));
    }
}
