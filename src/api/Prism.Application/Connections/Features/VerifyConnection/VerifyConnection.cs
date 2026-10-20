using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Models.Dtos;
using Prism.Application.Connections.Queries;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Connections.Features.VerifyConnection;

/// <summary>RN-VERIF-002: a verificação periódica de uma conexão conectada, que a tela pede a cada intervalo. Sem corpo: a consulta é a gravada.</summary>
public sealed record VerifyConnectionCommand(Guid ID) : IRequest<Result<ConnectionVerificationDto, ApiErrorDto>>;

internal sealed class VerifyConnectionHandler(IConnectionQueries connectionQueries, IDatabaseSessionService databaseSessionService, IVaultService vaultService, TimeProvider timeProvider) : IRequestHandler<VerifyConnectionCommand, Result<ConnectionVerificationDto, ApiErrorDto>>
{
    /// <summary>
    /// A geração do cofre é lida ANTES da conexão: só a sessão aberta com as credenciais deste cofre responde por ela (a de outro cofre já está sendo
    /// fechada, RN-COFRE-008). A consulta é a própria da conexão, gravada já validada (RN-VERIF-001), ou a do banco. A falha do banco é resposta 200,
    /// `failed`, e não erro: a tela a mostra no indicador. Esta rota não olha `verificationEnabled`: quem decide se pede é a tela.
    /// </summary>
    public async Task<Result<ConnectionVerificationDto, ApiErrorDto>> Handle(VerifyConnectionCommand request, CancellationToken cancellationToken)
    {
        var generation = vaultService.Generation;

        var read = await connectionQueries.GetRecordByID(request.ID, cancellationToken);
        if (read.IsFailure)
            return Result.Failure<ConnectionVerificationDto, ApiErrorDto>(VaultErrors.From(read.Error));

        if (read.Value is not { } record)
            return Result.Failure<ConnectionVerificationDto, ApiErrorDto>(ConnectionErrors.NotFound(request.ID));

        var verified = await databaseSessionService.VerifyAsync(record.ID, record.VerificationQuery, generation, cancellationToken);

        return Result.Success<ConnectionVerificationDto, ApiErrorDto>(verified.ToDto(timeProvider.GetUtcNow().UtcDateTime));
    }
}
