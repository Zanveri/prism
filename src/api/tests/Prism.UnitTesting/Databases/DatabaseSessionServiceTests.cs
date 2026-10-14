using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Moq;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Extensions;
using Serilog.Core;
using System.Runtime.InteropServices;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// O que o registro de sessões faz quando a conexão não responde, com uma conexão de mentira no lugar do driver: o comando que nunca
/// volta (rede morta) e o temporizador que dispara fora de hora. O comportamento com o banco de verdade é do fixture de integração
/// de mesmo nome.
/// </summary>
public sealed class DatabaseSessionServiceTests
{
    private static readonly ConnectionSettings Settings = new(EDatabaseEngine.PostgreSql, "banco.local", 5432, "producao", "operador", "senha-de-teste");

    private readonly Mock<IVaultService> _vault = new();
    private readonly ManualTimers _clock = new();
    private readonly FakeConnection _connection = new();

    private DatabaseSessionService CreateService()
        => new([new FakeClient(_connection)], _vault.Object, _clock, Logger.None);

    private static async Task<DatabaseSessionInfo> OpenAsync(DatabaseSessionService service)
        => (await service.OpenAsync(Guid.NewGuid(), Settings, 0, CancellationToken.None)).Value;

    /// <summary>
    /// Rede morta: o comando não volta e o cancelamento não chega ao banco. Fechar a sessão espera a vez por dez segundos e então
    /// descarta a conexão assim mesmo: "Sair" e o encerramento do app não ficam presos a um banco que não responde.
    /// </summary>
    [Trait("DatabaseSessionService", "CloseAsync")]
    [Fact(DisplayName = "OK fechar sessão com comando que nunca volta abandona a conexão depois de dez segundos")]
    public async Task Close_ShouldAbandonTheConnection_WhenTheCommandNeverReturns()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        var running = service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);

        //Act
        var closing = service.CloseAsync(session.ID);
        _clock.Advance(TimeSpan.FromSeconds(9));
        await Task.WhenAny(closing, Task.Delay(TimeSpan.FromMilliseconds(700)));
        var stillWaitingAtNineSeconds = !closing.IsCompleted;
        var disposedAtNineSeconds = _connection.Disposed;
        _clock.Advance(TimeSpan.FromSeconds(1));
        var closed = await closing.WaitAsync(TimeSpan.FromSeconds(5));

        // O descarte da conexão abandonada não é esperado por quem fecha (num driver de verdade ele só termina quando o comando volta).
        var disposed = SpinWait.SpinUntil(() => _connection.Disposed, TimeSpan.FromSeconds(5));
        var afterwards = service.Cancel(session.ID);

        //Assert
        Assert.True(stillWaitingAtNineSeconds);
        Assert.False(disposedAtNineSeconds);
        Assert.True(closed.IsSuccess);
        Assert.True(disposed);
        Assert.True(_connection.CancelCalls >= 1);
        Assert.False(running.IsCompleted);
        Assert.Equal(EDatabaseFailure.SessionNotFound, afterwards.Error.Kind);
    }

    /// <summary>RN-DRIVER-007: o driver de um banco não é removido com sessão aberta dele; é o registro que diz se há.</summary>
    [Trait("DatabaseSessionService", "HasOpenSession")]
    [Fact(DisplayName = "OK há sessão aberta só dos bancos que têm sessão, e deixa de haver quando ela fecha")]
    public async Task HasOpenSession_IsTrueOnlyForTheEnginesWithAnOpenSession()
    {
        //Arrange
        var service = CreateService();
        var before = service.HasOpenSession([EDatabaseEngine.PostgreSql]);
        var session = await OpenAsync(service);

        //Act
        var ofThisEngine = service.HasOpenSession([EDatabaseEngine.Db2, EDatabaseEngine.PostgreSql]);
        var ofOtherEngines = service.HasOpenSession([EDatabaseEngine.Db2, EDatabaseEngine.Informix]);
        var ofNoEngine = service.HasOpenSession([]);
        await service.CloseAsync(session.ID);
        var afterClosing = service.HasOpenSession([EDatabaseEngine.PostgreSql]);

        //Assert
        Assert.False(before);
        Assert.True(ofThisEngine);
        Assert.False(ofOtherEngines);
        Assert.False(ofNoEngine);
        Assert.False(afterClosing);
    }

    /// <summary>RN-ARVORE-006 e RN-SESSAO-002: a lista dos bancos é consulta de catálogo e espera a vez, sem `SessionBusy`, como os esquemas.</summary>
    [Trait("DatabaseSessionService", "GetDatabasesAsync")]
    [Fact(DisplayName = "OK a lista dos bancos espera a vez da sessão e depois responde o que a conexão listou")]
    public async Task GetDatabasesAsync_ShouldWaitForTheTurn()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        var idle = await service.GetDatabasesAsync(session.ID, CancellationToken.None);
        using var gaveUp = new CancellationTokenSource();
        _ = service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);

        //Act
        var waiting = service.GetDatabasesAsync(session.ID, gaveUp.Token);
        var completedWhileBusy = waiting.IsCompleted;
        await gaveUp.CancelAsync();
        var afterGivingUp = await waiting;

        //Assert
        Assert.True(idle.IsSuccess);
        Assert.Equal([new DatabaseInfo("producao", true), new DatabaseInfo("historico", false)], idle.Value);
        Assert.False(completedWhileBusy);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, afterGivingUp.Error.Kind);
    }

    /// <summary>RN-SQL-010: sem comando em andamento na sessão não há o que interromper, e o cancelamento nem chega à conexão.</summary>
    [Trait("DatabaseSessionService", "Cancel")]
    [Fact(DisplayName = "OK cancelar só chega à conexão quando há comando em andamento")]
    public async Task Cancel_ShouldReachTheConnection_OnlyWhileACommandRuns()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);

        //Act
        var whileIdle = service.Cancel(session.ID);
        var callsWhileIdle = _connection.CancelCalls;
        _ = service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);
        var whileRunning = service.Cancel(session.ID);

        //Assert
        Assert.True(whileIdle.IsSuccess);
        Assert.Equal(0, callsWhileIdle);
        Assert.True(whileRunning.IsSuccess);
        Assert.Equal(1, _connection.CancelCalls);
    }

    /// <summary>
    /// RN-SQL-007: o aviso do temporizador pode chegar depois de uma leitura que acabou de acontecer (ele já estava a caminho quando a
    /// página saiu). Quem decide é a hora da última leitura: com menos de cinco minutos o cursor fica.
    /// </summary>
    [Trait("DatabaseSessionService", "FetchNextAsync")]
    [Fact(DisplayName = "OK o temporizador que dispara antes de cinco minutos sem leitura não fecha o cursor")]
    public async Task IdleTimer_ShouldKeepTheCursor_WhenTheLastReadIsRecent()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.NextPageHasMore = true;
        await service.FetchNextAsync(session.ID, CancellationToken.None);

        //Act
        _clock.Advance(TimeSpan.FromSeconds(299));
        _clock.FireTimers();
        var closedTooEarly = _connection.CloseCursorCalls;
        _clock.Advance(TimeSpan.FromSeconds(1));
        _clock.FireTimers();

        //Assert
        Assert.Equal(0, closedTooEarly);
        Assert.Equal(1, _connection.CloseCursorCalls);
    }

    /// <summary>
    /// A limpeza da transação falhou e a conexão se fechou (é o que a base faz para não ficar presa numa transação abortada). No
    /// fechamento por ociosidade ninguém recebe uma falha: é o registro que confere a conexão e tira a sessão.
    /// </summary>
    [Trait("DatabaseSessionService", "FetchNextAsync")]
    [Fact(DisplayName = "OK a sessão sai do registro quando a conexão se fecha no fechamento do cursor ocioso")]
    public async Task IdleClose_ShouldRemoveTheSession_WhenTheConnectionIsNoLongerOpen()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.NextPageHasMore = true;
        await service.FetchNextAsync(session.ID, CancellationToken.None);
        _connection.ClosesItselfOnCloseCursor = true;

        //Act
        _clock.Advance(TimeSpan.FromMinutes(5));
        _clock.FireTimers();
        var afterwards = await service.FetchNextAsync(session.ID, CancellationToken.None);

        //Assert
        Assert.Equal(1, _connection.CloseCursorCalls);
        Assert.True(_connection.Disposed);
        Assert.Equal(EDatabaseFailure.SessionNotFound, afterwards.Error.Kind);
    }

    /// <summary>O mesmo numa operação que respondeu: a resposta dela volta, e a sessão cuja conexão não está mais aberta sai do registro.</summary>
    [Trait("DatabaseSessionService", "FetchNextAsync")]
    [Fact(DisplayName = "OK a sessão sai do registro quando a conexão se fecha no fim de uma operação que deu certo")]
    public async Task Operation_ShouldRemoveTheSession_WhenTheConnectionIsNoLongerOpen()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.ClosesItselfOnFetch = true;

        //Act
        var page = await service.FetchNextAsync(session.ID, CancellationToken.None);
        var afterwards = await service.FetchNextAsync(session.ID, CancellationToken.None);

        //Assert
        Assert.True(page.IsSuccess);
        Assert.True(_connection.Disposed);
        Assert.Equal(EDatabaseFailure.SessionNotFound, afterwards.Error.Kind);
    }

    private static readonly QueryColumn[] CutColumns = [new("id", "integer", "number"), new("corpo", "text", "text")];

    /// <summary>Uma página de `rows` linhas com uma célula cortada na coluna `corpo`, com o valor completo que o driver leu.</summary>
    private static QueryPage CutPage(int rows, int cutRow, string full, bool hasMore)
        => new(CutColumns, [.. Enumerable.Range(0, rows).Select(row => new string?[] { row.ToString(), row == cutRow ? full[..10000] : "curto" })], hasMore, 0, [[cutRow, 1]], FullValues: [FullCellValue.Text(full)]);

    /// <summary>
    /// RN-SQL-017: o registro guarda o valor completo das células cortadas de cada página que entrega do resultado, pela linha no
    /// resultado inteiro (a página do carregar mais continua a contagem), e a página não o leva para a tela: ela só diz as que ficaram sem.
    /// </summary>
    [Trait("DatabaseSessionService", "GetCells")]
    [Fact(DisplayName = "OK os valores completos voltam pela linha no resultado inteiro, também os do carregar mais, na ordem pedida")]
    public async Task GetCells_ShouldReturnTheFullValues_OfEveryDeliveredPage()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        var first = new string('a', 10001);
        var second = new string('b', 50000);
        _connection.Outcomes.Enqueue(new QueryOutcome(CutPage(200, 3, first, hasMore: true), null, 0));
        _connection.NextPage = CutPage(200, 5, second, hasMore: false);

        //Act
        var executed = await service.ExecuteAsync(session.ID, "SELECT id, corpo FROM documento", CancellationToken.None);
        var next = await service.FetchNextAsync(session.ID, CancellationToken.None);
        var page = executed.Value.Page!;
        var cells = service.GetCells(session.ID, page.ResultID!.Value, [new CellPosition(205, 1), new CellPosition(3, 1), new CellPosition(4, 1)]);

        //Assert
        Assert.True(cells.IsSuccess);
        Assert.Equal([second, first, null], cells.Value);
        Assert.Null(page.FullValues);
        Assert.Empty(page.CellsWithoutFullValue!);
        Assert.Null(next.Value.FullValues);
        Assert.Empty(next.Value.CellsWithoutFullValue!);
        Assert.Equal(page.ResultID, next.Value.ResultID);
    }

    /// <summary>RN-SQL-017: o registro larga os valores quando a sessão executa outro comando: o resultado de antes não existe mais.</summary>
    [Trait("DatabaseSessionService", "GetCells")]
    [Fact(DisplayName = "NOK depois de outro comando, o resultado de antes não existe mais, e um ID que nunca foi resultado também não")]
    public async Task GetCells_ShouldRefuse_WhenAnotherCommandRan()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.Outcomes.Enqueue(new QueryOutcome(CutPage(1, 0, new string('a', 10001), hasMore: false), null, 0));
        _connection.Outcomes.Enqueue(new QueryOutcome(null, 3, 0));
        var resultID = (await service.ExecuteAsync(session.ID, "SELECT id, corpo FROM documento", CancellationToken.None)).Value.Page!.ResultID!.Value;

        //Act
        var unknown = service.GetCells(session.ID, Guid.NewGuid(), [new CellPosition(0, 1)]);
        await service.ExecuteAsync(session.ID, "UPDATE documento SET corpo = 'x'", CancellationToken.None);
        var afterTheCommand = service.GetCells(session.ID, resultID, [new CellPosition(0, 1)]);

        //Assert
        Assert.Equal(EDatabaseFailure.ResultNotFound, unknown.Error.Kind);
        Assert.Equal(EDatabaseFailure.ResultNotFound, afterTheCommand.Error.Kind);
    }

    [Trait("DatabaseSessionService", "GetCells")]
    [Fact(DisplayName = "NOK sessão fechada não existe, e linha além das entregues está fora do resultado")]
    public async Task GetCells_ShouldRefuse_AClosedSession_AndARowNotDelivered()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.Outcomes.Enqueue(new QueryOutcome(CutPage(200, 0, new string('a', 10001), hasMore: true), null, 0));
        var resultID = (await service.ExecuteAsync(session.ID, "SELECT id, corpo FROM documento", CancellationToken.None)).Value.Page!.ResultID!.Value;

        //Act
        var notDelivered = service.GetCells(session.ID, resultID, [new CellPosition(200, 1)]);
        await service.CloseAsync(session.ID);
        var closed = service.GetCells(session.ID, resultID, [new CellPosition(0, 1)]);

        //Assert
        Assert.Equal(EDatabaseFailure.CellsInvalid, notDelivered.Error.Kind);
        Assert.Equal(EDatabaseFailure.SessionNotFound, closed.Error.Kind);
    }

    /// <summary>
    /// RN-ABERTO-006: onde a IBM não publica o driver (macOS em processador Intel), a API sobe sem os clients do Db2 e do Informix.
    /// Abrir ou testar uma conexão desses bancos responde falha de conexão, e a mensagem diz que é o Prism daquela plataforma que
    /// não conecta neles. Aqui o registro só tem um client, o de mentira do PostgreSQL.
    /// </summary>
    [Trait("DatabaseSessionService", "OpenAsync")]
    [Fact(DisplayName = "Erro banco sem driver na plataforma responde que o Prism dela não conecta em Db2 e Informix")]
    public async Task Open_ShouldSayThePlatformHasNoDriver_WhenTheEngineHasNoClient()
    {
        //Arrange
        var service = CreateService();
        var message = $"O Prism para {RuntimeInformation.RuntimeIdentifier} ainda não conecta em Db2 e Informix: a IBM não publica o driver para ela.";

        //Act
        var opened = await service.OpenAsync(Guid.NewGuid(), Settings with { Engine = EDatabaseEngine.Informix }, 0, CancellationToken.None);
        var tested = await service.TestAsync(Settings with { Engine = EDatabaseEngine.Db2 }, CancellationToken.None);

        //Assert
        Assert.True(opened.IsFailure);
        Assert.Equal(EDatabaseFailure.ConnectionFailed, opened.Error.Kind);
        Assert.Equal(message, opened.Error.Message);
        Assert.True(tested.IsFailure);
        Assert.Equal(EDatabaseFailure.ConnectionFailed, tested.Error.Kind);
        Assert.Equal(message, tested.Error.Message);
    }

    /// <summary>O relógio falso, com os temporizadores na mão do teste: `FireTimers` dispara todos, estejam ou não na hora.</summary>
    private sealed class ManualTimers : FakeTimeProvider
    {
        private readonly List<(TimerCallback Callback, object? State)> _timers = [];

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            _timers.Add((callback, state));

            return new NeverFires();
        }

        public void FireTimers()
        {
            foreach (var (callback, state) in _timers)
                callback(state);
        }

        private sealed class NeverFires : ITimer
        {
            public bool Change(TimeSpan dueTime, TimeSpan period)
                => true;

            public void Dispose()
            {
            }

            public ValueTask DisposeAsync()
                => ValueTask.CompletedTask;
        }
    }

    private sealed class FakeClient(FakeConnection connection) : IDatabaseClient
    {
        public EDatabaseEngine Engine => EDatabaseEngine.PostgreSql;

        public Task<Result<IDatabaseConnection, DatabaseFailure>> OpenAsync(ConnectionSettings settings, CancellationToken cancellationToken)
            => Task.FromResult(Result.Success<IDatabaseConnection, DatabaseFailure>(connection));
    }

    /// <summary>
    /// A conexão de mentira: executar nunca volta (a não ser que o teste dê o desfecho), e carregar mais devolve uma página vazia com o
    /// `HasMore` que o teste pediu (ou a página que ele deu).
    /// </summary>
    private sealed class FakeConnection : IDatabaseConnection
    {
        private int _cancelCalls;

        public string ServerVersion => "0";

        public bool IsOpen { get; private set; } = true;

        public bool ClosesItselfOnCloseCursor { get; set; }

        public bool ClosesItselfOnFetch { get; set; }

        public bool Disposed { get; private set; }

        public int CancelCalls => _cancelCalls;

        public int CloseCursorCalls { get; private set; }

        public bool NextPageHasMore { get; set; }

        /// <summary>O que executar responde; sem ele, o comando nunca volta.</summary>
        public Queue<QueryOutcome> Outcomes { get; } = new();

        /// <summary>A página do carregar mais; sem ela, uma página vazia com o `HasMore` pedido.</summary>
        public QueryPage? NextPage { get; set; }

        public Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(string sql, int pageSize, CancellationToken cancellationToken)
            => Outcomes.TryDequeue(out var outcome) ? Task.FromResult(Result.Success<QueryOutcome, DatabaseFailure>(outcome)) : new TaskCompletionSource<Result<QueryOutcome, DatabaseFailure>>().Task;

        public Task<Result<QueryPage, DatabaseFailure>> FetchNextAsync(CancellationToken cancellationToken)
        {
            if (ClosesItselfOnFetch)
                IsOpen = false;

            return Task.FromResult(Result.Success<QueryPage, DatabaseFailure>(NextPage ?? new QueryPage([], [], NextPageHasMore, 0, [])));
        }

        public Task CloseCursorAsync()
        {
            CloseCursorCalls++;
            if (ClosesItselfOnCloseCursor)
                IsOpen = false;

            return Task.CompletedTask;
        }

        public void Cancel()
            => Interlocked.Increment(ref _cancelCalls);

        public ValueTask DisposeAsync()
        {
            Disposed = true;

            return ValueTask.CompletedTask;
        }

        public Task<UnitResult<DatabaseFailure>> PingAsync(CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<long, DatabaseFailure>> CountAsync(string sql, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<SchemaInfo>, DatabaseFailure>> GetSchemasAsync(CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>> GetObjectsAsync(string schema, string kind, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<ColumnInfo>, DatabaseFailure>> GetColumnsAsync(string schema, string table, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<IndexInfo>, DatabaseFailure>> GetIndexesAsync(string schema, string table, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<ForeignKeyInfo>, DatabaseFailure>> GetForeignKeysAsync(string schema, string table, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<ReferencingForeignKeyInfo>, DatabaseFailure>> GetReferencingForeignKeysAsync(string schema, string table, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<CheckConstraintInfo>, DatabaseFailure>> GetChecksAsync(string schema, string table, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<ViewDefinitionInfo, DatabaseFailure>> GetViewDefinitionAsync(string schema, string view, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<SchemaDiagramInfo, DatabaseFailure>> GetDiagramAsync(string schema, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<DatabasePropertyInfo>, DatabaseFailure>> GetPropertiesAsync(CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<DatabaseInfo>, DatabaseFailure>> GetDatabasesAsync(CancellationToken cancellationToken)
            => Task.FromResult(Result.Success<IReadOnlyList<DatabaseInfo>, DatabaseFailure>([new DatabaseInfo("producao", true), new DatabaseInfo("historico", false)]));

        public Task<Result<IReadOnlyList<EditCatalogTable?>, DatabaseFailure>> DescribeEditTablesAsync(EditTables tables, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<UnitResult<DatabaseFailure>> LimitLockWaitAsync(CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<int, DatabaseFailure>> ApplyEditsAsync(EditTables tables, bool oneAtATime, Func<IReadOnlyList<EditCatalogTable?>, Result<IReadOnlyList<EditCommand>, DatabaseFailure>> plan, CancellationToken cancellationToken)
            => throw new NotSupportedException();
    }
}
