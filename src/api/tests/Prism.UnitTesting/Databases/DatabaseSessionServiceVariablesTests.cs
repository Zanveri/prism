using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Serilog;
using Serilog.Core;
using Serilog.Events;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-VAR-034 e 035: a consulta de uma variável, os valores de uma coluna e a conferência deles no registro de sessões, com a conexão de mentira: as recusas antes
/// de ir ao banco, na ordem da regra; o resultado atual, os guardados e o comando da contagem que ficam como estavam; o texto e os parâmetros que chegam à conexão;
/// e o log só com contagens (RN-VAR-036). É a mesma classe do `DatabaseSessionServiceTests`, em outro arquivo.
/// </summary>
public sealed partial class DatabaseSessionServiceTests
{
    private const string Secret = "segredo-da-pessoa";

    private static readonly ColumnInfo[] PostgresPedido =
    [
        new("id", "integer", false, true, 1, null, null),
        new("status", "character varying(20)", true, false, 2, null, null),
        new("foto", "bytea", true, false, 3, null, null)
    ];

    private static readonly FullRows TwoIDs = new([new("ID", "INTEGER", "number")], [["1"], ["2"]], 3);

    [Trait("DatabaseSessionService", "ExecuteVariableAsync")]
    [Fact(DisplayName = "OK a consulta da variável devolve as linhas e deixa o resultado atual, o guardado e a contagem como estavam, com o cursor fechado")]
    public async Task ExecuteVariable_ShouldKeepTheCurrentTheKeptAndTheCount()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        var kept = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO");
        var current = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO WHERE ID > 0", true, kept);
        var cursorBefore = _connection.HasOpenCursor;
        _connection.RowsToRead.Enqueue(TwoIDs);

        //Act
        var rows = await service.ExecuteVariableAsync(session, "SELECT ID FROM LOJA.PEDIDO WHERE STATUS = ?", [Aberta], 500, CancellationToken.None);
        var counted = await service.CountAsync(session, CancellationToken.None);
        var keptTarget = await service.GetEditTargetAsync(session, kept, null, CancellationToken.None);
        var currentTarget = await service.GetEditTargetAsync(session, current, null, CancellationToken.None);

