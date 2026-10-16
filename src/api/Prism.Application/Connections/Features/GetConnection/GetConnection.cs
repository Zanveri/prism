using CSharpFunctionalExtensions;
using Prism.Application.Common.Protections;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Connections.Features.GetConnection;

public sealed record GetConnectionCommand(Guid ID) : IRequest<Result<ConnectionDto, ApiErrorDto>>;

internal sealed class GetConnectionHandler(IVaultService vaultService) : IRequestHandler<GetConnectionCommand, Result<ConnectionDto, ApiErrorDto>>
{
    public Task<Result<ConnectionDto, ApiErrorDto>> Handle(GetConnectionCommand request, CancellationToken cancellationToken)
    {
        // RN-CONN-001: o registro tem a senha, e o DTO não. Cofre fechado é 401; só a leitura que achou o documento diz "não existe". O documento
        // inteiro, e não só o registro: as proteções que valem (RN-PROT-004) dependem das pastas acima, lidas da mesma leitura.
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<ConnectionDto, ApiErrorDto>(VaultErrors.From(read.Error)));

        if (read.Value.Connections.FirstOrDefault(connection => connection.ID == request.ID) is not { } record)
            return Task.FromResult(Result.Failure<ConnectionDto, ApiErrorDto>(ConnectionErrors.NotFound(request.ID)));

        return Task.FromResult(Result.Success<ConnectionDto, ApiErrorDto>(record.ToDto(ProtectionRules.Of(read.Value, record))));
    }
}
