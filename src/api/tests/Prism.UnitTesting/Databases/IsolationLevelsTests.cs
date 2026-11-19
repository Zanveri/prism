using FluentValidation.TestHelper;
using Moq;
using Moq.Protected;
using Prism.Application.DatabaseSessions.Features.ChangeTransactionMode;
using Prism.Application.DatabaseSessions.Features.OpenDatabaseSession;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Serilog;
using Serilog.Core;
using System.Data;
using System.Data.Common;

namespace Prism.UnitTesting.Databases;

public sealed class IsolationLevelsTests
{
    private static readonly ChangeTransactionModeValidator ChangeValidator = new();
    private static readonly OpenDatabaseSessionValidator OpenValidator = new();

    [Trait("IsolationLevels", "WireContract")]
    [Theory(DisplayName = "Aceita todos os níveis de isolamento enviados pela interface nos validadores")]
    [InlineData("default")]
    [InlineData("readUncommitted")]
    [InlineData("readCommitted")]
    [InlineData("committedReadLastCommitted")]
    [InlineData("cursorStability")]
    [InlineData("repeatableRead")]
    [InlineData("readStability")]
    [InlineData("serializable")]
    public void Validators_ShouldAcceptAllFrontendIsolationLevels(string level)
    {
        Assert.True(IsolationLevels.IsKnown(level));

        var changeResult = ChangeValidator.TestValidate(new ChangeTransactionModeCommand { ID = Guid.CreateVersion7(), IsolationLevel = level });
        changeResult.ShouldNotHaveValidationErrorFor(command => command.IsolationLevel);

        var openResult = OpenValidator.TestValidate(new OpenDatabaseSessionCommand { ConnectionID = Guid.CreateVersion7(), IsolationLevel = level });
        openResult.ShouldNotHaveValidationErrorFor(command => command.IsolationLevel);
    }

    [Trait("IsolationLevels", "Informix")]
    [Fact(DisplayName = "Suporta todos os níveis do Informix da interface e mapeia para opções DRDA e ADO.NET")]
    public void Informix_ShouldSupportAllFrontendLevelsAndMapDrdaOptions()
    {
        string[] informixLevels =
        [
            IsolationLevels.Default,
            IsolationLevels.ReadUncommitted,
            IsolationLevels.ReadCommitted,
            IsolationLevels.CommittedReadLastCommitted,
            IsolationLevels.CursorStability,
            IsolationLevels.RepeatableRead,
        ];

        foreach (var level in informixLevels)
            Assert.True(IsolationLevels.IsSupportedBy(EDatabaseEngine.Informix, level), level);

        Assert.False(IsolationLevels.IsSupportedBy(EDatabaseEngine.Informix, IsolationLevels.Serializable));
        Assert.False(IsolationLevels.IsSupportedBy(EDatabaseEngine.Informix, IsolationLevels.ReadStability));

        Assert.Equal((null, null), IsolationLevels.InformixConnectionOptions(IsolationLevels.Default));
        Assert.Equal(("ReadUncommitted", null), IsolationLevels.InformixConnectionOptions(IsolationLevels.ReadUncommitted));
        Assert.Equal(("ReadCommitted", null), IsolationLevels.InformixConnectionOptions(IsolationLevels.ReadCommitted));
        Assert.Equal(("ReadCommitted", "CurrentlyCommitted"), IsolationLevels.InformixConnectionOptions(IsolationLevels.CommittedReadLastCommitted));
        Assert.Equal(("RepeatableRead", null), IsolationLevels.InformixConnectionOptions(IsolationLevels.CursorStability));
        Assert.Equal(("Serializable", null), IsolationLevels.InformixConnectionOptions(IsolationLevels.RepeatableRead));

        Assert.Equal(IsolationLevel.RepeatableRead, IsolationLevels.ToAdoIsolationLevel(EDatabaseEngine.Informix, IsolationLevels.CursorStability));
        Assert.Equal(IsolationLevel.ReadCommitted, IsolationLevels.ToAdoIsolationLevel(EDatabaseEngine.Informix, IsolationLevels.CommittedReadLastCommitted));
        Assert.Equal(IsolationLevel.Serializable, IsolationLevels.ToAdoIsolationLevel(EDatabaseEngine.Informix, IsolationLevels.RepeatableRead));

        Assert.True(IsolationLevels.IsSupportedByInformixLogging("noLogging", IsolationLevels.Default));
        Assert.True(IsolationLevels.IsSupportedByInformixLogging("noLogging", IsolationLevels.ReadUncommitted));
        Assert.False(IsolationLevels.IsSupportedByInformixLogging("noLogging", IsolationLevels.ReadCommitted));
        Assert.False(IsolationLevels.IsSupportedByInformixLogging("noLogging", IsolationLevels.CommittedReadLastCommitted));
        Assert.True(IsolationLevels.IsSupportedByInformixLogging("ansi", IsolationLevels.CommittedReadLastCommitted));
    }

