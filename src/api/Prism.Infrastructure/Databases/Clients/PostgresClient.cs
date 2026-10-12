using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Databases.Clients;

internal sealed class PostgresClient(ILogger logger) : IDatabaseClient
{
    public EDatabaseEngine Engine => EDatabaseEngine.PostgreSql;

    public Task<Result<IDatabaseConnection, DatabaseFailure>> OpenAsync(ConnectionSettings settings, CancellationToken cancellationToken)
        => new PostgresConnection(settings, logger).OpenAsync(cancellationToken);
}
