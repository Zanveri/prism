using CSharpFunctionalExtensions;
using Prism.Application.Common.Protections;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Connections.Queries;

internal sealed class ConnectionQueries(IVaultService vaultService) : IConnectionQueries
{
    public Task<Result<VaultConnectionRecord?, EVaultError>> GetRecordByID(Guid id, CancellationToken cancellationToken)
    {
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<VaultConnectionRecord?, EVaultError>(read.Error));

        return Task.FromResult(Result.Success<VaultConnectionRecord?, EVaultError>(read.Value.Connections.FirstOrDefault(connection => connection.ID == id)));
    }

    public Task<Result<bool?, EVaultError>> IsReadOnly(Guid id, CancellationToken cancellationToken)
    {
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<bool?, EVaultError>(read.Error));

        if (read.Value.Connections.FirstOrDefault(connection => connection.ID == id) is not { } record)
            return Task.FromResult(Result.Success<bool?, EVaultError>(null));

        return Task.FromResult(Result.Success<bool?, EVaultError>(ProtectionRules.Of(read.Value, record).ReadOnly));
    }
}
