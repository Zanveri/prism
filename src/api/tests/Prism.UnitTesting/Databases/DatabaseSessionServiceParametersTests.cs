using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-VAR-032 e 033: os `params` no registro de sessões, com a conexão de mentira: a conferência dos marcadores e dos valores antes de ir ao banco (que deixa o resultado
/// anterior como estava), os parâmetros que chegam à conexão, ficam com o resultado e vão de novo na contagem e na coluna inteira, e o filtro. É a mesma classe do
/// `DatabaseSessionServiceTests`, em outro arquivo.
/// </summary>
public sealed partial class DatabaseSessionServiceTests
{
    private static readonly QueryParameter Aberta = new(EQueryParameterType.Text, "aberta");

    private static readonly QueryParameter Dez = new(EQueryParameterType.Number, "10");

    private async Task<Guid?> ExecuteWithAsync(DatabaseSessionService service, Guid session, string sql, string? filter = null, bool readOnly = false, params QueryParameter[] parameters)
    {
        _connection.Outcomes.Enqueue(new QueryOutcome(new QueryPage(PedidoColumns, [["1", "aberta"]], false, 1, []), null, 1));
        var outcome = await service.ExecuteAsync(session, sql, filter, QueryPaging.DefaultPageSize, readOnly, [], parameters, CancellationToken.None);

        return outcome.IsSuccess ? outcome.Value.Page!.ResultID : null;
    }

    [Trait("DatabaseSessionService", "Parameters")]
    [Fact(DisplayName = "OK os parâmetros chegam à conexão na ordem, e a contagem do último comando que devolveu linhas os leva de novo")]
    public async Task Execute_WithParameters_ShouldReachTheConnectionAndTheCount()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);

        //Act
        await ExecuteWithAsync(service, session, "SELECT * FROM loja.pedido WHERE status = $1 LIMIT $2", null, false, Aberta, Dez);
        var counted = await service.CountAsync(session, CancellationToken.None);

        //Assert
        Assert.Equal([Aberta, Dez], _connection.ExecutedParameters.Single());
        Assert.Equal(99, counted.Value);
        var count = Assert.Single(_connection.Counts);
        Assert.Equal("SELECT * FROM loja.pedido WHERE status = $1 LIMIT $2", count.Sql);
        Assert.Equal([Aberta, Dez], count.Parameters);
    }

    [Trait("DatabaseSessionService", "Parameters")]
    [Fact(DisplayName = "OK na conexão somente leitura os parâmetros também chegam, pelo caminho da leitura")]
    public async Task Execute_ReadOnly_WithParameters_ShouldReachTheConnection()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);

        //Act
        await ExecuteWithAsync(service, session, "SELECT * FROM loja.pedido WHERE status = $1", null, true, Aberta);

        //Assert
        Assert.Equal(["SELECT * FROM loja.pedido WHERE status = $1"], _connection.ExecutedReadOnly);
        Assert.Equal([Aberta], _connection.ExecutedParameters.Single());
    }

    [Trait("DatabaseSessionService", "Parameters")]
    [Theory(DisplayName = "Erro os marcadores que não batem com os valores são QUERY_PARAMETERS_MISMATCH, sem ir ao banco")]
    [InlineData("PostgreSql", "SELECT $1, $2", 1, 2, 1)]
    [InlineData("PostgreSql", "SELECT $1", 2, 1, 2)]
    [InlineData("PostgreSql", "SELECT 1", 1, 0, 1)]
    [InlineData("PostgreSql", "SELECT $1, $3", 2, 2, 2)]
    [InlineData("Db2", "SELECT ? FROM sysibm.sysdummy1", 2, 1, 2)]
    [InlineData("Informix", "SELECT ?, ? FROM systables", 1, 2, 1)]
    public async Task Execute_WithMarkersThatDoNotMatch_ShouldRefuseBeforeTheDatabase(string engine, string sql, int values, int markers, int expectedValues)
    {
        //Arrange
        var (service, session) = await OpenAsync(Enum.Parse<EDatabaseEngine>(engine));

        //Act
        var outcome = await service.ExecuteAsync(session, sql, null, QueryPaging.DefaultPageSize, false, [], [.. Enumerable.Repeat(Dez, values)], CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.ParametersMismatch, markers, expectedValues), (outcome.Error.Kind, outcome.Error.Markers, outcome.Error.Values));
        Assert.Empty(_connection.Executed);
    }

    [Trait("DatabaseSessionService", "Parameters")]
    [Fact(DisplayName = "OK a recusa dos parâmetros deixa o resultado atual e o comando da contagem como estavam")]
    public async Task Execute_RefusedParameters_ShouldKeepThePreviousResult()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);
        var first = await ExecuteWithAsync(service, session, "SELECT * FROM loja.pedido WHERE status = $1", null, false, Aberta);

        //Act
        var refused = await service.ExecuteAsync(session, "SELECT * FROM loja.pedido WHERE status = $1 AND id = $2", null, QueryPaging.DefaultPageSize, false, [], [Aberta], CancellationToken.None);
        var counted = await service.CountAsync(session, CancellationToken.None);
        var cells = service.GetCells(session, first!.Value, []);

        //Assert
        Assert.Equal(EDatabaseFailure.ParametersMismatch, refused.Error.Kind);
        Assert.Equal(99, counted.Value);
        Assert.Equal("SELECT * FROM loja.pedido WHERE status = $1", _connection.Counts.Single().Sql);
        Assert.Equal([Aberta], _connection.Counts.Single().Parameters);
        Assert.True(cells.IsSuccess);
    }

    [Trait("DatabaseSessionService", "Parameters")]
    [Theory(DisplayName = "Erro o valor que o banco não guarda é QUERY_INVALID no campo params[i].value, sem ir ao banco")]
    [InlineData("Db2", "number", "12345678901234567890123456789012", "params[1].value")]
    [InlineData("Informix", "number", "1e999", "params[1].value")]
    [InlineData("Db2", "timestamp", "2026-10-20 10:30:00-03", "params[1].value")]
    public async Task Execute_WithAValueTheDatabaseDoesNotHold_ShouldRefuseInTheField(string engine, string type, string value, string field)
    {
        //Arrange
        var (service, session) = await OpenAsync(Enum.Parse<EDatabaseEngine>(engine));
        QueryParameter[] parameters = [Dez, new(Enum.Parse<EQueryParameterType>(type, ignoreCase: true), value)];

        //Act
        var outcome = await service.ExecuteAsync(session, "SELECT ?, ? FROM sysibm.sysdummy1", null, QueryPaging.DefaultPageSize, false, [], parameters, CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.QueryInvalid, field), (outcome.Error.Kind, outcome.Error.Field));
        Assert.Empty(_connection.Executed);
    }

    [Trait("DatabaseSessionService", "Parameters")]
    [Fact(DisplayName = "OK o PostgreSQL deixa o número com expoente para o servidor, e a lista vazia vai como antes, com o $1 do texto")]
    public async Task Execute_PostgreSql_ShouldLeaveTheNumberToTheServerAndAnEmptyListAsBefore()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);

        //Act
        var huge = await ExecuteWithAsync(service, session, "SELECT $1", null, false, new QueryParameter(EQueryParameterType.Number, "1e999"));
        var without = await ExecuteWithAsync(service, session, "SELECT $1");

        //Assert
        Assert.NotNull(huge);
        Assert.NotNull(without);
        Assert.Equal(["SELECT $1", "SELECT $1"], _connection.Executed);
        Assert.Empty(_connection.ExecutedParameters[1]!);
    }

    [Trait("DatabaseSessionService", "Parameters")]
    [Fact(DisplayName = "Erro com parâmetros o filtro não pode ter marcador; sem eles o filtro com $1 vai ao banco, que responde")]
    public async Task Execute_FilterWithAMarker_ShouldBeRefusedOnlyWithParameters()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);

        //Act
        var refused = await service.ExecuteAsync(session, "SELECT * FROM loja.pedido WHERE a = $1", "b = $2", QueryPaging.DefaultPageSize, false, [], [Aberta], CancellationToken.None);
        var validatorSide = service.FilterRefusal(session, "b = $2", withParameters: true);
        var withoutParameters = service.FilterRefusal(session, "b = $2", withParameters: false);
        await ExecuteWithAsync(service, session, "SELECT * FROM loja.pedido", "b = $2");

        //Assert
        Assert.Equal((EDatabaseFailure.FilterInvalid, "O filtro não pode ter marcador de parâmetro ($1 ou ?)."), (refused.Error.Kind, refused.Error.Message));
        Assert.Equal("O filtro não pode ter marcador de parâmetro ($1 ou ?).", validatorSide);
        Assert.Null(withoutParameters);
        Assert.Equal(["SELECT * FROM loja.pedido WHERE (b = $2)"], _connection.Executed);
    }

    [Trait("DatabaseSessionService", "Parameters")]
    [Fact(DisplayName = "OK o filtro com ORDER BY que tem marcador embrulha o comando, e os parâmetros seguem os mesmos")]
    public async Task Execute_FilterOverAnOrderByWithAMarker_ShouldWrapAndKeepTheParameters()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);
        _connection.Outcomes.Enqueue(new QueryOutcome(new QueryPage(PedidoColumns, [["1", "aberta"]], false, 1, []), null, 1));

        //Act
        var outcome = await service.ExecuteAsync(session, "SELECT * FROM loja.pedido WHERE status = $1 ORDER BY status = $2", "ORDER BY id", QueryPaging.DefaultPageSize, false, [], [Aberta, Dez], CancellationToken.None);

        //Assert
        Assert.Equal(EFilterApplied.Wrapped, outcome.Value.Page!.FilterApplied);
        Assert.Equal(["SELECT * FROM (\nSELECT * FROM loja.pedido WHERE status = $1 ORDER BY status = $2\n) prism_filtro\nORDER BY id"], _connection.Executed);
        Assert.Equal([Aberta, Dez], _connection.ExecutedParameters.Single());
    }

    [Trait("DatabaseSessionService", "Parameters")]
    [Fact(DisplayName = "OK a coluna inteira de um resultado com parâmetros leva os valores do Q na contagem e no UPDATE, e o Ver SQL escreve os literais")]
    public async Task WholeColumn_OfAResultWithParameters_ShouldCarryTheValuesOfTheQ()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        var result = await ExecuteWithAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO WHERE ID > ? AND STATUS = ?", null, false, Dez, Aberta);

        //Act
        var counted = await service.CountWholeColumnAsync(session, result!.Value, [PaidEverywhere with { Rows = null }], CancellationToken.None);
        var saved = await service.ApplyEditsAsync(session, result.Value, [PaidEverywhere], CancellationToken.None);
        var preview = await service.PreviewEditsAsync(session, result.Value, [PaidEverywhere], CancellationToken.None);

        //Assert
        Assert.True(counted.IsSuccess, counted.IsFailure ? counted.Error.Message : null);
        Assert.True(saved.IsSuccess, saved.IsFailure ? saved.Error.Message : null);
        var plan = Assert.Single(_connection.Counted);
        Assert.Equal("SELECT COUNT(*) FROM \"LOJA\".\"PEDIDO\" WHERE ID > ? AND STATUS = ?\n", plan.CountSql);
        Assert.Equal([Dez, Aberta], plan.CountParameters);
        var (whole, _) = Assert.Single(_connection.SavedWholeColumns);
        Assert.Equal("UPDATE \"LOJA\".\"PEDIDO\" SET \"STATUS\" = ? WHERE ID > ? AND STATUS = ?\n", whole.Update!.Sql);
        Assert.Equal(["paga", Dez, Aberta], whole.Update.Parameters.Select(parameter => parameter.Query is { } query ? (object)query : parameter.Value));
        Assert.Equal("SELECT COUNT(*) FROM \"LOJA\".\"PEDIDO\" WHERE ID > 10 AND STATUS = 'aberta'\n", preview.Value.Statements[0].Sql);
        Assert.Equal("UPDATE \"LOJA\".\"PEDIDO\" SET \"STATUS\" = 'paga' WHERE ID > 10 AND STATUS = 'aberta'\n", preview.Value.Statements[1].Sql);
    }
}