        //Assert
        Assert.True(rows.IsSuccess, rows.IsFailure ? rows.Error.Message : null);
        Assert.Equal([["1"], ["2"]], rows.Value.Rows);
        var variable = Assert.Single(_connection.Variables);
        Assert.Equal(("SELECT ID FROM LOJA.PEDIDO WHERE STATUS = ?", 500), (variable.Sql, variable.MaxRows));
        Assert.Equal([Aberta], variable.Parameters);
        Assert.True(cursorBefore);
        Assert.False(_connection.HasOpenCursor);
        Assert.Equal("SELECT ID, STATUS FROM LOJA.PEDIDO WHERE ID > 0", Assert.Single(_connection.Counts).Sql);
        Assert.Equal(99, counted.Value);
        Assert.True(keptTarget.IsSuccess);
        Assert.True(currentTarget.IsSuccess);
    }

    /// <summary>RN-VAR-034: um comando só, os marcadores e a leitura, nessa ordem, e nada vai à conexão.</summary>
    [Trait("DatabaseSessionService", "ExecuteVariableAsync")]
    [Theory(DisplayName = "Erro as recusas da consulta da variável vêm na ordem da regra, sem ir ao banco")]
    [InlineData("DELETE FROM a; DELETE FROM b", 0, EDatabaseFailure.MultipleStatementsNotSupported, "A consulta de uma variável é um comando só, e o texto tem mais de um; nada foi executado.", null)]
    [InlineData("DELETE FROM loja.pedido WHERE id = $1", 2, EDatabaseFailure.ParametersMismatch, null, null)]
    [InlineData("DELETE FROM loja.pedido", 0, EDatabaseFailure.VariableQueryNotRead, "A consulta de uma variável tem de ser uma leitura: um DELETE não é.", "um DELETE não é leitura")]
    [InlineData("SELECT * FROM loja.pedido WHERE id = $1 FOR UPDATE", 1, EDatabaseFailure.VariableQueryNotRead, "A consulta de uma variável tem de ser uma leitura: a trava de linha (FOR UPDATE, FOR SHARE) é para alterar as linhas.", "a trava de linha (FOR UPDATE, FOR SHARE) é para alterar as linhas")]
    public async Task ExecuteVariable_ShouldRefuseBeforeTheDatabase(string sql, int values, EDatabaseFailure kind, string? message, string? reason)
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);

        //Act
        var refused = await service.ExecuteVariableAsync(session, sql, [.. Enumerable.Repeat(Dez, values)], 10_000, CancellationToken.None);

        //Assert
        Assert.Equal(kind, refused.Error.Kind);
        if (message is not null)
            Assert.Equal(message, refused.Error.Message);

        Assert.Equal(reason, refused.Error.Reason);
        Assert.Empty(_connection.Variables);
    }

    [Trait("DatabaseSessionService", "ExecuteVariableAsync")]
    [Fact(DisplayName = "Erro com um comando rodando a consulta da variável é SESSION_BUSY, como um comando")]
    public async Task ExecuteVariable_WhileACommandRuns_ShouldBeSessionBusy()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);
        var running = service.ExecuteAsync(session, "SELECT pg_sleep(60)", QueryPaging.DefaultPageSize, CancellationToken.None);

        //Act
        var busy = await service.ExecuteVariableAsync(session, "SELECT 1", [], 10_000, CancellationToken.None);

        //Assert
        Assert.False(running.IsCompleted);
        Assert.Equal(EDatabaseFailure.SessionBusy, busy.Error.Kind);
        Assert.Empty(_connection.Variables);
    }

    [Trait("DatabaseSessionService", "ExecuteVariableAsync")]
    [Fact(DisplayName = "Erro na transação manual com erro a consulta da variável é TRANSACTION_FAILED, sem ir ao banco")]
    public async Task ExecuteVariable_InAFailedTransaction_ShouldBeTransactionFailed()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);
        _connection.Transaction = ETransactionState.Failed;

        //Act
        var refused = await service.ExecuteVariableAsync(session, "SELECT 1", [], 10_000, CancellationToken.None);

        //Assert
        Assert.Equal(EDatabaseFailure.TransactionFailed, refused.Error.Kind);
        Assert.Empty(_connection.Variables);
    }

    [Trait("DatabaseSessionService", "ExecuteVariableAsync")]
    [Fact(DisplayName = "Erro a recusa do banco é a resposta, e o resultado atual continua o atual")]
    public async Task ExecuteVariable_RefusedByTheDatabase_ShouldKeepTheCurrentResult()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);
        var current = await ReadAsync(service, session, "SELECT * FROM loja.pedido");
        _connection.Failure = new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "relation \"loja.nada\" does not exist", "42P01", 15);

        //Act
        var refused = await service.ExecuteVariableAsync(session, "SELECT * FROM loja.nada", [], 10_000, CancellationToken.None);
        var cells = service.GetCells(session, current, []);

        //Assert
        Assert.Equal((EDatabaseFailure.ExecutionFailed, "42P01", 15), (refused.Error.Kind, refused.Error.SqlState, refused.Error.Position));
        Assert.True(cells.IsSuccess);
    }

    [Trait("DatabaseSessionService", "GetColumnValuesAsync")]
    [Fact(DisplayName = "OK os valores vão com a busca como parâmetro, o total é uma segunda leitura, e a página tira a linha a mais")]
    public async Task GetColumnValues_ShouldReadThePageAndTheTotal()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);
        _connection.Columns = PostgresPedido;
        _connection.RowsToRead.Enqueue(new FullRows([new("status", "varchar", "text")], [["aberta"], ["a_paga"]], 2));
        _connection.RowsToRead.Enqueue(new FullRows([new("count", "int8", "number")], [["2"]], 1));

        //Act
        var page = await service.GetColumnValuesAsync(session, "loja", "pedido", new ColumnValuesRequest("status", null, "a_", 0, 1, true), CancellationToken.None);

        //Assert
        Assert.True(page.IsSuccess, page.IsFailure ? page.Error.Message : null);
        Assert.Equal(("text", true, 2L), (page.Value.Kind, page.Value.HasMore, page.Value.Total));
        Assert.Equal(["aberta"], page.Value.Values.Select(value => value.Value));
        Assert.Equal(2, _connection.ValueReads.Count);
        Assert.Equal("SELECT DISTINCT \"status\" FROM \"loja\".\"pedido\" WHERE \"status\" IS NOT NULL AND (\"status\"::text ILIKE $1 ESCAPE '!') ORDER BY \"status\" LIMIT 2 OFFSET 0", _connection.ValueReads[0].Sql);
        Assert.Equal([new QueryParameter(EQueryParameterType.Text, "%a!_%")], _connection.ValueReads[0].Parameters);
        Assert.Equal("SELECT COUNT(DISTINCT \"status\") FROM \"loja\".\"pedido\" WHERE \"status\" IS NOT NULL AND (\"status\"::text ILIKE $1 ESCAPE '!')", _connection.ValueReads[1].Sql);
    }

    [Trait("DatabaseSessionService", "GetColumnValuesAsync")]
    [Fact(DisplayName = "OK sem total pedido o total é nulo, e só a página vai ao banco")]
    public async Task GetColumnValues_WithoutTotal_ShouldReadOnlyThePage()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);
        _connection.Columns = PostgresPedido;
        _connection.RowsToRead.Enqueue(new FullRows([new("id", "int4", "number"), new("status", "varchar", "text")], [["1", "aberta"]], 1));

        //Act
        var page = await service.GetColumnValuesAsync(session, "loja", "pedido", new ColumnValuesRequest("id", "status", null, 0, 100, false), CancellationToken.None);

        //Assert
        Assert.Null(page.Value.Total);
        Assert.Equal(("1", "aberta"), (page.Value.Values[0].Value, page.Value.Values[0].Description));
        Assert.Single(_connection.ValueReads);
    }

    [Trait("DatabaseSessionService", "GetColumnValuesAsync")]
    [Fact(DisplayName = "Erro a coluna binária é VALUES_INVALID e a tabela sem colunas é VALUES_TABLE_NOT_FOUND, sem ler valores")]
    public async Task GetColumnValues_ShouldRefuseByTheCatalog()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);
        _connection.Columns = PostgresPedido;
        var binary = await service.GetColumnValuesAsync(session, "loja", "pedido", new ColumnValuesRequest("foto", null, null, 0, 100, false), CancellationToken.None);
        _connection.Columns = [];

        //Act
        var missing = await service.GetColumnValuesAsync(session, "loja", "nada", new ColumnValuesRequest("id", null, null, 0, 100, false), CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.ValuesInvalid, "column"), (binary.Error.Kind, binary.Error.Field));
        Assert.Equal(EDatabaseFailure.ValuesTableNotFound, missing.Error.Kind);
        Assert.Empty(_connection.ValueReads);
    }

    [Trait("DatabaseSessionService", "GetColumnValuesAsync")]
    [Fact(DisplayName = "Erro fora do PostgreSQL, do Db2 e do Informix os valores não se listam, sem ir ao banco")]
    public async Task GetColumnValues_OutsideTheThreeEngines_ShouldBeRefused()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Sqlite);

        //Act
        var values = await service.GetColumnValuesAsync(session, "main", "pedido", new ColumnValuesRequest("id", null, null, 0, 100, false), CancellationToken.None);
        var check = await service.CheckColumnValuesAsync(session, "main", "pedido", "id", [Dez], CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.ExecutionFailed, "Os valores de uma coluna só se listam no PostgreSQL, no Db2 e no Informix."), (values.Error.Kind, values.Error.Message));
        Assert.Equal(EDatabaseFailure.ExecutionFailed, check.Error.Kind);
        Assert.Empty(_connection.ValueReads);
    }

    [Trait("DatabaseSessionService", "CheckColumnValuesAsync")]
    [Fact(DisplayName = "OK a conferência leva só os valores que convertem e responde as posições dos que faltam")]
    public async Task CheckColumnValues_ShouldAnswerTheMissingPositions()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);
        _connection.Columns = PostgresPedido;
        _connection.RowsToRead.Enqueue(new FullRows([new("id", "int4", "number")], [["7"]], 1));

        //Act
        var missing = await service.CheckColumnValuesAsync(session, "loja", "pedido", "id", [new(EQueryParameterType.Number, "7.0"), new(EQueryParameterType.Text, "sete"), new(EQueryParameterType.Number, "8")], CancellationToken.None);

        //Assert
        Assert.Equal([1, 2], missing.Value);
        var read = Assert.Single(_connection.ValueReads);
        Assert.Equal("SELECT DISTINCT \"id\" FROM \"loja\".\"pedido\" WHERE \"id\" IN ($1, $2)", read.Sql);
        Assert.Equal([new QueryParameter(EQueryParameterType.Number, "7"), new QueryParameter(EQueryParameterType.Number, "8")], read.Parameters);
    }

    [Trait("DatabaseSessionService", "CheckColumnValuesAsync")]
    [Fact(DisplayName = "OK nenhum valor que converte: todos faltam, e nada vai ao banco; a coluna que não é da tabela é VALUES_INVALID")]
    public async Task CheckColumnValues_WithoutConvertibleValues_ShouldNotReachTheDatabase()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.PostgreSql);
        _connection.Columns = PostgresPedido;

        //Act
        var missing = await service.CheckColumnValuesAsync(session, "loja", "pedido", "id", [new(EQueryParameterType.Text, "sete"), new(EQueryParameterType.Text, null)], CancellationToken.None);
        var refused = await service.CheckColumnValuesAsync(session, "loja", "pedido", "outra", [Dez], CancellationToken.None);

        //Assert
        Assert.Equal([0, 1], missing.Value);
        Assert.Equal((EDatabaseFailure.ValuesInvalid, "column"), (refused.Error.Kind, refused.Error.Field));
        Assert.Empty(_connection.ValueReads);
    }

    /// <summary>RN-VAR-036: o log das três operações leva contagens, nunca o texto da consulta, um valor ou a busca.</summary>
    [Trait("DatabaseSessionService", "Log")]
    [Fact(DisplayName = "OK o log da consulta da variável, dos valores e da conferência não tem valor, parâmetro nem busca")]
    public async Task VariableOperations_ShouldLogOnlyCounts()
    {
        //Arrange
        var events = new LogEvents();
        var service = new DatabaseSessionService([new EngineClient(EDatabaseEngine.PostgreSql, _connection)], _vault.Object, _clock, new LoggerConfiguration().MinimumLevel.Verbose().WriteTo.Sink(events).CreateLogger());
        var session = (await service.OpenAsync(Guid.NewGuid(), Settings, 0, CancellationToken.None)).Value.ID;
        _connection.Columns = PostgresPedido;
        _connection.RowsToRead.Enqueue(TwoIDs);
        _connection.RowsToRead.Enqueue(new FullRows([new("status", "varchar", "text")], [[Secret]], 1));
        _connection.RowsToRead.Enqueue(new FullRows([new("count", "int8", "number")], [["1"]], 1));
        _connection.RowsToRead.Enqueue(new FullRows([new("status", "varchar", "text")], [[Secret]], 1));
        QueryParameter[] values = [new(EQueryParameterType.Text, Secret)];

        //Act
        await service.ExecuteVariableAsync(session, $"SELECT '{Secret}', $1", values, 10_000, CancellationToken.None);
        await service.GetColumnValuesAsync(session, "loja", "pedido", new ColumnValuesRequest("status", null, Secret, 0, 100, true), CancellationToken.None);
        await service.CheckColumnValuesAsync(session, "loja", "pedido", "status", values, CancellationToken.None);

        //Assert
        Assert.Contains(events.Written, text => text.Contains("ExecuteVariableAsync", StringComparison.Ordinal) && text.Contains("1 parâmetros", StringComparison.Ordinal));
        Assert.Contains(events.Written, text => text.Contains("conferiu 1 valores, 1 foram ao banco", StringComparison.Ordinal));
        Assert.All(events.Written, text => Assert.DoesNotContain(Secret, text, StringComparison.Ordinal));
    }

    /// <summary>O que o log escreveu: a mensagem e cada propriedade, como texto.</summary>
    private sealed class LogEvents : ILogEventSink
    {
        public List<string> Written { get; } = [];

        public void Emit(LogEvent logEvent)
            => Written.Add($"{logEvent.RenderMessage()} {string.Join(' ', logEvent.Properties.Select(property => $"{property.Key}={property.Value}"))} {logEvent.Exception}");
    }
}
