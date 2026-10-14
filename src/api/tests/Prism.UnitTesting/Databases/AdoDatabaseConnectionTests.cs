using Moq;
using Moq.Protected;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.TestingCore.Extensions;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using System.Data;
using System.Data.Common;
using System.Globalization;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// A base dos drivers sobre um driver de mentira (`DbConnection`, `DbCommand` e `DbDataReader` do Moq), para o que um banco de verdade
/// não deixa provocar na hora certa: a limpeza da transação que falha com a conexão viva e o cancelamento que chega enquanto o `BEGIN`
/// da tentativa ainda está indo ao banco. O comportamento com o PostgreSQL de verdade é dos fixtures de integração.
/// </summary>
public sealed class AdoDatabaseConnectionTests
{
    private const string ReadQuery = "SELECT numero FROM tabela";

    /// <summary>Um comando com contagem de linhas (o banco de mentira responde 3) e um utilitário, que volta sem linhas e sem contagem.</summary>
    private const string CountedCommand = "UPDATE tabela SET numero = 1";
    private const string UtilityCommand = "CREATE TABLE nova (id INTEGER)";

    /// <summary>Um comando que grava e devolve linhas: não começa como leitura, e roda até o fim, fora de transação.</summary>
    private const string WriteReturningRows = "UPDATE tabela SET numero = 1 RETURNING numero";

    private readonly Mock<DbConnection> _driver = new();

    /// <summary>Quantas vezes a base perguntou ao banco se a conexão ficou dentro de uma transação, e o que o banco de mentira responde.</summary>
    private int _transactionProbes;
    private bool _insideTransaction;

    /// <summary>O banco de mentira sem transação só de leitura confere a transação depois de todo comando executado até o fim, tenha ele dado certo ou falhado, como o Informix.</summary>
    private bool _probesEveryCommand;

    /// <summary>
    /// A sonda de transação do driver de mentira, nos dois passos da do PostgreSQL. No primeiro, que não envia nada ao banco, o driver
    /// recusa a transação nova quando sabe que há uma aberta; no segundo, a ida e volta da própria sonda, ele lança quando a conexão cai
    /// ou o banco a recusa. Nulo é o passo dar certo.
    /// </summary>
    private Func<Exception?> _probeBegin;
    private Func<Exception?> _probeRoundTrip = () => null;

    /// <summary>Os comandos que chegaram ao banco de mentira, na ordem.</summary>
    private readonly List<string> _sent = [];

    private ConnectionState _state = ConnectionState.Closed;

    /// <summary>O que o banco de mentira responde a um comando sem linhas (`BEGIN`, `COMMIT`, `ROLLBACK`).</summary>
    private Func<string, CancellationToken, Task<int>> _nonQuery = (_, _) => Task.FromResult(0);

    /// <summary>O que o banco de mentira lança no lugar do resultado de um comando; nulo é responder normalmente.</summary>
    private Func<string, Exception?> _commandFailure = _ => null;

    /// <summary>Quantas linhas a leitura devolve.</summary>
    private int _rows = 250;

    /// <summary>O valor da coluna da leitura na linha de número dado (a partir de 1), e o tipo do C# que o driver diz que ela entrega.</summary>
    private Func<int, object> _value = row => row;
    private Type _fieldType = typeof(int);

    /// <summary>O que o banco de mentira lança no lugar da linha de número dado (a partir de 1); nulo é entregar a linha.</summary>
    private Func<int, Exception?> _rowFailure = _ => null;

    /// <summary>As linhas que o banco de mentira devolve a uma consulta de catálogo, pelo texto dela; nulo numa célula é `DBNull`.</summary>
    private readonly Dictionary<string, object?[][]> _catalog = [];

    /// <summary>O que o banco de mentira responde quando o resultado é lido até o fim, depois da última linha: é onde ele confirma o comando.</summary>
    private Func<Task<bool>> _endOfResult = () => Task.FromResult(false);

    /// <summary>O que o descarte do leitor encontra: num driver de verdade, é onde aparece o erro que ficou no fim de um resultado que ninguém leu até lá.</summary>
    private Func<ValueTask> _disposeReader = () => ValueTask.CompletedTask;

    public AdoDatabaseConnectionTests()
    {
        // O texto da recusa não é o do Npgsql de propósito: a base não pode depender dele, que muda com a versão e o idioma do driver.
        _probeBegin = () => _insideTransaction ? new InvalidOperationException("recusa do driver de mentira") : null;
        _driver.SetupGet(driver => driver.State).Returns(() => _state);
        _driver.SetupGet(driver => driver.ServerVersion).Returns("0");
        _driver.Setup(driver => driver.OpenAsync(It.IsAny<CancellationToken>())).Returns(() =>
        {
            _state = ConnectionState.Open;

            return Task.CompletedTask;
        });
        _driver.Setup(driver => driver.DisposeAsync()).Returns(() =>
        {
            _state = ConnectionState.Closed;

            return ValueTask.CompletedTask;
        });
        _driver.Protected().Setup<DbCommand>("CreateDbCommand").Returns(CreateCommand);
    }

    private async Task<IDatabaseConnection> OpenAsync(ILogger? logger = null)
        => (await new FakeEngineConnection(_driver.Object, BeginProbe, () => _probeRoundTrip(), logger ?? Logger.None).OpenAsync(CancellationToken.None)).Value;

    private Exception? BeginProbe()
    {
        _transactionProbes++;

        return _probeBegin();
    }

    private DbCommand CreateCommand()
    {
        var command = new Mock<DbCommand>();
        command.SetupProperty(mock => mock.CommandText, string.Empty);
        command.SetupProperty(mock => mock.CommandTimeout);

        // As consultas de catálogo levam o esquema e a tabela como parâmetro.
        var parameters = new Mock<DbParameterCollection>();
        command.Protected().Setup<DbParameter>("CreateDbParameter").Returns(() => new Mock<DbParameter>().SetupAllProperties().Object);
        command.Protected().SetupGet<DbParameterCollection>("DbParameterCollection").Returns(parameters.Object);
        command.Setup(mock => mock.ExecuteNonQueryAsync(It.IsAny<CancellationToken>())).Returns((CancellationToken token) =>
        {
            _sent.Add(command.Object.CommandText);

            return _nonQuery(command.Object.CommandText, token);
        });
        command.Protected().Setup<Task<DbDataReader>>("ExecuteDbDataReaderAsync", ItExpr.IsAny<CommandBehavior>(), ItExpr.IsAny<CancellationToken>()).Returns((CommandBehavior _, CancellationToken token) =>
        {
            // Como um driver de verdade: com o cancelamento já pedido, o comando nem é enviado.
            if (token.IsCancellationRequested)
                return Task.FromCanceled<DbDataReader>(token);

            _sent.Add(command.Object.CommandText);

            if (_commandFailure(command.Object.CommandText) is { } failure)
                return Task.FromException<DbDataReader>(failure);

            if (_catalog.TryGetValue(command.Object.CommandText, out var rows))
                return Task.FromResult(CreateCatalogReader(rows));

            return Task.FromResult(command.Object.CommandText is ReadQuery or WriteReturningRows ? CreateReader() : CreateEmptyReader(command.Object.CommandText == CountedCommand ? 3 : -1));
        });

        return command.Object;
    }

    /// <summary>O leitor de um comando sem linhas: com a contagem do que alterou, ou -1 quando é um comando utilitário.</summary>
    private static DbDataReader CreateEmptyReader(int recordsAffected)
    {
        var reader = new Mock<DbDataReader>();
        reader.SetupGet(mock => mock.FieldCount).Returns(0);
        reader.SetupGet(mock => mock.RecordsAffected).Returns(recordsAffected);
        reader.Setup(mock => mock.ReadAsync(It.IsAny<CancellationToken>())).ReturnsAsync(false);

        return reader.Object;
    }

    /// <summary>O leitor de uma consulta de catálogo: as linhas dadas, uma por leitura.</summary>
    private static DbDataReader CreateCatalogReader(object?[][] rows)
    {
        var reader = new Mock<DbDataReader>();
        var row = -1;
        reader.SetupGet(mock => mock.FieldCount).Returns(rows.Length == 0 ? 1 : rows[0].Length);
        reader.Setup(mock => mock.ReadAsync(It.IsAny<CancellationToken>())).Returns(() => Task.FromResult(++row < rows.Length));
        reader.Setup(mock => mock.GetValue(It.IsAny<int>())).Returns((int ordinal) => rows[row][ordinal] ?? DBNull.Value);
        reader.Setup(mock => mock.IsDBNull(It.IsAny<int>())).Returns((int ordinal) => rows[row][ordinal] is null);
        reader.Setup(mock => mock.NextResultAsync(It.IsAny<CancellationToken>())).ReturnsAsync(false);

        return reader.Object;
    }

    private DbDataReader CreateReader()
    {
        var reader = new Mock<DbDataReader>();
        var row = 0;
        reader.SetupGet(mock => mock.FieldCount).Returns(1);
        reader.Setup(mock => mock.GetName(0)).Returns("numero");
        reader.Setup(mock => mock.GetDataTypeName(0)).Returns("integer");
        reader.Setup(mock => mock.GetFieldType(0)).Returns(() => _fieldType);
        reader.Setup(mock => mock.ReadAsync(It.IsAny<CancellationToken>())).Returns(() => _rowFailure(row + 1) is { } failure ? Task.FromException<bool>(failure) : Task.FromResult(row++ < _rows));
        reader.Setup(mock => mock.GetValue(0)).Returns(() => _value(row));
        reader.Setup(mock => mock.NextResultAsync(It.IsAny<CancellationToken>())).Returns(() => _endOfResult());
        reader.Setup(mock => mock.DisposeAsync()).Returns(() => _disposeReader());

        return reader.Object;
    }

    /// <summary>
    /// RN-SQL-017: a página leva, ao lado das marcas de corte, o valor completo de cada célula cortada, na mesma ordem (o texto inteiro, o
    /// binário inteiro), nas duas páginas do cursor. Quem o guarda e o tira da página é o registro de sessões.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK a página leva o valor completo das células cortadas, na ordem das marcas, também no carregar mais")]
    public async Task Execute_ShouldCarryTheFullValueOfEveryCutCell()
    {
        //Arrange
        _rows = 4;
        _fieldType = typeof(string);
        _value = row => row % 2 == 0 ? new string((char)('a' + row), 10000 + row) : "curto";
        var connection = await OpenAsync();

        //Act
        var first = await connection.ExecuteAsync(ReadQuery, 2, CancellationToken.None);
        var next = await connection.FetchNextAsync(CancellationToken.None);

        //Assert
        var page = first.Value.Page!;
        Assert.Equal([new[] { 1, 0 }], page.TruncatedCells);
        Assert.Equal([new string('c', 10002)], page.FullValues!.Select(value => value.Write()));
        Assert.Equal(new string('c', 10000), page.Rows[1][0]);
        Assert.Equal([new[] { 1, 0 }], next.Value.TruncatedCells);
        Assert.Equal([new string('e', 10004)], next.Value.FullValues!.Select(value => value.Write()));
    }

