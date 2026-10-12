#if PRISM_IBM_DRIVER
using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Databases.Clients;

internal sealed class InformixClient(ILogger logger) : IDatabaseClient
{
    public EDatabaseEngine Engine => EDatabaseEngine.Informix;

    public Task<Result<IDatabaseConnection, DatabaseFailure>> OpenAsync(ConnectionSettings settings, CancellationToken cancellationToken)
        => new InformixConnection(settings, logger).OpenAsync(cancellationToken);
}
#endif
