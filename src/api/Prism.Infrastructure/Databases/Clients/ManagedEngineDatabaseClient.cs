using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Databases.Clients;

internal sealed class ManagedEngineDatabaseClient(EDatabaseEngine engine, ILogger logger) : IDatabaseClient
{
    public EDatabaseEngine Engine => engine;

    public Task<Result<IDatabaseConnection, DatabaseFailure>> OpenAsync(ConnectionSettings settings, CancellationToken cancellationToken)
        => new ManagedEngineDatabaseConnection(engine, settings, logger).OpenAsync(cancellationToken);
}
