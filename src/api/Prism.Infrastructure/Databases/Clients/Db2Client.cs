#if PRISM_IBM_DRIVER
using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Databases.Clients;

internal sealed class Db2Client(ILogger logger) : IDatabaseClient
{
    public EDatabaseEngine Engine => EDatabaseEngine.Db2;

    public Task<Result<IDatabaseConnection, DatabaseFailure>> OpenAsync(ConnectionSettings settings, CancellationToken cancellationToken)
        => new Db2Connection(settings, logger).OpenAsync(cancellationToken);
}
#endif