    /// <summary>
    /// O `ROLLBACK` que encerra a transação da tentativa falhou, e a conexão continua viva: ela ficaria presa numa transação que ninguém
    /// mais fecha. A base fecha a conexão; quem a usa vê que ela não está mais aberta e tira a sessão do registro.
    /// </summary>
    [Trait("AdoDatabaseConnection", "CloseCursorAsync")]
    [Fact(DisplayName = "OK o ROLLBACK de limpeza que falha com a conexão viva fecha a conexão")]
    public async Task CloseCursor_ShouldCloseTheConnection_WhenTheRollbackFails()
    {
        //Arrange
        _nonQuery = (sql, _) => sql == "ROLLBACK" ? Task.FromException<int>(new InvalidOperationException("a transação não fechou")) : Task.FromResult(0);
        var connection = await OpenAsync();
        var first = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);
        var openWithTheCursor = connection.IsOpen;

        //Act
        await connection.CloseCursorAsync();

        //Assert
        Assert.True(first.IsSuccess);
        Assert.True(first.Value.Page!.HasMore);
        Assert.True(openWithTheCursor);
        Assert.Equal(["BEGIN READ ONLY", ReadQuery, "ROLLBACK"], _sent);
        Assert.False(connection.IsOpen);
    }

    /// <summary>
    /// O `COMMIT` de uma leitura que chegou ao fim faz parte do comando: se o banco o recusa (uma restrição adiada, conferida ali), a
    /// resposta é essa recusa, e não a página. A limpeza desfaz o que sobrou, e a conexão continua aberta.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "Erro o COMMIT recusado de uma leitura que chegou ao fim é a falha do comando")]
    public async Task Execute_ShouldFail_WhenTheCommitOfAFinishedReadIsRefused()
    {
        //Arrange
        _rows = 10;
        _nonQuery = (sql, _) => sql == "COMMIT" ? Task.FromException<int>(new InvalidOperationException("a confirmação foi recusada")) : Task.FromResult(0);
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, outcome.Error.Kind);
        Assert.Equal("a confirmação foi recusada", outcome.Error.Message);
        Assert.Equal(["BEGIN READ ONLY", ReadQuery, "COMMIT", "ROLLBACK"], _sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>Se depois do `COMMIT` recusado nem o `ROLLBACK` passa, a conexão viva é fechada, como em qualquer limpeza que falha; a resposta continua sendo a recusa do `COMMIT`.</summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "Erro COMMIT recusado e ROLLBACK que falha fecham a conexão")]
    public async Task Execute_ShouldCloseTheConnection_WhenNeitherTheCommitNorTheRollbackWorks()
    {
        //Arrange
        _rows = 10;
        _nonQuery = (sql, _) => sql is "COMMIT" or "ROLLBACK" ? Task.FromException<int>(new InvalidOperationException($"{sql} recusado")) : Task.FromResult(0);
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal("COMMIT recusado", outcome.Error.Message);
        Assert.Equal(["BEGIN READ ONLY", ReadQuery, "COMMIT", "ROLLBACK"], _sent);
        Assert.False(connection.IsOpen);
    }

    /// <summary>
    /// RN-SESSAO-005: o banco confirma o comando que grava depois de entregar a última linha, e o que ele recusa ali só aparece quando o
    /// resultado é lido até o fim. É a falha do comando: as linhas já lidas não são a resposta, porque o banco não as gravou.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "Erro recusa do banco depois da última linha de um comando que grava é a falha do comando")]
    public async Task Execute_ShouldFail_WhenTheDatabaseRefusesAfterTheLastRow()
    {
        //Arrange
        _endOfResult = () => Task.FromException<bool>(new InvalidOperationException("a confirmação foi recusada"));
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(WriteReturningRows, CancellationToken.None);
        var afterwards = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, outcome.Error.Kind);
        Assert.Equal("a confirmação foi recusada", outcome.Error.Message);
        Assert.True(afterwards.IsSuccess);
        Assert.Equal([WriteReturningRows, CountedCommand], _sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>O cursor abandonado é outro caso: o que o banco deixou no fim de um resultado que ninguém leu até lá fica com o cursor, e o comando seguinte responde por si.</summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK erro no fim de um cursor abandonado não vira o erro do comando seguinte")]
    public async Task Execute_ShouldNotInheritTheErrorOfAnAbandonedCursor()
    {
        //Arrange
        var connection = await OpenAsync();
        var first = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);
        _disposeReader = () => ValueTask.FromException(new InvalidOperationException("erro que ficou no fim do resultado"));

        //Act
        var next = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(first.IsSuccess);
        Assert.True(first.Value.Page!.HasMore);
        Assert.True(next.IsSuccess);
        Assert.Equal(3, next.Value.RowsAffected);
        Assert.Equal(["BEGIN READ ONLY", ReadQuery, "ROLLBACK", CountedCommand], _sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>
    /// O comando que chega com o cursor anterior aberto abandona esse cursor antes de ser enviado. Se o `ROLLBACK` não passa, a conexão é
    /// fechada e o comando não tem para onde ir: ele não é enviado, e a resposta diz isso, no lugar do erro do driver para uma conexão
    /// descartada.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Theory(DisplayName = "Erro comando que chega depois de a limpeza fechar a conexão não é enviado e diz que a conexão foi encerrada")]
    [InlineData(ReadQuery)]
    [InlineData(CountedCommand)]
    public async Task Execute_ShouldNotSendTheCommand_WhenTheCleanupOfThePreviousCursorClosedTheConnection(string command)
    {
        //Arrange
        _nonQuery = (sql, _) => sql == "ROLLBACK" ? Task.FromException<int>(new InvalidOperationException("a transação não fechou")) : Task.FromResult(0);
        var connection = await OpenAsync();
        await connection.ExecuteAsync(ReadQuery, CancellationToken.None);

        //Act
        var outcome = await connection.ExecuteAsync(command, CancellationToken.None);
        var ping = await connection.PingAsync(CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, outcome.Error.Kind);
        Assert.Equal("A conexão com o banco foi encerrada, e o comando não foi enviado. Abra a sessão de novo.", outcome.Error.Message);
        Assert.Equal(EDatabaseFailure.ConnectionFailed, ping.Error.Kind);
        Assert.Equal(["BEGIN READ ONLY", ReadQuery, "ROLLBACK"], _sent);
        Assert.False(connection.IsOpen);
    }

    /// <summary>A limpeza que dá certo deixa a conexão aberta: fechá-la é só para a transação que não fechou.</summary>
    [Trait("AdoDatabaseConnection", "CloseCursorAsync")]
    [Fact(DisplayName = "OK a limpeza que dá certo mantém a conexão aberta")]
    public async Task CloseCursor_ShouldKeepTheConnection_WhenTheRollbackWorks()
    {
        //Arrange
        var connection = await OpenAsync();
        await connection.ExecuteAsync(ReadQuery, CancellationToken.None);

        //Act
        await connection.CloseCursorAsync();
        var again = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);

        //Assert
        Assert.True(connection.IsOpen);
        Assert.True(again.IsSuccess);
        Assert.Equal(["BEGIN READ ONLY", ReadQuery, "ROLLBACK", "BEGIN READ ONLY", ReadQuery], _sent);
    }

    /// <summary>
    /// RN-SQL-010: o cancelamento chega enquanto o `BEGIN` da tentativa está indo ao banco, antes de existir o comando do usuário para
    /// interromper. Ele vale assim mesmo: quando o `BEGIN` volta, o comando do usuário não é enviado, e a transação é desfeita.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "OK cancelar enquanto o BEGIN da tentativa vai ao banco impede o envio do comando")]
    public async Task Cancel_ShouldKeepTheCommandFromBeingSent_WhenItArrivesDuringTheBegin()
    {
        //Arrange
        var begin = new TaskCompletionSource<int>();
        _nonQuery = (sql, _) => sql == "BEGIN READ ONLY" ? begin.Task : Task.FromResult(0);
        var connection = await OpenAsync();
        var running = connection.ExecuteAsync(ReadQuery, CancellationToken.None);

        //Act
        connection.Cancel();
        begin.SetResult(0);
        var outcome = await running;
        var afterwards = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, outcome.Error.Kind);
        Assert.Equal("O comando foi cancelado.", outcome.Error.Message);
        Assert.Equal(ECancelOutcome.Canceled, outcome.Error.Outcome);
        Assert.Equal(["BEGIN READ ONLY", "ROLLBACK", "BEGIN READ ONLY", ReadQuery], _sent);
        Assert.True(afterwards.IsSuccess);
        Assert.True(connection.IsOpen);
    }

    /// <summary>
    /// RN-SQL-010: o driver esperou a resposta do banco ao cancelamento, não a recebeu a tempo e derrubou a conexão. O comando pode ter
    /// sido concluído no banco, então a resposta não diz que ele foi cancelado: diz que o Prism não sabe, e que a sessão foi encerrada.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro cancelamento que derrubou a conexão responde que não se sabe se o comando foi concluído")]
    public async Task Execute_ShouldSayTheOutcomeIsUnknown_WhenTheCancellationClosedTheConnection()
    {
        //Arrange
        _commandFailure = _ =>
        {
            _state = ConnectionState.Closed;

            return new OperationCanceledException("texto do .NET");
        };
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, outcome.Error.Kind);
        Assert.Equal("O banco não respondeu ao cancelamento a tempo, e a sessão foi encerrada. O Prism não sabe se o comando foi concluído: confira no banco antes de executá-lo de novo.", outcome.Error.Message);
        Assert.False(connection.IsOpen);
    }

    /// <summary>Com a conexão aberta depois do cancelamento, o comando foi interrompido (ou nem enviado), e a resposta diz isso.</summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro cancelamento com a conexão aberta responde que o comando foi cancelado")]
    public async Task Execute_ShouldSayTheCommandWasCanceled_WhenTheConnectionIsStillOpen()
    {
        //Arrange
        _commandFailure = _ => new OperationCanceledException("texto do .NET");
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal("O comando foi cancelado.", outcome.Error.Message);
        Assert.True(connection.IsOpen);
    }

    /// <summary>
    /// O driver da IBM entrega o cancelamento de uma leitura embrulhado num `AggregateException`. A resposta é a mesma de qualquer
    /// cancelamento, e não o texto do .NET; e o log registra uma recusa, sem a pilha de um defeito.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro cancelamento que o driver entrega embrulhado responde que o comando foi cancelado")]
    public async Task Execute_ShouldSayTheCommandWasCanceled_WhenTheDriverWrapsTheCancellation()
    {
        //Arrange
        _commandFailure = _ => new AggregateException(new TaskCanceledException("texto do .NET"));
        var sink = new CollectingSink();
        var connection = await OpenAsync(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());

        //Act
        var outcome = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal("O comando foi cancelado.", outcome.Error.Message);
        Assert.True(connection.IsOpen);
        var logEvent = Assert.Single(sink.Events);
        Assert.Equal(LogEventLevel.Information, logEvent.Level);
    }

    /// <summary>O cancelamento de um comando não sobra para o seguinte: sem comando em andamento ele não faz nada.</summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "OK cancelar sem comando em andamento não atinge o comando seguinte")]
    public async Task Cancel_ShouldNotReachTheNextCommand_WhenNothingIsRunning()
    {
        //Arrange
        var connection = await OpenAsync();

        //Act
        connection.Cancel();
        var outcome = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(["BEGIN READ ONLY", ReadQuery], _sent);
    }

    /// <summary>
    /// RN-SQL-010 (Ruling 135): o cancelamento já pedido quando o comando sai faz o driver recusá-lo antes de enviar. É a prova de que
    /// nada dele ficou, e o desfecho é `canceled`: o comando nem chegou ao banco, e a conexão segue aberta.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro cancelamento antes do envio tem o desfecho canceled, e o comando não chega ao banco")]
    public async Task Execute_ShouldBeCanceled_WhenTheCancellationArrivesBeforeTheCommandIsSent()
    {
        //Arrange
        using var canceled = new CancellationTokenSource();
        await canceled.CancelAsync();
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(CountedCommand, canceled.Token);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, outcome.Error.Kind);
        Assert.Equal("O comando foi cancelado.", outcome.Error.Message);
        Assert.Equal(ECancelOutcome.Canceled, outcome.Error.Outcome);
        Assert.Empty(_sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>
    /// RN-SQL-010: "Cancelar" pedido, o banco não respondeu a tempo e o driver derrubou a conexão. O comando pode ter sido concluído lá,
    /// e o desfecho é `unknown`.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro cancelamento pedido que derrubou a conexão tem o desfecho unknown")]
    public async Task Execute_ShouldHaveTheUnknownOutcome_WhenTheRequestedCancellationClosedTheConnection()
    {
        //Arrange
        IDatabaseConnection? connection = null;
        _commandFailure = _ =>
        {
            connection!.Cancel();
            _state = ConnectionState.Closed;

            return new OperationCanceledException("texto do .NET");
        };
        connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal("O banco não respondeu ao cancelamento a tempo, e a sessão foi encerrada. O Prism não sabe se o comando foi concluído: confira no banco antes de executá-lo de novo.", outcome.Error.Message);
        Assert.Equal(ECancelOutcome.Unknown, outcome.Error.Outcome);
        Assert.False(connection.IsOpen);
    }

    /// <summary>RN-SQL-010: o banco diz que interrompeu o comando a pedido (57014, no PostgreSQL e no Db2), e com isso o desfez. A mensagem e o SQLSTATE são os dele.</summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro comando que o banco interrompeu a pedido tem o desfecho canceled, com a mensagem e o SQLSTATE dele")]
    public async Task Execute_ShouldBeCanceled_WhenTheDatabaseInterruptsTheCommandOnRequest()
    {
        //Arrange
        IDatabaseConnection? connection = null;
        _commandFailure = _ => CancelAndInterrupt(connection!);
        connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal("canceling statement due to user request", outcome.Error.Message);
        Assert.Equal("57014", outcome.Error.SqlState);
        Assert.Equal(ECancelOutcome.Canceled, outcome.Error.Outcome);
    }

    /// <summary>
    /// Sem pedido de cancelamento não há desfecho: o mesmo 57014 que o `statement_timeout` do PostgreSQL produz é um erro comum do
    /// banco (RN-SQL-009), e a tela o mostra como tal.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "OK sem pedido de cancelamento, o 57014 é um erro comum, sem desfecho")]
    public async Task Execute_ShouldHaveNoOutcome_WhenTheDatabaseInterruptsTheCommandWithoutARequest()
    {
        //Arrange
        _commandFailure = _ => new FakeDatabaseException("canceling statement due to statement timeout", "57014");
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal("57014", outcome.Error.SqlState);
        Assert.Null(outcome.Error.Outcome);
    }

    /// <summary>O erro do próprio comando (uma divisão por zero) que chega com o cancelamento a caminho continua sendo o erro dele, sem desfecho de cancelamento.</summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "OK erro do próprio comando que chega com o cancelamento a caminho não tem desfecho")]
    public async Task Execute_ShouldHaveNoOutcome_WhenTheCommandFailsByItselfWithACancellationOnTheWay()
    {
        //Arrange
        IDatabaseConnection? connection = null;
        _commandFailure = _ =>
        {
            connection!.Cancel();

            return new FakeDatabaseException("division by zero", "22012");
        };
        connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal("22012", outcome.Error.SqlState);
        Assert.Null(outcome.Error.Outcome);
    }

    /// <summary>
    /// No driver que lança ao ser cancelado (o do PostgreSQL), o 57014 que chega enquanto o comando executado até o fim devolve as
    /// linhas também prova que nada ficou: o banco só confirma o comando depois da última, e o que ele interrompe antes é desfeito.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro no driver que lança ao ser cancelado, a interrupção enquanto o comando devolve as linhas tem o desfecho canceled")]
    public async Task Execute_ShouldBeCanceled_WhenTheDriverThatThrowsOnCancelIsInterruptedWhileReturningRows()
    {
        //Arrange
        var connection = await OpenAsync();
        _rowFailure = row => row == 100 ? CancelAndInterrupt(connection) : null;

        //Act
        var outcome = await connection.ExecuteAsync(WriteReturningRows, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal("57014", outcome.Error.SqlState);
        Assert.Equal(ECancelOutcome.Canceled, outcome.Error.Outcome);
    }

    /// <summary>
    /// RN-SQL-006 e 010: a contagem cancelada antes de ir ao banco também tem o desfecho `canceled`. A transação só de leitura que ela
    /// abriu é desfeita, e a subconsulta nem é enviada.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro contagem cancelada antes de ir ao banco tem o desfecho canceled")]
    public async Task Count_ShouldBeCanceled_WhenTheCancellationArrivesBeforeTheCountIsSent()
    {
        //Arrange
        using var canceled = new CancellationTokenSource();
        await canceled.CancelAsync();
        var connection = await OpenAsync();

        //Act
        var total = await connection.CountAsync(ReadQuery, canceled.Token);

        //Assert
        Assert.True(total.IsFailure);
        Assert.Equal("O comando foi cancelado.", total.Error.Message);
        Assert.Equal(ECancelOutcome.Canceled, total.Error.Outcome);
        Assert.DoesNotContain(ReadQuery, _sent);
    }

    /// <summary>
    /// RN-SESSAO-005, a rede de segurança: a base só pergunta ao banco se a conexão ficou em transação depois de um comando utilitário,
    /// que é como um `BEGIN` volta. Um comando com contagem de linhas (`INSERT`, `UPDATE`, `DELETE`) não abre transação e não paga a ida.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK comando com contagem de linhas não dispara a sonda de transação")]
    public async Task Execute_ShouldNotProbeForATransaction_AfterACommandWithARowCount()
    {
        //Arrange
        _insideTransaction = true;
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(3, outcome.Value.RowsAffected);
        Assert.Equal(0, _transactionProbes);
        Assert.Equal([CountedCommand], _sent);
    }

    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK leitura não dispara a sonda de transação")]
    public async Task Execute_ShouldNotProbeForATransaction_AfterARead()
    {
        //Arrange
        _insideTransaction = true;
        _rows = 10;
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(0, _transactionProbes);
        Assert.Equal(["BEGIN READ ONLY", ReadQuery, "COMMIT"], _sent);
    }

    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK comando utilitário que não abriu transação responde sucesso, com uma sonda")]
    public async Task Execute_ShouldProbeOnce_AfterAUtilityCommand()
    {
        //Arrange
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(UtilityCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(0, outcome.Value.RowsAffected);
        Assert.Equal(1, _transactionProbes);
        Assert.Equal([UtilityCommand], _sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>
    /// Uma forma de abrir transação que a recusa da RN-SQL-003 não conhece chegou ao banco. A transação é desfeita ali mesmo, antes de
    /// qualquer outro comando, e a resposta é a mesma recusa: a gravação seguinte não cai dentro de uma transação que ninguém confirma.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "Erro comando utilitário que deixou a conexão em transação é desfeito e recusado")]
    public async Task Execute_ShouldRollBackAndRefuse_WhenAUtilityCommandLeftATransactionOpen()
    {
        //Arrange
        _insideTransaction = true;
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(UtilityCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.TransactionControlNotSupported, outcome.Error.Kind);
        Assert.True(outcome.Error.Executed);
        Assert.Equal(1, _transactionProbes);
        Assert.Equal([UtilityCommand, "ROLLBACK"], _sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>
    /// RN-SQL-003 e RN-SESSAO-005: o controle de transação escrito no texto é recusado antes de executar. A resposta não leva `executed`,
    /// nada vai ao banco, e o cursor aberto pelo comando anterior continua legível.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "Erro controle de transação recusado antes de executar não leva executed, e o cursor aberto continua")]
    public async Task Execute_ShouldRefuseWithoutExecuted_WhenTheTextIsTransactionControl()
    {
        //Arrange
        var connection = await OpenAsync();
        var read = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);

        //Act
        var refused = await connection.ExecuteAsync("BEGIN", CancellationToken.None);
        var next = await connection.FetchNextAsync(CancellationToken.None);

        //Assert
        Assert.True(read.IsSuccess);
        Assert.True(refused.IsFailure);
        Assert.Equal(EDatabaseFailure.TransactionControlNotSupported, refused.Error.Kind);
        Assert.False(refused.Error.Executed);
        Assert.True(next.IsSuccess);
        Assert.Equal(50, next.Value.Rows.Count);
        Assert.Equal(["BEGIN READ ONLY", ReadQuery, "COMMIT"], _sent);
    }

    /// <summary>
    /// RN-LOG-001. A transação que a rede de segurança desfez fica no log como um aviso próprio: nada falhou, então não é a linha de erro
    /// com pilha de uma conexão que quebrou. E, como todo log daqui, sem o SQL do comando.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK transação desfeita pela rede de segurança deixa um aviso no log, sem SQL e sem pilha")]
    public async Task Execute_ShouldLogOneWarning_WhenAStrayTransactionIsRolledBack()
    {
        //Arrange
        _insideTransaction = true;
        var sink = new CollectingSink();
        var connection = await OpenAsync(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());

        //Act
        await connection.ExecuteAsync(UtilityCommand, CancellationToken.None);

        //Assert
        var logEvent = Assert.Single(sink.Events);
        Assert.Equal(LogEventLevel.Warning, logEvent.Level);
        Assert.Null(logEvent.Exception);
        Assert.Equal("Um comando deixou uma transação aberta na conexão: ela foi desfeita, e o comando foi recusado.", logEvent.RenderMessage());
        Assert.Equal(["SourceContext"], logEvent.Properties.Keys);
    }

    /// <summary>O comando utilitário que não abriu transação não deixa nada no log: a conferência é rotina.</summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK conferência que não acha transação não escreve no log")]
    public async Task Execute_ShouldLogNothing_WhenTheProbeFindsNoTransaction()
    {
        //Arrange
        var sink = new CollectingSink();
        var connection = await OpenAsync(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());

        //Act
        await connection.ExecuteAsync(UtilityCommand, CancellationToken.None);

        //Assert
        Assert.Empty(sink.Events);
    }

    /// <summary>Se nem o `ROLLBACK` passa, vale o mesmo da limpeza que falha: a conexão viva é fechada, para não seguir dentro da transação.</summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "Erro transação aberta por um comando utilitário que não pôde ser desfeita fecha a conexão")]
    public async Task Execute_ShouldCloseTheConnection_WhenTheStrayTransactionCannotBeRolledBack()
    {
        //Arrange
        _insideTransaction = true;
        _nonQuery = (sql, _) => sql == "ROLLBACK" ? Task.FromException<int>(new InvalidOperationException("a transação não fechou")) : Task.FromResult(0);
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(UtilityCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.TransactionControlNotSupported, outcome.Error.Kind);
        Assert.Equal([UtilityCommand, "ROLLBACK"], _sent);
        Assert.False(connection.IsOpen);
    }

    /// <summary>
    /// RN-SESSAO-005, no outro sentido: quando a sonda roda, o banco já confirmou o comando utilitário. Se a conexão cai na ida e volta
    /// da própria sonda, isso não diz que havia transação, e a resposta é o sucesso do comando: recusado, a pessoa o executaria de novo
    /// e gravaria duas vezes. A conexão que caiu não recebe `ROLLBACK`, e quem a usa vê que ela não está mais aberta.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK comando utilitário confirmado responde sucesso quando a conexão cai na ida e volta da sonda")]
    public async Task Execute_ShouldSucceed_WhenTheConnectionDropsDuringTheTransactionProbe()
    {
        //Arrange
        _probeRoundTrip = () =>
        {
            _state = ConnectionState.Closed;

            return new FakeDatabaseException("a conexão caiu");
        };
        var sink = new CollectingSink();
        var connection = await OpenAsync(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());

        //Act
        var outcome = await connection.ExecuteAsync(UtilityCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(0, outcome.Value.RowsAffected);
        Assert.Equal(1, _transactionProbes);
        Assert.Equal([UtilityCommand], _sent);
        Assert.False(connection.IsOpen);
        Assert.DoesNotContain(sink.Events, logEvent => logEvent.Level >= LogEventLevel.Warning);
    }

    /// <summary>
    /// O banco recusou a ida e volta da sonda, e a conexão continua viva: ela pode ter ficado dentro da transação da própria sonda. A
    /// base a desfaz pelo fim comum (`ROLLBACK`), a resposta continua sendo o sucesso que o banco confirmou, e o comando seguinte é
    /// enviado a uma conexão limpa.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK comando utilitário confirmado responde sucesso quando o banco recusa a ida e volta da sonda, e a conexão é limpa")]
    public async Task Execute_ShouldSucceedAndRollBack_WhenTheDatabaseRefusesTheTransactionProbe()
    {
        //Arrange
        _probeRoundTrip = () => new FakeDatabaseException("o banco recusou a sonda");
        var sink = new CollectingSink();
        var connection = await OpenAsync(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());

        //Act
        var outcome = await connection.ExecuteAsync(UtilityCommand, CancellationToken.None);
        var afterwards = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(0, outcome.Value.RowsAffected);
        Assert.True(afterwards.IsSuccess);
        Assert.Equal(1, _transactionProbes);
        Assert.Equal([UtilityCommand, "ROLLBACK", CountedCommand], _sent);
        Assert.True(connection.IsOpen);
        Assert.DoesNotContain(sink.Events, logEvent => logEvent.Level >= LogEventLevel.Warning);
    }

    /// <summary>Se nem esse `ROLLBACK` passa, a conexão viva é fechada, como em qualquer limpeza que falha; o comando continua sendo sucesso.</summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK sonda recusada e ROLLBACK que falha fecham a conexão, e o comando utilitário continua sendo sucesso")]
    public async Task Execute_ShouldSucceedAndCloseTheConnection_WhenNeitherTheProbeNorTheRollbackWorks()
    {
        //Arrange
        _probeRoundTrip = () => new FakeDatabaseException("o banco recusou a sonda");
        _nonQuery = (sql, _) => sql == "ROLLBACK" ? Task.FromException<int>(new FakeDatabaseException("a transação não fechou")) : Task.FromResult(0);
        var sink = new CollectingSink();
        var connection = await OpenAsync(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());

        //Act
        var outcome = await connection.ExecuteAsync(UtilityCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(0, outcome.Value.RowsAffected);
        Assert.Equal([UtilityCommand, "ROLLBACK"], _sent);
        Assert.False(connection.IsOpen);
        Assert.DoesNotContain(sink.Events, logEvent => logEvent.Level >= LogEventLevel.Warning);
    }

    /// <summary>
    /// O driver recusa uma transação nova também na conexão que não está aberta (caiu, ou foi descartada por quem desistiu de esperar),
    /// com a mesma classe de exceção de quando há transação. Conexão que não está aberta nunca é "há transação": o comando confirmado
    /// continua sendo sucesso, nada é enviado a ela e nada vai para o log.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK conexão já fechada quando a sonda começa não é tomada por transação aberta")]
    public async Task Execute_ShouldSucceed_WhenTheConnectionIsAlreadyClosedWhenTheProbeStarts()
    {
        //Arrange
        _probeBegin = () =>
        {
            _state = ConnectionState.Closed;

            return new InvalidOperationException("a conexão não está aberta");
        };
        var sink = new CollectingSink();
        var connection = await OpenAsync(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());

        //Act
        var outcome = await connection.ExecuteAsync(UtilityCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(0, outcome.Value.RowsAffected);
        Assert.Equal(1, _transactionProbes);
        Assert.Equal([UtilityCommand], _sent);
        Assert.False(connection.IsOpen);
        Assert.Empty(sink.Events);
    }

    /// <summary>
    /// O banco sem transação só de leitura (Db2 e Informix): a leitura paginada fica em auto-commit. Nada de `BEGIN`, de `COMMIT` nem
    /// de `ROLLBACK` vai ao banco, nem quando o cursor fecha antes do fim nem quando a leitura chega ao fim: num Informix sem log os
    /// três são erro, e a base fecharia a conexão por engano.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK banco sem transação só de leitura não recebe BEGIN, COMMIT nem ROLLBACK numa leitura")]
    public async Task Execute_ShouldSendNoTransactionCommands_WhenTheEngineHasNoReadOnlyTransaction()
    {
        //Arrange
        var connection = await OpenWithoutTransactionsAsync();

        //Act
        var abandoned = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);
        await connection.CloseCursorAsync();
        _rows = 10;
        var finished = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);

        //Assert
        Assert.True(abandoned.IsSuccess);
        Assert.True(abandoned.Value.Page!.HasMore);
        Assert.True(finished.IsSuccess);
        Assert.False(finished.Value.Page!.HasMore);
        Assert.Equal([ReadQuery, ReadQuery], _sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>
    /// RN-SQL-010, no driver que não lança quando o cancelamento chega durante a leitura (os da IBM): ele devolve um resultado vazio ou
    /// só para de entregar linhas. Quem sabe do cancelamento é a conexão, e a página que saiu depois dele não é resposta: a leitura
    /// foi cancelada.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro leitura cancelada num driver que não lança responde que o comando foi cancelado")]
    public async Task Execute_ShouldSayTheReadWasCanceled_WhenTheDriverReturnsWithoutThrowing()
    {
        //Arrange
        var connection = await OpenWithoutTransactionsAsync();
        _commandFailure = _ => CancelAndAnswer(connection);

        //Act
        var outcome = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);
        var next = await connection.FetchNextAsync(CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, outcome.Error.Kind);
        Assert.Equal("O comando foi cancelado.", outcome.Error.Message);
        Assert.Equal(ECancelOutcome.Canceled, outcome.Error.Outcome);
        Assert.Equal(EDatabaseFailure.NoOpenCursor, next.Error.Kind);
        Assert.Equal([ReadQuery], _sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>A consulta de catálogo também é leitura: cortada pelo cancelamento, a lista incompleta não passa por inteira.</summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro consulta de catálogo cancelada num driver que não lança não devolve a lista cortada")]
    public async Task GetSchemas_ShouldFail_WhenCanceledOnADriverThatDoesNotThrow()
    {
        //Arrange
        var connection = await OpenWithoutTransactionsAsync();
        _commandFailure = _ => CancelAndAnswer(connection);

        //Act
        var schemas = await connection.GetSchemasAsync(CancellationToken.None);

        //Assert
        Assert.True(schemas.IsFailure);
        Assert.Equal("O comando foi cancelado.", schemas.Error.Message);
        Assert.Equal(ECancelOutcome.Canceled, schemas.Error.Outcome);
    }

    /// <summary>
    /// RN-SQL-010 e RN-SESSAO-005: o comando executado até o fim já rodou no banco quando o driver volta sem exceção (é na execução
    /// que ele lança). O cancelamento que chegou nesse meio-tempo não transforma o comando confirmado em falha: a resposta é o
    /// sucesso, com as linhas afetadas, e o comando seguinte não herda a marca.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Theory(DisplayName = "OK cancelamento tardio não transforma em falha o comando que o banco executou")]
    [InlineData(CountedCommand, 3)]
    [InlineData(UtilityCommand, 0)]
    public async Task Execute_ShouldSucceed_WhenTheCancellationArrivesAfterTheCommandRan(string command, int rowsAffected)
    {
        //Arrange
        var connection = await OpenWithoutTransactionsAsync();
        _commandFailure = _ => CancelAndAnswer(connection);

        //Act
        var outcome = await connection.ExecuteAsync(command, CancellationToken.None);
        _commandFailure = _ => null;
        var afterwards = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(rowsAffected, outcome.Value.RowsAffected);
        Assert.True(afterwards.IsSuccess);
        Assert.Equal([command, ReadQuery], _sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>
    /// O comando que grava e devolve linhas, no driver que não lança quando o cancelamento chega durante a leitura: ele só para de
    /// entregar linhas. Com o cancelamento pedido antes de a última linha sair, a página e o total podem não ser os do comando, e o
    /// que ele gravava enquanto as devolvia pode ter ficado pela metade. A resposta diz que o Prism não sabe se o comando foi
    /// concluído, sem página e sem total, e o comando seguinte não herda a marca.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro cancelamento pedido enquanto o comando que grava devolve as linhas responde que não se sabe se ele foi concluído")]
    public async Task Execute_ShouldSayTheOutcomeIsUnknown_WhenCanceledWhileAWriteReturnsItsRows()
    {
        //Arrange
        var connection = await OpenWithoutTransactionsAsync();
        _commandFailure = _ => CancelAndAnswer(connection);

        //Act
        var outcome = await connection.ExecuteAsync(WriteReturningRows, CancellationToken.None);
        _commandFailure = _ => null;
        var afterwards = await connection.ExecuteAsync(WriteReturningRows, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, outcome.Error.Kind);
        Assert.Equal("O cancelamento chegou enquanto o comando devolvia as linhas. O que ele gravou até ali está confirmado, e pode ser só uma parte do comando: o Prism não sabe se ele foi concluído. Confira no banco antes de executá-lo de novo.", outcome.Error.Message);
        Assert.Equal(ECancelOutcome.Partial, outcome.Error.Outcome);
        Assert.True(afterwards.IsSuccess);
        Assert.Equal(250, afterwards.Value.Page!.TotalRows);
        Assert.Equal([WriteReturningRows, WriteReturningRows], _sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>
    /// No driver que lança quando é cancelado (o do PostgreSQL), quem diz que o comando foi cancelado é a exceção dele. O comando que
    /// devolveu todas as linhas sem exceção terminou, e continua sendo sucesso mesmo com um cancelamento a caminho.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "OK no driver que lança ao ser cancelado, o comando que devolveu todas as linhas continua sendo sucesso")]
    public async Task Execute_ShouldSucceed_WhenTheDriverThatThrowsOnCancelReturnedEveryRow()
    {
        //Arrange
        var connection = await OpenAsync();
        _commandFailure = _ => CancelAndAnswer(connection);

        //Act
        var outcome = await connection.ExecuteAsync(WriteReturningRows, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(250, outcome.Value.Page!.TotalRows);
    }

    /// <summary>
    /// No driver que só lança quando interrompe a execução (os da IBM), o comando executado até o fim já rodou no banco quando o leitor
    /// abriu. Uma interrupção que ele dissesse dali em diante, com as linhas voltando, não provaria que nada ficou: o desfecho é
    /// `unknown`, com a mensagem do banco.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro no driver que não lança na leitura, a interrupção depois de o comando executado até o fim abrir o leitor tem o desfecho unknown")]
    public async Task Execute_ShouldHaveTheUnknownOutcome_WhenTheDriverThatDoesNotThrowWhileReadingIsInterruptedAfterTheCommandRan()
    {
        //Arrange
        var connection = await OpenWithoutTransactionsAsync();
        _rowFailure = row => row == 100 ? CancelAndInterrupt(connection) : null;

        //Act
        var outcome = await connection.ExecuteAsync(WriteReturningRows, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal("canceling statement due to user request", outcome.Error.Message);
        Assert.Equal(ECancelOutcome.Unknown, outcome.Error.Outcome);
    }

    /// <summary>
    /// RN-SQL-005 e 010: o "carregar mais" cortado pelo cancelamento no driver que não lança é uma leitura cancelada, com o desfecho
    /// `canceled`: uma leitura não grava nada.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro carregar mais cortado pelo cancelamento num driver que não lança tem o desfecho canceled")]
    public async Task FetchNext_ShouldBeCanceled_WhenCanceledOnADriverThatDoesNotThrow()
    {
        //Arrange
        var connection = await OpenWithoutTransactionsAsync();
        var first = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);
        _rowFailure = row => row == 220 ? CancelAndAnswer(connection) : null;

        //Act
        var next = await connection.FetchNextAsync(CancellationToken.None);

        //Assert
        Assert.True(first.IsSuccess);
        Assert.True(first.Value.Page!.HasMore);
        Assert.True(next.IsFailure);
        Assert.Equal("O comando foi cancelado.", next.Error.Message);
        Assert.Equal(ECancelOutcome.Canceled, next.Error.Outcome);
    }

    /// <summary>
    /// O comando cancelado enquanto devolvia as linhas pode ter deixado a conexão dentro de uma transação (no Informix uma função a
    /// abre por dentro e devolve linhas). A conferência roda assim mesmo, e a transação é desfeita. A resposta dizia "o que ele
    /// gravou até ali está confirmado", e o que ele gravou dentro da transação tinha acabado de ser desfeito: ela diz o que houve,
    /// com o mesmo código do comando que termina sem ser cancelado, e o aviso do log cobre o comando cancelado.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro transação deixada pelo comando cancelado enquanto devolvia as linhas é desfeita, e a resposta diz que ela foi desfeita")]
    public async Task Execute_ShouldSayTheTransactionWasUndone_WhenCanceledWhileReturningRows()
    {
        //Arrange
        var sink = new CollectingSink();
        _probesEveryCommand = true;
        _insideTransaction = true;
        var connection = await OpenWithoutTransactionsAsync(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());
        _commandFailure = _ => CancelAndAnswer(connection);

        //Act
        var outcome = await connection.ExecuteAsync(WriteReturningRows, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.TransactionControlNotSupported, outcome.Error.Kind);
        Assert.Equal("O comando deixou uma transação aberta, e o Prism a desfez: nada do que ele gravou dentro dela ficou. Comandos de controle de transação (BEGIN, COMMIT, ROLLBACK, SAVEPOINT) não são aceitos: toda sessão é auto-commit, e cada comando é confirmado quando termina.", outcome.Error.Message);
        Assert.True(outcome.Error.Executed);
        Assert.Null(outcome.Error.Outcome);
        Assert.Equal(1, _transactionProbes);
        Assert.Equal([WriteReturningRows, "ROLLBACK"], _sent);
        Assert.True(connection.IsOpen);
        Assert.Equal("Um comando que falhou ou foi cancelado deixou uma transação aberta na conexão: ela foi desfeita.", Assert.Single(sink.Events, logged => logged.Level == LogEventLevel.Warning).RenderMessage());
    }

    /// <summary>
    /// Só a transação que a conferência achou com certeza muda a resposta. Sem transação aberta, e com a sonda que falha (que não
    /// diz nada sobre o comando), o cancelamento que chega enquanto o comando devolvia as linhas continua com a resposta de antes:
    /// o que ele gravou até ali está confirmado, e o Prism não sabe se ele foi concluído.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Theory(DisplayName = "Erro cancelamento enquanto o comando devolvia as linhas continua respondendo que não se sabe, sem transação aberta ou com a sonda que falha")]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Execute_ShouldKeepTheUnknownOutcome_WhenTheProbeAfterTheCancellationFindsNoTransactionForSure(bool probeFails)
    {
        //Arrange
        _probesEveryCommand = true;
        _probeRoundTrip = () => probeFails ? new FakeDatabaseException("a conexão caiu") : null;
        var connection = await OpenWithoutTransactionsAsync();
        _commandFailure = _ => CancelAndAnswer(connection);

        //Act
        var outcome = await connection.ExecuteAsync(WriteReturningRows, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, outcome.Error.Kind);
        Assert.StartsWith("O cancelamento chegou enquanto o comando devolvia as linhas. O que ele gravou até ali está confirmado", outcome.Error.Message);
        Assert.Equal(ECancelOutcome.Partial, outcome.Error.Outcome);
        Assert.Equal(1, _transactionProbes);
    }

    /// <summary>
    /// A sonda de transação e a limpeza rodam depois do comando, e nunca leem a marca de cancelamento dele. Com a marca de pé e
    /// nenhuma transação aberta, a sonda responde o que o banco disse: o comando utilitário confirmado é sucesso, sem `ROLLBACK`
    /// (que é o que a base mandaria se lesse a sonda como falha) e sem recusa.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "OK cancelamento tardio não faz a sonda de transação responder falha nem recusa")]
    public async Task Execute_ShouldTrustTheTransactionProbe_WhenACancellationArrivedLate()
    {
        //Arrange
        var sink = new CollectingSink();
        var connection = await OpenWithoutTransactionsAsync(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());
        _commandFailure = _ => CancelAndAnswer(connection);

        //Act
        var outcome = await connection.ExecuteAsync(UtilityCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(1, _transactionProbes);
        Assert.Equal([UtilityCommand], _sent);
        Assert.True(connection.IsOpen);
        Assert.Empty(sink.Events);
    }

    /// <summary>
    /// No outro sentido: com a marca de cancelamento de pé, a transação que a sonda acha continua sendo desfeita e recusada, e a
    /// limpeza (`ROLLBACK`) vale: a conexão segue aberta e limpa.
    /// </summary>
    [Trait("AdoDatabaseConnection", "Cancel")]
    [Fact(DisplayName = "Erro cancelamento tardio não esconde a transação aberta nem estraga a limpeza dela")]
    public async Task Execute_ShouldStillRollBackAStrayTransaction_WhenACancellationArrivedLate()
    {
        //Arrange
        _insideTransaction = true;
        var connection = await OpenWithoutTransactionsAsync();
        _commandFailure = _ => CancelAndAnswer(connection);

        //Act
        var outcome = await connection.ExecuteAsync(UtilityCommand, CancellationToken.None);
        _commandFailure = _ => null;
        _insideTransaction = false;
        var afterwards = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.TransactionControlNotSupported, outcome.Error.Kind);
        Assert.True(outcome.Error.Executed);
        Assert.True(afterwards.IsSuccess);
        Assert.Equal([UtilityCommand, "ROLLBACK", CountedCommand], _sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>
    /// O driver que executa os comandos de um envio um por um só roda o seguinte quando o leitor avança, e um `CALL` devolve mais de
    /// um conjunto: o comando executado até o fim lê todos os resultados antes de responder, e o que o banco recusa num deles é a
    /// falha do comando.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK comando executado até o fim lê todos os conjuntos de resultados antes de responder")]
    public async Task Execute_ShouldReadEveryResultSet_BeforeAnswering()
    {
        //Arrange
        var remaining = 2;
        var advances = 0;
        _endOfResult = () =>
        {
            advances++;

            return Task.FromResult(remaining-- > 0);
        };
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(WriteReturningRows, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(250, outcome.Value.Page!.TotalRows);
        Assert.Equal(3, advances);
    }

    /// <summary>
    /// O driver síncrono (os da IBM) só devolve a chamada quando o banco responde. A conexão a roda em outra thread: quem chamou
    /// recebe a tarefa em andamento, e o cancelamento, que não espera o banco, chega ao comando enquanto ele ainda está lá.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK driver síncrono não prende quem chama, e o cancelamento chega com o comando em andamento")]
    public async Task Execute_ShouldNotBlockTheCaller_WhenTheDriverIsSynchronous()
    {
        //Arrange
        using var sent = new ManualResetEventSlim();
        using var answered = new ManualResetEventSlim();
        var canceledWhileRunning = false;
        _commandFailure = _ =>
        {
            // O banco de mentira só responde quando o teste deixa; os limites são para um defeito virar reprovação, e não um teste pendurado.
            sent.Set();
            canceledWhileRunning = answered.Wait(TimeSpan.FromSeconds(10));

            return null;
        };
        var connection = await OpenWithoutTransactionsAsync();

        //Act
        var running = connection.ExecuteAsync(CountedCommand, CancellationToken.None);
        var returnedBeforeTheAnswer = !running.IsCompleted;
        var reachedTheDatabase = sent.Wait(TimeSpan.FromSeconds(10));
        connection.Cancel();
        answered.Set();
        var outcome = await running;

        //Assert
        Assert.True(returnedBeforeTheAnswer);
        Assert.True(reachedTheDatabase);
        Assert.True(canceledWhileRunning);
        Assert.True(outcome.IsSuccess);
    }

    /// <summary>
    /// RN-SQL-001, no banco cujo driver executaria um por um os comandos de um envio (os da IBM): o envio com mais de um comando é
    /// recusado sem ir ao banco. Um erro no meio deixaria gravado o que veio antes, e um `BEGIN WORK` depois do primeiro comando
    /// deixaria a conexão dentro de uma transação.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "Erro envio com mais de um comando é recusado sem ir ao banco, no banco cujo driver os executaria um por um")]
    public async Task Execute_ShouldRefuseSeveralStatements_WithoutReachingTheDatabase()
    {
        //Arrange
        var connection = await OpenWithoutTransactionsAsync();

        //Act
        var outcome = await connection.ExecuteAsync($"{CountedCommand}; BEGIN WORK", CancellationToken.None);
        var afterwards = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.MultipleStatementsNotSupported, outcome.Error.Kind);
        Assert.StartsWith("Cada execução leva um comando só", outcome.Error.Message);
        Assert.True(afterwards.IsSuccess);
        Assert.Equal([CountedCommand], _sent);
        Assert.Equal(0, _transactionProbes);
    }

    /// <summary>No banco que recusa ele mesmo o envio com mais de um comando (o PostgreSQL), a base não confere nada: o texto vai como veio.</summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK envio com mais de um comando vai ao banco que o recusa ele mesmo")]
    public async Task Execute_ShouldSendSeveralStatements_WhenTheDatabaseRefusesThemItself()
    {
        //Arrange
        var several = $"{CountedCommand}; {CountedCommand}";
        var connection = await OpenAsync();

        //Act
        var outcome = await connection.ExecuteAsync(several, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal([several], _sent);
    }

    /// <summary>
    /// RN-SQL-006, no banco sem transação só de leitura: o "contar total" executa o comando de novo, como subconsulta, e ali o que
    /// impede a contagem de gravar é o texto. O que não é uma leitura só não vai ao banco.
    /// </summary>
    [Trait("AdoDatabaseConnection", "CountAsync")]
    [Fact(DisplayName = "Erro contar o que não é uma leitura só não vai ao banco, no banco sem transação só de leitura")]
    public async Task Count_ShouldRefuseWhatIsNotASingleRead_WhenTheEngineHasNoReadOnlyTransaction()
    {
        //Arrange
        var connection = await OpenWithoutTransactionsAsync();

        //Act
        var total = await connection.CountAsync($"{ReadQuery}; {CountedCommand}", CancellationToken.None);

        //Assert
        Assert.True(total.IsFailure);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, total.Error.Kind);
        Assert.StartsWith("Só uma leitura pode ser contada", total.Error.Message);
        Assert.Empty(_sent);
    }

    /// <summary>
    /// A sessão que fecha com um comando que não para desiste de esperar e descarta a conexão com ele ainda em andamento. Num driver
    /// como o Npgsql esse descarte só volta quando o comando termina e a conexão segue o caminho dela até o fim, e a conferência de
    /// transação depois de um comando utilitário é parte desse caminho. A conexão não pode se dar por descartada antes de o driver
    /// descartar: o comando pularia a conferência (ela pergunta se a conexão está aberta), e o descarte nunca voltaria. O driver de
    /// mentira só conclui o descarte quando a conferência chega a ele.
    /// </summary>
    [Trait("AdoDatabaseConnection", "DisposeAsync")]
    [Fact(DisplayName = "OK descarte com comando em andamento volta quando o comando segue até a conferência de transação")]
    public async Task Dispose_ShouldReturn_WhenTheRunningCommandGoesOnToTheTransactionProbe()
    {
        //Arrange
        using var sent = new ManualResetEventSlim();
        using var answered = new ManualResetEventSlim();
        var probed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _probeBegin = () =>
        {
            probed.TrySetResult();

            return null;
        };
        _driver.Setup(driver => driver.DisposeAsync()).Returns(() => new ValueTask(probed.Task.ContinueWith(_ => _state = ConnectionState.Closed, TaskScheduler.Default)));
        _commandFailure = _ =>
        {
            // O banco de mentira só responde quando o teste deixa; o limite é para um defeito virar reprovação, e não um teste pendurado.
            sent.Set();
            answered.Wait(TimeSpan.FromSeconds(10));

            return null;
        };
        var connection = await OpenAsync();

        //Act
        var running = Task.Run(() => connection.ExecuteAsync(UtilityCommand, CancellationToken.None));
        var reachedTheDatabase = sent.Wait(TimeSpan.FromSeconds(10));
        var disposing = connection.DisposeAsync().AsTask();
        answered.Set();
        var disposed = await Task.WhenAny(disposing, Task.Delay(TimeSpan.FromSeconds(5))) == disposing;
        var outcome = await running;

        //Assert
        Assert.True(reachedTheDatabase);
        Assert.True(disposed);
        Assert.True(outcome.IsSuccess);
        Assert.Equal(1, _transactionProbes);
        Assert.False(connection.IsOpen);
    }

    /// <summary>
    /// O que o driver de um banco não aceita nos dados da conexão é recusado antes de ele ser chamado: a resposta é a de uma conexão
    /// que não abre, com o motivo; o driver nem recebe o pedido, e nada vai para o log (é dado de entrada de quem cadastrou a
    /// conexão, e não um defeito).
    /// </summary>
    [Trait("AdoDatabaseConnection", "OpenAsync")]
    [Fact(DisplayName = "Erro dado de conexão que o driver não aceita é recusado antes de chamá-lo, sem nada no log")]
    public async Task Open_ShouldRefuseTheSettings_BeforeCallingTheDriver()
    {
        //Arrange
        var sink = new CollectingSink();
        var connection = new RefusingEngineConnection(_driver.Object, new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());

        //Act
        var opened = await connection.OpenAsync(CancellationToken.None);

        //Assert
        Assert.True(opened.IsFailure);
        Assert.Equal(EDatabaseFailure.ConnectionFailed, opened.Error.Kind);
        Assert.Equal("O driver não aceita `;` na senha.", opened.Error.Message);
        _driver.Verify(driver => driver.OpenAsync(It.IsAny<CancellationToken>()), Times.Never);
        Assert.Empty(sink.Events);
    }

    /// <summary>
    /// O driver da IBM entrega embrulhado numa exceção de conjunto o erro que o banco devolve durante a leitura das linhas. Por dentro
    /// é a recusa do banco: a resposta é a mensagem dela, e não o texto do .NET para o embrulho, e o log a registra como recusa, sem
    /// pilha e sem a mensagem (RN-LOG-001).
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "Erro recusa do banco que o driver entrega embrulhada responde a mensagem do banco, e não vai para o log como defeito")]
    public async Task Execute_ShouldUnwrapADatabaseRefusal_WhenTheDriverWrapsIt()
    {
        //Arrange
        var sink = new CollectingSink();
        var connection = await OpenAsync(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());
        _commandFailure = _ => new AggregateException(new FakeDatabaseException("recusa do banco"));

        //Act
        var outcome = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal("recusa do banco", outcome.Error.Message);
        var logged = Assert.Single(sink.Events);
        Assert.Equal(LogEventLevel.Information, logged.Level);
        Assert.DoesNotContain("recusa do banco", logged.RenderMessage());
        Assert.DoesNotContain("AggregateException", logged.RenderMessage());
    }

    /// <summary>
    /// RN-SQL-011: o driver síncrono (os da IBM) escreve datas e números com a cultura da thread em que é chamado. A conexão o chama
    /// com a cultura invariável, seja qual for a de quem pediu o comando, e a de quem pediu continua a mesma depois.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK driver síncrono é chamado com a cultura invariável, e a de quem chama não muda")]
    public async Task Execute_ShouldCallTheSynchronousDriverWithTheInvariantCulture()
    {
        //Arrange
        var callerCulture = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = new CultureInfo("ar-SA");
        string? seenByTheDriver = null;
        _commandFailure = _ =>
        {
            seenByTheDriver = CultureInfo.CurrentCulture.Name;

            return null;
        };
        var connection = await OpenWithoutTransactionsAsync();

        //Act
        var outcome = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);
        var afterwards = CultureInfo.CurrentCulture.Name;
        CultureInfo.CurrentCulture = callerCulture;

        //Assert
        Assert.True(outcome.IsSuccess);
        Assert.Equal(string.Empty, seenByTheDriver);
        Assert.Equal("ar-SA", afterwards);
    }

    /// <summary>
    /// RN-SESSAO-005, no banco em que o comando que falha pode deixar uma transação aberta (o Informix: a função que a abre por
    /// dentro, grava, devolve linhas e lança). A conferência roda também depois da falha: a transação é desfeita, o comando seguinte
    /// encontra a sessão limpa, e a resposta continua sendo a falha do comando, com a mensagem do banco, e não uma recusa.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "Erro transação deixada pelo comando que falhou é desfeita, e a resposta continua sendo a falha dele")]
    public async Task Execute_ShouldRollBackTheTransactionAFailedCommandLeftOpen_AndKeepItsFailure()
    {
        //Arrange
        var sink = new CollectingSink();
        _probesEveryCommand = true;
        _insideTransaction = true;
        _endOfResult = () => Task.FromException<bool>(new FakeDatabaseException("falha de propósito"));
        var connection = await OpenWithoutTransactionsAsync(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());

        //Act
        var outcome = await connection.ExecuteAsync(WriteReturningRows, CancellationToken.None);
        _insideTransaction = false;
        _endOfResult = () => Task.FromResult(false);
        var afterwards = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, outcome.Error.Kind);
        Assert.Equal("falha de propósito", outcome.Error.Message);
        Assert.True(afterwards.IsSuccess);
        Assert.Equal([WriteReturningRows, "ROLLBACK", CountedCommand], _sent);
        Assert.Equal(2, _transactionProbes);
        Assert.True(connection.IsOpen);
        Assert.Equal("Um comando que falhou ou foi cancelado deixou uma transação aberta na conexão: ela foi desfeita.", Assert.Single(sink.Events, logged => logged.Level == LogEventLevel.Warning).RenderMessage());
    }

    /// <summary>A falha que vem antes de o banco devolver qualquer coisa (um erro de sintaxe) também é conferida ali, e sem transação aberta nada é desfeito nem vai para o log como aviso.</summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK comando que falhou sem deixar transação responde a falha dele, com uma sonda e sem ROLLBACK")]
    public async Task Execute_ShouldProbeAfterAFailure_AndRollBackNothing_WhenNoTransactionWasLeft()
    {
        //Arrange
        var sink = new CollectingSink();
        _probesEveryCommand = true;
        _commandFailure = _ => new FakeDatabaseException("erro de sintaxe");
        var connection = await OpenWithoutTransactionsAsync(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());

        //Act
        var outcome = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.True(outcome.IsFailure);
        Assert.Equal("erro de sintaxe", outcome.Error.Message);
        Assert.Equal([CountedCommand], _sent);
        Assert.Equal(1, _transactionProbes);
        Assert.DoesNotContain(sink.Events, logged => logged.Level == LogEventLevel.Warning);
    }

    /// <summary>
    /// No banco que desfaz o comando que falha (o PostgreSQL e o Db2), nada muda: depois de uma falha a base não pergunta nada ao
    /// banco, mesmo com o comando tendo chegado a devolver linhas.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK comando que falhou não dispara a sonda de transação no banco que desfaz o comando que falha")]
    public async Task Execute_ShouldNotProbeAfterAFailure_WhenTheDatabaseUndoesAFailedCommand()
    {
        //Arrange
        _insideTransaction = true;
        _endOfResult = () => Task.FromException<bool>(new FakeDatabaseException("falha de propósito"));
        var connection = await OpenAsync();
        var silent = await OpenWithoutTransactionsAsync();

        //Act
        var outcome = await connection.ExecuteAsync(WriteReturningRows, CancellationToken.None);
        var outcomeOfTheSilentDriver = await silent.ExecuteAsync(WriteReturningRows, CancellationToken.None);

        //Assert
        Assert.Equal("falha de propósito", outcome.Error.Message);
        Assert.Equal("falha de propósito", outcomeOfTheSilentDriver.Error.Message);
        Assert.Equal([WriteReturningRows, WriteReturningRows], _sent);
        Assert.Equal(0, _transactionProbes);
    }

    /// <summary>
    /// RN-LOG-001: a recusa do banco que é a resposta de rotina de um gancho (no Informix, o "não há transação" do banco sem log,
    /// que a sonda de transação recebe depois de cada comando) não enche o log: sai como depuração, abaixo do nível com que o
    /// Prism roda. Qualquer outra recusa do banco continua saindo como informação, e a do comando do usuário também, mesmo com o
    /// mesmo erro.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK recusa do banco que é a resposta de rotina de um gancho sai no log como depuração, e as outras como informação")]
    public async Task Execute_ShouldLogTheRoutineRefusalOfAHookBelowInformation()
    {
        //Arrange
        var sink = new CollectingSink();
        var logger = new LoggerConfiguration().MinimumLevel.Verbose().WriteTo.Sink(sink).CreateLogger();
        _probeBegin = () => new FakeDatabaseException("Transaction not available.");
        var routine = (await new RoutineRefusalEngineConnection(_driver.Object, BeginProbe, logger).OpenAsync(CancellationToken.None)).Value;
        var other = await OpenAsync(logger);

        //Act
        await routine.ExecuteAsync(UtilityCommand, CancellationToken.None);
        var ofTheRoutine = sink.Events.Where(logged => logged.MessageTemplate.Text.StartsWith("O banco recusou", StringComparison.Ordinal)).Select(logged => logged.Level).ToArray();
        sink.Events.Clear();
        await other.ExecuteAsync(UtilityCommand, CancellationToken.None);
        var ofTheOther = sink.Events.Where(logged => logged.MessageTemplate.Text.StartsWith("O banco recusou", StringComparison.Ordinal)).Select(logged => logged.Level).ToArray();
        sink.Events.Clear();
        _commandFailure = _ => new FakeDatabaseException("Transaction not available.");
        await routine.ExecuteAsync(CountedCommand, CancellationToken.None);
        var ofTheUserCommand = sink.Events.Where(logged => logged.MessageTemplate.Text.StartsWith("O banco recusou", StringComparison.Ordinal)).Select(logged => logged.Level).ToArray();

        //Assert
        Assert.Equal([LogEventLevel.Debug], ofTheRoutine);
        Assert.Equal([LogEventLevel.Information], ofTheOther);
        Assert.Equal([LogEventLevel.Information], ofTheUserCommand);
    }

    private async Task<IDatabaseConnection> OpenWithoutTransactionsAsync(ILogger? logger = null)
        => (await new SilentCancelEngineConnection(_driver.Object, BeginProbe, () => _probeRoundTrip(), () => _probesEveryCommand, logger ?? Logger.None).OpenAsync(CancellationToken.None)).Value;

    /// <summary>O cancelamento chega com o comando no banco, e o driver de mentira responde assim mesmo, sem lançar: como o da IBM quando o comando já tinha terminado.</summary>
    private static Exception? CancelAndAnswer(IDatabaseConnection connection)
    {
        connection.Cancel();

        return null;
    }

    /// <summary>O cancelamento chega com o comando no banco, e o banco de mentira o interrompe, como o PostgreSQL e o Db2: 57014.</summary>
    private static Exception CancelAndInterrupt(IDatabaseConnection connection)
    {
        connection.Cancel();

        return new FakeDatabaseException("canceling statement due to user request", "57014");
    }

    /// <summary>Uma recusa do banco ou da rede, como as do driver de verdade: uma `DbException`, que a base registra sem pilha.</summary>
    /// <summary>RN-CAT-001: o padrão e a geração que o catálogo não tem chegam nulos, e não como texto vazio; os que ele tem chegam como vieram.</summary>
    [Trait("AdoDatabaseConnection", "GetColumnsAsync")]
    [Fact(DisplayName = "OK a coluna sem padrão nem geração tem os dois nulos")]
    public async Task GetColumns_ShouldKeepTheMissingDefaultAndGenerationNull()
    {
        //Arrange
        _catalog["COLUMNS"] = [["id", "integer", false, true, 1, null, "always"], ["nome", "text", true, false, 2, "'sem nome'::text", null], ["obs", "text", true, false, 3, null, null]];
        var connection = await OpenAsync();

        //Act
        var columns = await connection.GetColumnsAsync("loja", "pedido", CancellationToken.None);

        //Assert
        Assert.True(columns.IsSuccess, columns.IsFailure ? columns.Error.Message : null);
        Assert.Equal([new ColumnInfo("id", "integer", false, true, 1, null, "always"), new ColumnInfo("nome", "text", true, false, 2, "'sem nome'::text", null), new ColumnInfo("obs", "text", true, false, 3, null, null)], columns.Value);
    }

    /// <summary>RN-CAT-002 e 003: as colunas de cada chave e de cada índice se juntam na ordem em que chegaram, com as regras e o método da primeira linha.</summary>
    [Trait("AdoDatabaseConnection", "GetForeignKeysAsync")]
    [Fact(DisplayName = "OK as linhas de uma chave composta viram uma chave, com as duas regras")]
    public async Task GetForeignKeys_ShouldJoinTheColumnsOfEachKey_WithItsRules()
    {
        //Arrange
        _catalog["FOREIGN KEYS"] = [["fk_composta", "loja", "item", "pedido_id", "loja", "pedido", "id", "cascade", "noAction"], ["fk_composta", "loja", "item", "pedido_numero", "loja", "pedido", "numero", "cascade", "noAction"], ["fk_produto", "loja", "item", "produto_id", "estoque", "produto", "id", null, null]];
        _catalog["INDEXES"] = [["ix_item", false, "pedido_id", "btree"], ["ix_item", false, "produto_id", "btree"], ["ux_item", true, "id", null]];
        var connection = await OpenAsync();

        //Act
        var foreignKeys = await connection.GetForeignKeysAsync("loja", "item", CancellationToken.None);
        var indexes = await connection.GetIndexesAsync("loja", "item", CancellationToken.None);

        //Assert
        Assert.Equal([("fk_composta", "pedido_id,pedido_numero", "loja", "pedido", "id,numero", "cascade", "noAction"), ("fk_produto", "produto_id", "estoque", "produto", "id", null, null)], foreignKeys.Value.Select(key => (key.Name, string.Join(",", key.Columns), key.ReferencedSchema, key.ReferencedTable, string.Join(",", key.ReferencedColumns), key.OnDelete, key.OnUpdate)));
        Assert.Equal([("ix_item", "pedido_id,produto_id", false, "btree"), ("ux_item", "id", true, null)], indexes.Value.Select(index => (index.Name, string.Join(",", index.Columns), index.IsUnique, index.Method)));
    }

    /// <summary>RN-CAT-009 e 010: a estimativa e o comentário que faltam chegam nulos; as contagens de cada esquema vêm da consulta.</summary>
    [Trait("AdoDatabaseConnection", "GetObjectsAsync")]
    [Fact(DisplayName = "OK a estimativa e o comentário que faltam chegam nulos, e o esquema traz as contagens")]
    public async Task GetObjects_ShouldKeepTheMissingEstimateAndCommentNull_AndSchemasBringTheCounts()
    {
        //Arrange
        _catalog["TABLES"] = [["pedido", "table", 1000L, "Os pedidos"], ["rascunho", "table", null, null]];
        _catalog["SCHEMAS"] = [["loja", false, 2, 1, 3], ["pg_catalog", true, 64, 72, 3000]];
        var connection = await OpenAsync();

        //Act
        var tables = await connection.GetObjectsAsync("loja", "tables", CancellationToken.None);
        var schemas = await connection.GetSchemasAsync(CancellationToken.None);

        //Assert
        Assert.Equal([new DatabaseObjectInfo("pedido", "table", 1000, "Os pedidos"), new DatabaseObjectInfo("rascunho", "table", null, null)], tables.Value);
        Assert.Equal([new SchemaInfo("loja", false, 2, 1, 3), new SchemaInfo("pg_catalog", true, 64, 72, 3000)], schemas.Value);
    }

    /// <summary>
    /// RN-CAT-004: duas tabelas podem ter chaves de mesmo nome apontando para esta. Cada chave é o nome dentro da tabela que a tem, e
    /// as colunas da chave composta se juntam na ordem.
    /// </summary>
    [Trait("AdoDatabaseConnection", "GetReferencingForeignKeysAsync")]
    [Fact(DisplayName = "OK chaves de mesmo nome de tabelas diferentes são chaves diferentes")]
    public async Task GetReferencingForeignKeys_ShouldKeepSameNamedKeysOfDifferentTablesApart()
    {
        //Arrange
        _catalog["REFERENCED BY"] = [["fk_cliente", "loja", "pedido", "cliente_id", "loja", "cliente", "id", "cascade", "noAction"], ["fk_cliente", "vendas", "nota", "cliente_id", "loja", "cliente", "id", "restrict", "restrict"], ["fk_cliente", "vendas", "nota", "cliente_codigo", "loja", "cliente", "codigo", "restrict", "restrict"]];
        var connection = await OpenAsync();

        //Act
        var keys = await connection.GetReferencingForeignKeysAsync("loja", "cliente", CancellationToken.None);

        //Assert
        Assert.Equal([("fk_cliente", "loja", "pedido", "cliente_id", "id", "cascade", "noAction"), ("fk_cliente", "vendas", "nota", "cliente_id,cliente_codigo", "id,codigo", "restrict", "restrict")], keys.Value.Select(key => (key.Name, key.ReferencingSchema, key.ReferencingTable, string.Join(",", key.Columns), string.Join(",", key.ReferencedColumns), key.OnDelete, key.OnUpdate)));
        Assert.Equal(["REFERENCED BY"], _sent);
    }

    /// <summary>RN-CAT-005 e 006: o texto que o catálogo guarda em pedaços volta inteiro, na ordem; a visão sem texto é nula, e não vazia.</summary>
    [Trait("AdoDatabaseConnection", "GetChecksAsync")]
    [Fact(DisplayName = "OK os pedaços da condição e da visão voltam juntos, e a visão que não existe é nula")]
    public async Task GetChecksAndViewDefinition_ShouldJoinTheChunks_AndAMissingViewIsNull()
    {
        //Arrange
        _catalog["CHECKS"] = [["ck_a", "(valor > "], ["ck_a", "0 )"], ["ck_b", "(quantidade < 10 )"]];
        _catalog["VIEW DEFINITION"] = [["create view v as "], ["select 1 "], ["from t ;"]];
        var connection = await OpenAsync();

        //Act
        var checks = await connection.GetChecksAsync("loja", "pedido", CancellationToken.None);
        var view = await connection.GetViewDefinitionAsync("loja", "v", CancellationToken.None);
        _catalog["VIEW DEFINITION"] = [];
        var missing = await connection.GetViewDefinitionAsync("loja", "nao_existe", CancellationToken.None);

        //Assert
        Assert.Equal([new CheckConstraintInfo("ck_a", "(valor > 0 )"), new CheckConstraintInfo("ck_b", "(quantidade < 10 )")], checks.Value);
        Assert.Equal(new ViewDefinitionInfo("create view v as select 1 from t ;"), view.Value);
        Assert.Equal(new ViewDefinitionInfo(null), missing.Value);
    }

    /// <summary>
    /// RN-CAT-008: o diagrama sai de duas consultas, e não de uma por tabela. As colunas se juntam por tabela (a tabela sem coluna fica,
    /// com a lista vazia), e as chaves por nome e tabela que as tem, com o que referenciam, que pode ser de outro esquema.
    /// </summary>
    [Trait("AdoDatabaseConnection", "GetDiagramAsync")]
    [Fact(DisplayName = "OK o diagrama sai de duas consultas, com as colunas por tabela e as chaves por nome e tabela")]
    public async Task GetDiagram_ShouldComeFromTwoQueries()
    {
        //Arrange
        _catalog["DIAGRAM COLUMNS"] = [["cliente", "id", "integer", false, true], ["cliente", "nome", "text", true, false], ["sem_colunas", null, null, null, null], ["pedido", "id", "integer", false, true], ["pedido", "cliente_id", "integer", false, false]];
        _catalog["DIAGRAM FOREIGN KEYS"] = [["fk_cliente", "loja", "pedido", "cliente_id", "loja", "cliente", "id", "noAction", "noAction"], ["fk_regiao", "loja", "cliente", "regiao_id", "geral", "regiao", "id", null, null]];
        var connection = await OpenAsync();

        //Act
        var diagram = await connection.GetDiagramAsync("loja", CancellationToken.None);

        //Assert
        Assert.True(diagram.IsSuccess, diagram.IsFailure ? diagram.Error.Message : null);
        Assert.Equal(["cliente", "sem_colunas", "pedido"], diagram.Value.Tables.Select(table => table.Name));
        Assert.Equal([new DiagramColumnInfo("id", "integer", false, true), new DiagramColumnInfo("nome", "text", true, false)], diagram.Value.Tables[0].Columns);
        Assert.Empty(diagram.Value.Tables[1].Columns);
        Assert.Equal([("fk_cliente", "pedido", "cliente_id", "loja", "cliente", "id", "noAction"), ("fk_regiao", "cliente", "regiao_id", "geral", "regiao", "id", null)], diagram.Value.ForeignKeys.Select(key => (key.Name, key.ReferencingTable, string.Join(",", key.Columns), key.ReferencedSchema, key.ReferencedTable, string.Join(",", key.ReferencedColumns), key.OnDelete)));
        Assert.Equal(["DIAGRAM COLUMNS", "DIAGRAM FOREIGN KEYS"], _sent);
    }

    /// <summary>
    /// RN-CAT-010: o que o banco não informa a esta conta não vem. O valor nulo fica de fora, e a consulta que o banco recusa com a
    /// conexão viva também: as outras vêm, na ordem.
    /// </summary>
    [Trait("AdoDatabaseConnection", "GetPropertiesAsync")]
    [Fact(DisplayName = "OK a propriedade que o banco recusa ou não informa não vem, e as outras vêm")]
    public async Task GetProperties_ShouldLeaveOutWhatTheDatabaseRefusesOrDoesNotInform()
    {
        //Arrange
        _catalog["PROPERTIES A"] = [["encoding", "UTF8"], ["sizeBytes", null]];
        _catalog["PROPERTIES C"] = [["owner", "prism"]];
        _commandFailure = sql => sql == "PROPERTIES B" ? new FakeDatabaseException("permission denied for view dbcfg") : null;
        var connection = await OpenAsync();

        //Act
        var properties = await connection.GetPropertiesAsync(CancellationToken.None);

        //Assert
        Assert.True(properties.IsSuccess, properties.IsFailure ? properties.Error.Message : null);
        Assert.Equal([new DatabasePropertyInfo("encoding", "UTF8"), new DatabasePropertyInfo("owner", "prism")], properties.Value);
        Assert.Equal(["PROPERTIES A", "PROPERTIES B", "PROPERTIES C"], _sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>RN-CAT-010: se a recusa veio com a conexão caída, a resposta é ela, e não uma lista pela metade.</summary>
    [Trait("AdoDatabaseConnection", "GetPropertiesAsync")]
    [Fact(DisplayName = "Erro a conexão que cai durante as propriedades é a resposta")]
    public async Task GetProperties_ShouldFail_WhenTheConnectionDrops()
    {
        //Arrange
        _catalog["PROPERTIES A"] = [["encoding", "UTF8"]];
        _commandFailure = sql =>
        {
            if (sql != "PROPERTIES B")
                return null;

            _state = ConnectionState.Closed;

            return new FakeDatabaseException("the connection was closed");
        };
        var connection = await OpenAsync();

        //Act
        var properties = await connection.GetPropertiesAsync(CancellationToken.None);

        //Assert
        Assert.True(properties.IsFailure);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, properties.Error.Kind);
        Assert.Equal("the connection was closed", properties.Error.Message);
        Assert.Equal(["PROPERTIES A", "PROPERTIES B"], _sent);
    }

    /// <summary>A recusa de um banco de mentira, com o SQLSTATE quando o teste o dá.</summary>
    private sealed class FakeDatabaseException(string message, string? sqlState = null) : DbException(message)
    {
        public override string? SqlState => sqlState;
    }

    private sealed class CollectingSink : ILogEventSink
    {
        public List<LogEvent> Events { get; } = [];

        public void Emit(LogEvent logEvent)
            => Events.Add(logEvent);
    }

    /// <summary>O mínimo de um banco: o que importa aqui é a base.</summary>
    private class FakeEngineConnection(DbConnection driver, Func<Exception?> beginProbe, Func<Exception?> probeRoundTrip, ILogger logger) : AdoDatabaseConnection(logger)
    {
        /// <summary>
        /// Como o driver do PostgreSQL: quem responde que há transação aberta é uma exceção do driver, que não é erro de banco, no pedido
        /// de transação, que não envia nada. O que falha depois dele é a ida e volta da própria sonda.
        /// </summary>
        protected override async Task<ETransactionProbe> ProbeTransactionAsync(DbConnection connection)
        {
            var began = false;
            var passed = await TryAsync(nameof(ProbeTransactionAsync), () =>
            {
                if (beginProbe() is { } refusal)
                    return Task.FromException(refusal);

                began = true;

                return probeRoundTrip() is { } failure ? Task.FromException(failure) : Task.CompletedTask;
            });

            if (passed)
                return ETransactionProbe.Idle;

            return began ? ETransactionProbe.Failed : ETransactionProbe.InTransaction;
        }

        protected override string PingSql => "PING";

        protected override string SchemasSql => "SCHEMAS";

        protected override string ColumnsSql => "COLUMNS";

        protected override string IndexesSql => "INDEXES";

        protected override string ForeignKeysSql => "FOREIGN KEYS";

        protected override string ReferencedBySql => "REFERENCED BY";

        protected override string ChecksSql => "CHECKS";

        protected override string ViewDefinitionSql => "VIEW DEFINITION";

        protected override string DiagramColumnsSql => "DIAGRAM COLUMNS";

        protected override string DiagramForeignKeysSql => "DIAGRAM FOREIGN KEYS";

        protected override IReadOnlyList<string> PropertiesSql => ["PROPERTIES A", "PROPERTIES B", "PROPERTIES C"];

        protected override string DatabasesSql => "DATABASES";

        protected override string EditKeysSql => "EDIT KEYS";

        protected override string LockTimeoutSql => "LOCK TIMEOUT";

        protected override (string Sql, IReadOnlyList<object> Parameters) EditRelationQuery(EditTableName table)
            => ("EDIT RELATION", [table.Name]);

        protected override string? BeginReadOnlySql => "BEGIN READ ONLY";

        protected override DbConnection CreateConnection()
            => driver;

        protected override string? ObjectsSql(string kind)
            => kind == "tables" ? "TABLES" : null;

        protected override string CountSql(string sql)
            => sql;

        protected override DatabaseFailure ToFailure(EDatabaseFailure kind, Exception exception)
            => new(kind, exception.Message, (exception as DbException)?.SqlState);

        protected override bool IsWriteRefusal(DatabaseFailure failure)
            => false;
    }

    /// <summary>
    /// Um banco como os da IBM: sem transação só de leitura (quem diz que o comando é leitura é o texto), com o driver síncrono, que
    /// não lança quando o cancelamento chega durante a leitura.
    /// </summary>
    private sealed class SilentCancelEngineConnection(DbConnection driver, Func<Exception?> beginProbe, Func<Exception?> probeRoundTrip, Func<bool> probesEveryCommand, ILogger logger) : FakeEngineConnection(driver, beginProbe, probeRoundTrip, logger)
    {
        protected override string? BeginReadOnlySql => null;

        protected override bool CancelReturnsEmptyResult => true;

        protected override bool BlocksTheCallingThread => true;

        protected override bool TriesAsRead(string sql)
            => sql == ReadQuery;

        protected override bool HasSeveralStatements(string sql)
            => sql.Contains("; ", StringComparison.Ordinal);

        protected override bool MayBeCounted(string sql)
            => sql == ReadQuery;

        protected override bool MayHaveOpenedATransaction(bool returnedRows, int recordsAffected)
            => probesEveryCommand() || base.MayHaveOpenedATransaction(returnedRows, recordsAffected);

        protected override bool MayLeaveATransactionOpenWhenItFails => probesEveryCommand();
    }

    /// <summary>Um banco cujo driver não aceita o que veio nos dados da conexão, como o da IBM com um `;` na senha.</summary>
    private sealed class RefusingEngineConnection(DbConnection driver, ILogger logger) : FakeEngineConnection(driver, () => null, () => null, logger)
    {
        protected override string? SettingsRefusal => "O driver não aceita `;` na senha.";
    }

    /// <summary>Um banco cuja sonda de transação recebe do banco, a cada comando, uma recusa que é resposta de rotina: como o Informix num banco sem log.</summary>
    private sealed class RoutineRefusalEngineConnection(DbConnection driver, Func<Exception?> beginProbe, ILogger logger) : FakeEngineConnection(driver, beginProbe, () => null, logger)
    {
        protected override bool IsRoutineRefusal => true;
    }
}