    [Trait("IsolationLevels", "PostgreSqlAndDb2")]
    [Fact(DisplayName = "Suporta readUncommitted no PostgreSQL e no Db2 e restaura o padrão do PostgreSQL com RESET")]
    public void PostgresAndDb2_ShouldSupportReadUncommittedAndResetDefault()
    {
        Assert.True(IsolationLevels.IsSupportedBy(EDatabaseEngine.PostgreSql, IsolationLevels.ReadUncommitted));
        Assert.Equal("RESET default_transaction_isolation", IsolationLevels.PostgresSessionSql(IsolationLevels.Default));
        Assert.Equal("SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ UNCOMMITTED", IsolationLevels.PostgresSessionSql(IsolationLevels.ReadUncommitted));
        Assert.Equal("BEGIN TRANSACTION READ ONLY ISOLATION LEVEL READ UNCOMMITTED", IsolationLevels.PostgresBeginReadOnlySql(IsolationLevels.ReadUncommitted));

        Assert.True(IsolationLevels.IsSupportedBy(EDatabaseEngine.Db2, IsolationLevels.ReadUncommitted));
        Assert.Equal("SET CURRENT ISOLATION UR", IsolationLevels.Db2SessionSql(IsolationLevels.ReadUncommitted));
        Assert.Equal("SET CURRENT ISOLATION RESET", IsolationLevels.Db2SessionSql(IsolationLevels.Default));
    }
}

public sealed partial class AdoDatabaseConnectionTests
{
    [Trait("AdoDatabaseConnection", "SetIsolationLevelAsync")]
    [Fact(DisplayName = "No Informix, trocar o isolamento reabre a conexão do driver com o nível novo sem enviar SET ISOLATION")]
    public async Task SetIsolationLevel_OnInformix_ReopensDriverWithTargetIsolationAndDisposesPrevious()
    {
        const string loggingSql = "LOGGING MODE";
        _catalog[loggingSql] = [["ansi"]];

        var openedIsolations = new List<string>();
        var disposedDrivers = 0;

        DbConnection BuildDriver()
        {
            var state = ConnectionState.Closed;
            var driver = new Mock<DbConnection>();
            driver.SetupGet(d => d.State).Returns(() => state);
            driver.SetupGet(d => d.ServerVersion).Returns("14.10");
            driver.Setup(d => d.OpenAsync(It.IsAny<CancellationToken>())).Returns(() =>
            {
                state = ConnectionState.Open;
                return Task.CompletedTask;
            });
            driver.Setup(d => d.DisposeAsync()).Returns(() =>
            {
                if (state == ConnectionState.Open)
                    disposedDrivers++;
                state = ConnectionState.Closed;
                return ValueTask.CompletedTask;
            });
            driver.Protected().Setup<DbCommand>("CreateDbCommand").Returns(CreateCommand);
            return driver.Object;
        }

        var connection = new ReopeningInformixFakeConnection(
            level =>
            {
                openedIsolations.Add(level);
                return BuildDriver();
            },
            loggingSql,
            Logger.None);

        var opened = await connection.OpenAsync(CancellationToken.None);
        Assert.True(opened.IsSuccess);
        Assert.Equal([IsolationLevels.Default], openedIsolations);

        var setLastCommitted = await connection.SetIsolationLevelAsync(IsolationLevels.CommittedReadLastCommitted, CancellationToken.None);
        Assert.True(setLastCommitted.IsSuccess);
        Assert.Equal(IsolationLevels.CommittedReadLastCommitted, connection.IsolationLevel);
        Assert.Equal([IsolationLevels.Default, IsolationLevels.CommittedReadLastCommitted], openedIsolations);
        Assert.Equal(1, disposedDrivers);
        Assert.DoesNotContain(_sent, sql => sql.StartsWith("SET ISOLATION", StringComparison.Ordinal));

        var resetDefault = await connection.SetIsolationLevelAsync(IsolationLevels.Default, CancellationToken.None);
        Assert.True(resetDefault.IsSuccess);
        Assert.Equal(IsolationLevels.Default, connection.IsolationLevel);
        Assert.Equal([IsolationLevels.Default, IsolationLevels.CommittedReadLastCommitted, IsolationLevels.Default], openedIsolations);
        Assert.Equal(2, disposedDrivers);

        // Em banco sem log, readCommitted é recusado com TransactionsNotAvailable sem reabrir a conexão
        _catalog[loggingSql] = [["noLogging"]];
        var refused = await connection.SetIsolationLevelAsync(IsolationLevels.ReadCommitted, CancellationToken.None);
        Assert.True(refused.IsFailure);
        Assert.Equal(EDatabaseFailure.TransactionsNotAvailable, refused.Error.Kind);
        Assert.Equal(IsolationLevels.Default, connection.IsolationLevel);
        Assert.Equal(3, openedIsolations.Count);
    }

    private sealed class ReopeningInformixFakeConnection(Func<string, DbConnection> factory, string loggingSql, ILogger logger)
        : FakeEngineConnection(new Mock<DbConnection>().Object, () => null, () => null, logger)
    {
        protected override ESqlDialect QueryDialect => ESqlDialect.Informix;

        protected override bool ReopensDriverForIsolation => true;

        protected override string? LoggingModeSql => loggingSql;

        protected override string? BeginReadOnlySql => null;

        protected override DbConnection CreateConnection()
            => factory(EffectiveIsolationLevel);
    }
}
