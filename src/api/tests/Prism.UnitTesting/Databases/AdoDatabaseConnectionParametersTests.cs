using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Serilog;
using Serilog.Core;
using System.Data;
using System.Data.Common;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-VAR-032 e 033: os parâmetros do comando do usuário na base, sobre o driver de mentira, que confere os parâmetros ligados: a ordem, o valor e o `DbType` de cada
/// um, no comando, na contagem, na leitura e na contagem da exportação. É a mesma classe do `AdoDatabaseConnectionTests`, em outro arquivo.
/// </summary>
public sealed partial class AdoDatabaseConnectionTests
{
    private static readonly QueryParameter[] TextAndNumber = [new(EQueryParameterType.Text, "'; DROP TABLE pedido; --"), new(EQueryParameterType.Number, "42")];

    private async Task<IDatabaseConnection> OpenAsDb2Async()
        => (await new DialectEngineConnection(ESqlDialect.Db2, _driver.Object, BeginProbe, () => _probeRoundTrip(), Logger.None).OpenAsync(CancellationToken.None)).Value;

    private (string Sql, DbParameter[] Parameters) UserCommand(string sql)
        => _readerCommands.Single(command => command.Sql == sql);

    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK os parâmetros do comando vão ligados na ordem do texto, e o valor de injeção é só um valor")]
    public async Task Execute_WithParameters_ShouldBindThemInOrder()
    {
        //Arrange
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(ReadQuery, 50, CancellationToken.None, TextAndNumber);

        //Assert
        Assert.True(outcome.IsSuccess);
        var sent = UserCommand(ReadQuery);
        Assert.Equal(ReadQuery, sent.Sql);
        Assert.Equal(["'; DROP TABLE pedido; --", "42"], sent.Parameters.Select(parameter => parameter.Value));
    }

    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK sem parâmetros, ou com a lista vazia, o comando vai sem nenhum")]
    public async Task Execute_WithoutParameters_ShouldBindNone()
    {
        //Arrange
        var connection = await OpenAsync();

        //Act
        await connection.ExecuteAsync(ReadQuery, 50, CancellationToken.None);
        await connection.ExecuteAsync(ReadQuery, 50, CancellationToken.None, []);

        //Assert
        Assert.All(_readerCommands.Where(command => command.Sql == ReadQuery), command => Assert.Empty(command.Parameters));
    }

    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK no Db2 e no Informix cada valor vai convertido para o tipo do .NET, com o DbType quando há, e o nulo como DBNull")]
    public async Task Execute_WithParameters_ShouldConvertEachValueForTheIbmEngines()
    {
        //Arrange
        var connection = await OpenAsDb2Async();
        QueryParameter[] values =
        [
            new(EQueryParameterType.Number, "9007199254740993"),
            new(EQueryParameterType.Number, "12.5000"),
            new(EQueryParameterType.Boolean, "true"),
            new(EQueryParameterType.Date, "2026-10-20"),
            new(EQueryParameterType.Timestamp, "2026-10-20 10:30:05.5"),
            new(EQueryParameterType.Text, null),
            new(EQueryParameterType.Number, "1.5e300")
        ];

        //Act
        var outcome = await connection.ExecuteAsync(ReadQuery, 50, CancellationToken.None, values);

        //Assert
        Assert.True(outcome.IsSuccess);
        var bound = UserCommand(ReadQuery).Parameters;
        Assert.Equal([9007199254740993L, "12.5000", true, new DateTime(2026, 10, 20), new DateTime(2026, 10, 20, 10, 30, 5, 500), DBNull.Value, 1.5e300], bound.Select(parameter => parameter.Value));
        Assert.Equal(DbType.Boolean, bound[2].DbType);
    }

    [Trait("AdoDatabaseConnection", "ExecuteReadOnlyAsync")]
    [Fact(DisplayName = "OK na conexão somente leitura os parâmetros também vão ligados")]
    public async Task ExecuteReadOnly_WithParameters_ShouldBindThem()
    {
        //Arrange
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteReadOnlyAsync(ReadQuery, 50, CancellationToken.None, TextAndNumber);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(["'; DROP TABLE pedido; --", "42"], UserCommand(ReadQuery).Parameters.Select(parameter => parameter.Value));
    }

    [Trait("AdoDatabaseConnection", "CountAsync")]
    [Fact(DisplayName = "OK a contagem leva os parâmetros do comando, e o embrulho não os muda")]
    public async Task Count_WithParameters_ShouldCarryTheParametersOfTheCommand()
    {
        //Arrange
        _catalog[ReadQuery] = [[7L]];
        var connection = await OpenAsync();

        //Act
        var total = await connection.CountAsync(ReadQuery, CancellationToken.None, TextAndNumber);

        //Assert
        Assert.Equal(7L, total.Value);
        Assert.Equal(["'; DROP TABLE pedido; --", "42"], UserCommand(ReadQuery).Parameters.Select(parameter => parameter.Value));
    }

    [Trait("AdoDatabaseConnection", "CountExportAsync")]
    [Fact(DisplayName = "OK a contagem e a leitura da exportação levam os parâmetros do comando")]
    public async Task Export_WithParameters_ShouldCarryThemInTheCountAndInTheRead()
    {
        //Arrange
        _catalog[CountQuery] = [[42L]];
        var connection = await OpenForExportAsync();
        await connection.BeginExportAsync(CancellationToken.None);

        //Act
        var total = await connection.CountExportAsync(CountQuery, required: false, CancellationToken.None, TextAndNumber);
        var started = await connection.StartExportReadAsync(ReadQuery, CancellationToken.None, TextAndNumber);

        //Assert
        Assert.Equal(42L, total.Value);
        Assert.True(started.IsSuccess);
        Assert.Equal(["'; DROP TABLE pedido; --", "42"], UserCommand(CountQuery).Parameters.Select(parameter => parameter.Value));
        Assert.Equal(["'; DROP TABLE pedido; --", "42"], UserCommand(ReadQuery).Parameters.Select(parameter => parameter.Value));
    }

    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK o comando que o banco recusa por causa do parâmetro é SQL_EXECUTION_FAILED com a mensagem como veio")]
    public async Task Execute_WhenTheDatabaseRefusesTheParameter_ShouldReturnItsMessage()
    {
        //Arrange
        _commandFailure = sql => sql == ReadQuery ? new InvalidOperationException("could not determine data type of parameter $1") : null;
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(ReadQuery, 50, CancellationToken.None, [new QueryParameter(EQueryParameterType.Number, "1")]);

        //Assert
        Assert.Equal((EDatabaseFailure.ExecutionFailed, "could not determine data type of parameter $1"), (outcome.Error.Kind, outcome.Error.Message));
    }

    /// <summary>Um banco que converte os parâmetros como o de um dialeto dado (o Db2, no caso), sobre o driver de mentira.</summary>
    private sealed class DialectEngineConnection(ESqlDialect dialect, DbConnection driver, Func<Exception?> beginProbe, Func<Exception?> probeRoundTrip, ILogger logger) : FakeEngineConnection(driver, beginProbe, probeRoundTrip, logger)
    {
        protected override ESqlDialect QueryDialect => dialect;
    }
}
