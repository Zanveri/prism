using CSharpFunctionalExtensions;
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
}
