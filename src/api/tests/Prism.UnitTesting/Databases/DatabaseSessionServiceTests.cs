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
public sealed partial class DatabaseSessionServiceTests
{
    private static readonly ConnectionSettings Settings = new(EDatabaseEngine.PostgreSql, "banco.local", 5432, "producao", "operador", "senha-de-teste");

    private readonly Mock<IVaultService> _vault = new();
    private readonly ManualTimers _clock = new();
    private readonly FakeConnection _connection = new();

    /// <param name="clock">Sem ele, o relógio de temporizadores na mão do teste (`_clock`); com um `FakeTimeProvider`, eles disparam na hora marcada.</param>
    private DatabaseSessionService CreateService(TimeProvider? clock = null)
        => new([new FakeClient(_connection)], _vault.Object, clock ?? _clock, Logger.None);

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

    /// <summary>
    /// RN-BUSCA-002 e RN-SESSAO-002: o índice de nomes é consulta de catálogo e espera a vez, sem `SessionBusy`, e a conexão o lê até o limite do
    /// serviço (50.000 nomes), um número que não vem de fora.
    /// </summary>
    [Trait("DatabaseSessionService", "GetObjectNamesAsync")]
    [Fact(DisplayName = "OK o índice de nomes espera a vez da sessão e pede à conexão até 50.000 nomes")]
    public async Task GetObjectNamesAsync_ShouldWaitForTheTurn_AndAskForTheLimit()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        var idle = await service.GetObjectNamesAsync(session.ID, CancellationToken.None);
        using var gaveUp = new CancellationTokenSource();
        _ = service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);

        //Act
        var waiting = service.GetObjectNamesAsync(session.ID, gaveUp.Token);
        var completedWhileBusy = waiting.IsCompleted;
        await gaveUp.CancelAsync();
        var afterGivingUp = await waiting;

        //Assert
        Assert.True(idle.IsSuccess);
        Assert.Equal([("loja", false, "pedido", "resumo")], idle.Value.Schemas.Select(schema => (schema.Name, schema.IsSystem, string.Join(",", schema.Tables), string.Join(",", schema.Views))));
        Assert.False(completedWhileBusy);
        Assert.Equal(EDatabaseFailure.ExecutionFailed, afterGivingUp.Error.Kind);
        Assert.Equal([50_000], _connection.ObjectNamesLimits);
        Assert.Equal(50_000, DatabaseSessionService.ObjectNamesLimit);
    }

    /// <summary>RN-BUSCA-002: a sessão que não existe responde `SessionNotFound`, sem ir a conexão nenhuma.</summary>
    [Trait("DatabaseSessionService", "GetObjectNamesAsync")]
    [Fact(DisplayName = "Erro o índice de nomes de uma sessão que não existe")]
    public async Task GetObjectNamesAsync_ShouldFail_WhenTheSessionDoesNotExist()
    {
        //Arrange
        var service = CreateService();

        //Act
        var names = await service.GetObjectNamesAsync(Guid.CreateVersion7(), CancellationToken.None);

        //Assert
        Assert.True(names.IsFailure);
        Assert.Equal(EDatabaseFailure.SessionNotFound, names.Error.Kind);
        Assert.Empty(_connection.ObjectNamesLimits);
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
    /// RN-SQL-007: o temporizador do sistema pode disparar uns milissegundos antes da hora marcada pelo relógio da última leitura. O
    /// aviso adiantado não fecha o cursor, e tem de rearmar para o que falta; sem isso, o cursor ficava aberto até a sessão fechar.
    /// </summary>
    [Trait("DatabaseSessionService", "FetchNextAsync")]
    [Fact(DisplayName = "OK o temporizador que dispara adiantado rearma e fecha o cursor quando dá a hora")]
    public async Task IdleTimer_ShouldRearm_WhenItFiresEarly()
    {
        //Arrange
        var clock = new EarlyTimers(TimeSpan.FromMilliseconds(10));
        var service = new DatabaseSessionService([new FakeClient(_connection)], _vault.Object, clock, Logger.None);
        var session = await OpenAsync(service);
        _connection.NextPageHasMore = true;
        await service.FetchNextAsync(session.ID, CancellationToken.None);

        //Act
        clock.Advance(TimeSpan.FromMinutes(5) - TimeSpan.FromMilliseconds(10));
        var closedTooEarly = _connection.CloseCursorCalls;
        clock.Advance(TimeSpan.FromHours(1));

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

    /// <summary>
    /// RN-SQL-007 e RN-GRADE-011: a recusa do filtro não vai ao banco, e o cursor do resultado anterior continua aberto na conexão (o
    /// "carregar mais" segue funcionando). Ele continua vigiado: fecha aos cinco minutos da última leitura, e não fica aberto (no
    /// PostgreSQL, dentro da transação só de leitura) até o próximo comando ou o fim da sessão.
    /// </summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "OK depois da recusa do filtro o cursor aberto fecha aos cinco minutos da última leitura")]
    public async Task IdleTimer_ShouldCloseTheCursorFiveMinutesAfterTheLastRead_WhenTheFilterIsRefused()
    {
        //Arrange
        var clock = new FakeTimeProvider();
        var service = CreateService(clock);
        var session = await OpenAsync(service);
        _connection.Outcomes.Enqueue(new QueryOutcome(OnePage(hasMore: true), null, 0));
        await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido", CancellationToken.None);
        clock.Advance(TimeSpan.FromMinutes(2));

        //Act
        var refused = await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido", "a = 1; DELETE FROM loja.pedido", QueryPaging.DefaultPageSize, CancellationToken.None);
        clock.Advance(TimeSpan.FromMinutes(3));

        //Assert
        Assert.Equal(EDatabaseFailure.FilterInvalid, refused.Error.Kind);
        Assert.Equal(1, _connection.CloseCursorCalls);
        Assert.False(_connection.HasOpenCursor);
    }

    /// <summary>
    /// RN-SQL-007: a recusa da conexão antes de ir ao banco (controle de transação, mais de um comando) não é leitura. Um minuto depois
    /// da leitura, ela não adia o prazo: o cursor fecha aos cinco minutos da leitura, e não aos cinco da recusa.
    /// </summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Theory(DisplayName = "OK a recusa da conexão antes de ir ao banco não adia o fechamento do cursor ocioso")]
    [InlineData(EDatabaseFailure.TransactionControlNotSupported)]
    [InlineData(EDatabaseFailure.MultipleStatementsNotSupported)]
    public async Task IdleTimer_ShouldKeepTheDeadlineOfTheLastRead_WhenTheConnectionRefusesBeforeRunning(EDatabaseFailure refusal)
    {
        //Arrange
        var clock = new FakeTimeProvider();
        var service = CreateService(clock);
        var session = await OpenAsync(service);
        _connection.NextPageHasMore = true;
        await service.FetchNextAsync(session.ID, CancellationToken.None);
        _connection.Refusal = new DatabaseFailure(refusal, "Recusado antes de ir ao banco.");
        clock.Advance(TimeSpan.FromMinutes(1));

        //Act
        var refused = await service.ExecuteAsync(session.ID, "COMMIT", CancellationToken.None);
        clock.Advance(TimeSpan.FromMinutes(4) - TimeSpan.FromMilliseconds(1));
        var closedBeforeFiveMinutes = _connection.CloseCursorCalls;
        clock.Advance(TimeSpan.FromMilliseconds(1));

        //Assert
        Assert.Equal(refusal, refused.Error.Kind);
        Assert.Equal(0, closedBeforeFiveMinutes);
        Assert.Equal(1, _connection.CloseCursorCalls);
    }

    /// <summary>
    /// RN-SQL-007: o aviso do temporizador que chega enquanto uma recusa tem a vez da sessão desiste, contando com ela. Com o prazo da
    /// última leitura vencido, é a recusa, ao terminar, quem fecha o cursor: deixar o temporizador como estava o deixaria aberto.
    /// </summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "OK o aviso que chega durante uma recusa não se perde: ela fecha o cursor cujo prazo venceu")]
    public async Task IdleTimer_ThatFiresDuringARefusal_ShouldHaveTheRefusalCloseTheCursor()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.NextPageHasMore = true;
        await service.FetchNextAsync(session.ID, CancellationToken.None);
        _connection.Refusal = new DatabaseFailure(EDatabaseFailure.TransactionControlNotSupported, "Recusado antes de ir ao banco.");
        _connection.WhileRefusing = _clock.FireTimers;
        _clock.Advance(TimeSpan.FromMinutes(5));

        //Act
        var refused = await service.ExecuteAsync(session.ID, "COMMIT", CancellationToken.None);

        //Assert
        Assert.Equal(EDatabaseFailure.TransactionControlNotSupported, refused.Error.Kind);
        Assert.Equal(1, _connection.CloseCursorCalls);
    }

    /// <summary>
    /// RN-SQL-007: o comando que foi ao banco fechou o cursor anterior antes de ser enviado, tenha ele falhado no banco, sido cancelado
    /// ou deixado uma transação que a base desfez (`executed`). Sem cursor, o temporizador para, como sempre: nada fecha depois.
    /// </summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Theory(DisplayName = "OK a falha de um comando que foi ao banco fechou o cursor, e o temporizador para")]
    [InlineData(EDatabaseFailure.ExecutionFailed, null, false)]
    [InlineData(EDatabaseFailure.ExecutionFailed, ECancelOutcome.Canceled, false)]
    [InlineData(EDatabaseFailure.TransactionControlNotSupported, null, true)]
    public async Task IdleTimer_ShouldStop_WhenAFailedCommandClosedTheCursor(EDatabaseFailure kind, ECancelOutcome? outcome, bool executed)
    {
        //Arrange
        var clock = new FakeTimeProvider();
        var service = CreateService(clock);
        var session = await OpenAsync(service);
        _connection.NextPageHasMore = true;
        await service.FetchNextAsync(session.ID, CancellationToken.None);
        _connection.Failure = new DatabaseFailure(kind, "Falhou depois de ir ao banco.", Outcome: outcome, Executed: executed);
        clock.Advance(TimeSpan.FromMinutes(1));

        //Act
        var failed = await service.ExecuteAsync(session.ID, "SELECT 1 / 0", CancellationToken.None);
        clock.Advance(TimeSpan.FromMinutes(10));

        //Assert
        Assert.Equal(kind, failed.Error.Kind);
        Assert.False(_connection.HasOpenCursor);
        Assert.Equal(0, _connection.CloseCursorCalls);
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

    /// <summary>
    /// RN-GRADE-011: com filtro, o comando que vai à conexão é o montado, com a condição no `WHERE` e a ordem no lugar do `ORDER BY`; a
    /// página e o "carregar mais" dizem que ele entrou junto, e a edição fica como sem o filtro (o catálogo decide).
    /// </summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "OK com filtro junto, a conexão executa o comando montado e a página diz merged")]
    public async Task Execute_WithAFilter_RunsTheMergedCommand()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.Outcomes.Enqueue(new QueryOutcome(OnePage(hasMore: true), null, 0));

        //Act
        var executed = await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido ORDER BY numero -- todos", "status = 'aberto' ORDER BY numero DESC", QueryPaging.DefaultPageSize, CancellationToken.None);
        var next = await service.FetchNextAsync(session.ID, CancellationToken.None);

        //Assert
        Assert.Equal(["SELECT * FROM loja.pedido WHERE (status = 'aberto') ORDER BY numero DESC -- todos"], _connection.Executed);
        Assert.Equal((EFilterApplied.Merged, ResultEditability.Unknown), (executed.Value.Page!.FilterApplied, executed.Value.Page.Editable));
        Assert.Equal(EFilterApplied.Merged, next.Value.FilterApplied);
    }

    /// <summary>RN-GRADE-011: o comando com agrupamento vai por fora, e o resultado é só leitura com o motivo do próprio comando.</summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "OK com filtro por fora, a conexão executa a tabela derivada e o resultado é só leitura")]
    public async Task Execute_WithAFilter_RunsTheWrappedCommand_ReadOnly()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.Outcomes.Enqueue(new QueryOutcome(OnePage(hasMore: false), null, 0));

        //Act
        var executed = await service.ExecuteAsync(session.ID, "SELECT status, count(*) AS n FROM loja.pedido GROUP BY status", "n > 1", QueryPaging.DefaultPageSize, CancellationToken.None);

        //Assert
        Assert.Equal(["SELECT * FROM (\nSELECT status, count(*) AS n FROM loja.pedido GROUP BY status\n) prism_filtro\nWHERE n > 1"], _connection.Executed);
        Assert.Equal((EFilterApplied.Wrapped, ResultEditability.ReadOnly("agrupamento")), (executed.Value.Page!.FilterApplied, executed.Value.Page.Editable));
    }

    /// <summary>RN-GRADE-011: sem filtro (nulo ou só espaços), o comando vai como veio, e a página não fala de filtro.</summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "OK sem filtro, o comando vai como veio e a página não diz filtro")]
    public async Task Execute_WithoutAFilter_RunsTheCommandAsIs()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.Outcomes.Enqueue(new QueryOutcome(OnePage(hasMore: false), null, 0));
        _connection.Outcomes.Enqueue(new QueryOutcome(OnePage(hasMore: false), null, 0));

        //Act
        var blank = await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido", "  ", QueryPaging.DefaultPageSize, CancellationToken.None);
        var without = await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido", CancellationToken.None);

        //Assert
        Assert.Equal(["SELECT * FROM loja.pedido", "SELECT * FROM loja.pedido"], _connection.Executed);
        Assert.Null(blank.Value.Page!.FilterApplied);
        Assert.Null(without.Value.Page!.FilterApplied);
    }

    /// <summary>RN-GRADE-011: o filtro que não se junta com segurança e o envio de mais de um comando são recusados sem ir à conexão.</summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "Erro filtro inválido e comando de mais de um envio não vão à conexão")]
    public async Task Execute_WithAnInvalidFilter_IsRefusedWithoutRunning()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);

        //Act
        var invalid = await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido", "a = 1; DELETE FROM loja.pedido", QueryPaging.DefaultPageSize, CancellationToken.None);
        var several = await service.ExecuteAsync(session.ID, "SELECT 1; SELECT 2", "a = 1", QueryPaging.DefaultPageSize, CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.FilterInvalid, SqlFilter.Terminator), (invalid.Error.Kind, invalid.Error.Message));
        Assert.Equal(EDatabaseFailure.MultipleStatementsNotSupported, several.Error.Kind);
        Assert.Empty(_connection.Executed);
    }

    /// <summary>RN-SQL-009 e RN-GRADE-011: a posição do erro é a do comando montado, que a tela não mostra, e não vai; sem filtro, vai.</summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "OK a falha do banco com filtro vem sem a posição do erro")]
    public async Task Execute_WithAFilter_DropsThePositionOfTheError()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.Failure = new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "column \"x\" does not exist", "42703", 40);

        //Act
        var filtered = await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido", "x = 1", QueryPaging.DefaultPageSize, CancellationToken.None);
        var plain = await service.ExecuteAsync(session.ID, "SELECT x FROM loja.pedido", CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.ExecutionFailed, "column \"x\" does not exist", "42703", (int?)null), (filtered.Error.Kind, filtered.Error.Message, filtered.Error.SqlState, filtered.Error.Position));
        Assert.Equal(40, plain.Error.Position);
    }

    /// <summary>RN-GRADE-011: a recusa do filtro sai do banco da sessão, sem tomar a vez; sem a sessão, nula (a execução responde que ela não existe).</summary>
    [Trait("DatabaseSessionService", "FilterRefusal")]
    [Fact(DisplayName = "OK a recusa do filtro é a do banco da sessão, e nula sem a sessão")]
    public async Task FilterRefusal_ShouldReadTheFilterOfTheSessionsDatabase()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);

        //Act
        var refused = service.FilterRefusal(session.ID, "a = $$x");
        var accepted = service.FilterRefusal(session.ID, "a = 1 ORDER BY b");
        var unknown = service.FilterRefusal(Guid.NewGuid(), "a = $$x");

        //Assert
        Assert.Equal(SqlFilter.OpenQuote, refused);
        Assert.Null(accepted);
        Assert.Null(unknown);
    }

    private static QueryPage OnePage(bool hasMore)
        => new([new QueryColumn("numero", "integer", "number")], [["1001"]], hasMore, 0, []);

    /// <summary>O relógio falso cujos temporizadores disparam `early` antes da hora, como o do sistema às vezes faz.</summary>
    private sealed class EarlyTimers(TimeSpan early) : FakeTimeProvider
    {
        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
            => new Early(base.CreateTimer(callback, state, Adjust(dueTime), period), this);

        private TimeSpan Adjust(TimeSpan dueTime)
            => dueTime == Timeout.InfiniteTimeSpan || dueTime <= early ? dueTime : dueTime - early;

        private sealed class Early(ITimer inner, EarlyTimers clock) : ITimer
        {
            public bool Change(TimeSpan dueTime, TimeSpan period)
                => inner.Change(clock.Adjust(dueTime), period);

            public void Dispose()
                => inner.Dispose();

            public ValueTask DisposeAsync()
                => inner.DisposeAsync();
        }
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
    /// `HasMore` que o teste pediu (ou a página que ele deu). O cursor segue a base: a página com mais linhas o deixa aberto, toda
    /// operação que vai ao banco o fecha, e a recusa antes de ir ao banco (`Refusal`) não o toca.
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

        /// <summary>Os comandos que chegaram a executar, na ordem.</summary>
        public List<string> Executed { get; } = [];

        /// <summary>A recusa do banco que executar responde, quando o teste a dá. O comando foi ao banco, e o cursor anterior fechou.</summary>
        public DatabaseFailure? Failure { get; set; }

        /// <summary>A recusa antes de ir ao banco (controle de transação, mais de um comando), que não toca no cursor.</summary>
        public DatabaseFailure? Refusal { get; set; }

        /// <summary>Roda durante a recusa, com a vez da sessão tomada: é onde o teste faz o temporizador avisar "no meio" dela.</summary>
        public Action? WhileRefusing { get; set; }

        /// <summary>RN-PROT-002: os comandos que chegaram pelo caminho da conexão somente leitura, na ordem.</summary>
        public List<string> ExecutedReadOnly { get; } = [];

        /// <summary>RN-VAR-032: os parâmetros de cada comando que chegou (por `ExecuteAsync` e por `ExecuteReadOnlyAsync`), na ordem; nulo quando o comando veio sem eles.</summary>
        public List<IReadOnlyList<QueryParameter>?> ExecutedParameters { get; } = [];

        /// <summary>
        /// RN-SQL-007: há um cursor aberto na conexão. Segue o da base: a página com mais linhas o abre, e todo comando que chega à conexão, o
        /// fim da leitura e o fechamento por ociosidade o fecham; a recusa antes de ir ao banco (<see cref="Refusal"/>) não o toca. O teste
        /// pode dar o que quiser.
        /// </summary>
        public bool HasOpenCursor { get; set; }

        /// <summary>RN-TX-002: o Commit manual de mentira: o comando que chega à conexão com ele ligado abre a transação, e o Commit e o Rollback a encerram.</summary>
        public bool ManualCommit { get; set; }

        public ETransactionState Transaction { get; set; }

        /// <summary>RN-TX-013: o que a conexão responde sobre o banco ter transação.</summary>
        public bool TransactionsAvailable { get; set; } = true;

        /// <summary>RN-TX-002: os fins de transação que chegaram (`commit`, `rollback`), na ordem.</summary>
        public List<string> Ended { get; } = [];

        public Task<Result<bool, DatabaseFailure>> TransactionsAvailableAsync(CancellationToken cancellationToken)
            => Task.FromResult(Result.Success<bool, DatabaseFailure>(TransactionsAvailable));

        public Task<UnitResult<DatabaseFailure>> CommitAsync(CancellationToken cancellationToken)
            => End("commit");

        public Task<UnitResult<DatabaseFailure>> RollbackAsync(CancellationToken cancellationToken)
            => End("rollback");

        private Task<UnitResult<DatabaseFailure>> End(string how)
        {
            Ended.Add(how);
            Transaction = ETransactionState.None;

            return Task.FromResult(UnitResult.Success<DatabaseFailure>());
        }

        /// <summary>RN-VERIF-002: as consultas de verificação que chegaram (nula é a do banco), na ordem.</summary>
        public List<string?> Verified { get; } = [];

        /// <summary>O que a verificação responde; sem ele, sucesso. Com <see cref="VerificationGate"/>, ela só volta quando o teste o completa.</summary>
        public DatabaseFailure? VerificationFailure { get; set; }

        public TaskCompletionSource? VerificationGate { get; set; }

        /// <summary>A conexão cai na verificação, como a que o administrador derrubou.</summary>
        public bool ClosesItselfOnVerify { get; set; }

        public Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(string sql, int pageSize, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
        {
            if (Refusal is { } refusal)
            {
                WhileRefusing?.Invoke();

                return Task.FromResult(Result.Failure<QueryOutcome, DatabaseFailure>(refusal));
            }

            Executed.Add(sql);
            ExecutedParameters.Add(parameters);
            HasOpenCursor = false;
            if (ManualCommit && Transaction == ETransactionState.None)
                Transaction = ETransactionState.Open;

            if (Failure is { } failure)
                return Task.FromResult(Result.Failure<QueryOutcome, DatabaseFailure>(failure));

            return Respond();
        }

        public Task<Result<QueryOutcome, DatabaseFailure>> ExecuteReadOnlyAsync(string sql, int pageSize, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
        {
            ExecutedReadOnly.Add(sql);
            ExecutedParameters.Add(parameters);
            HasOpenCursor = false;

            return Respond();
        }

        /// <summary>O desfecho que o teste deu, com o cursor aberto quando a página tem mais linhas; sem ele, o comando nunca volta.</summary>
        private Task<Result<QueryOutcome, DatabaseFailure>> Respond()
        {
            if (!Outcomes.TryDequeue(out var outcome))
                return new TaskCompletionSource<Result<QueryOutcome, DatabaseFailure>>().Task;

            HasOpenCursor = outcome.Page?.HasMore ?? false;

            return Task.FromResult(Result.Success<QueryOutcome, DatabaseFailure>(outcome));
        }

        public async Task<UnitResult<DatabaseFailure>> VerifyAsync(string? sql, CancellationToken cancellationToken)
        {
            Verified.Add(sql);
            if (VerificationGate is { } gate)
                await gate.Task;

            if (ClosesItselfOnVerify)
                IsOpen = false;

            return VerificationFailure is { } failure ? UnitResult.Failure(failure) : UnitResult.Success<DatabaseFailure>();
        }

        public Task<Result<QueryPage, DatabaseFailure>> FetchNextAsync(CancellationToken cancellationToken)
        {
            if (ClosesItselfOnFetch)
                IsOpen = false;

            var page = NextPage ?? new QueryPage([], [], NextPageHasMore, 0, []);
            HasOpenCursor = page.HasMore;

            return Task.FromResult(Result.Success<QueryPage, DatabaseFailure>(page));
        }

        public Task CloseCursorAsync()
        {
            CloseCursorCalls++;
            HasOpenCursor = false;
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

        /// <summary>RN-SQL-006 e RN-VAR-033: as contagens que chegaram a esta conexão (o texto e os parâmetros do comando), na ordem.</summary>
        public List<(string Sql, IReadOnlyList<QueryParameter>? Parameters)> Counts { get; } = [];

        public Task<Result<long, DatabaseFailure>> CountAsync(string sql, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
        {
            Counts.Add((sql, parameters));

            return Task.FromResult(Result.Success<long, DatabaseFailure>(99));
        }

        public Task<Result<IReadOnlyList<SchemaInfo>, DatabaseFailure>> GetSchemasAsync(CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>> GetObjectsAsync(string schema, string kind, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        /// <summary>RN-BUSCA-002: o limite que cada pedido do índice de nomes trouxe, na ordem.</summary>
        public List<int> ObjectNamesLimits { get; } = [];

        public Task<Result<ObjectNamesInfo, DatabaseFailure>> GetObjectNamesAsync(int limit, CancellationToken cancellationToken)
        {
            ObjectNamesLimits.Add(limit);
            HasOpenCursor = false;

            return Task.FromResult(Result.Success<ObjectNamesInfo, DatabaseFailure>(new ObjectNamesInfo([new SchemaObjectNamesInfo("loja", false, ["pedido"], ["resumo"])], false)));
        }

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
        {
            HasOpenCursor = false;

            return Task.FromResult(Result.Success<IReadOnlyList<DatabaseInfo>, DatabaseFailure>([new DatabaseInfo("producao", true), new DatabaseInfo("historico", false)]));
        }

        /// <summary>RN-EDIT-010: o que o catálogo da edição responde; sem ele, a edição não é esperada no teste.</summary>
        public IReadOnlyList<EditCatalogTable?>? Catalog { get; set; }

        /// <summary>Quantas vezes o catálogo da edição foi consultado nesta conexão.</summary>
        public int DescribeCalls { get; private set; }

        /// <summary>RN-EDIT-005: os comandos de cada "Salvar" que chegou à conexão, na ordem.</summary>
        public List<IReadOnlyList<EditCommand>> Saved { get; } = [];

        public Task<Result<IReadOnlyList<EditCatalogTable?>, DatabaseFailure>> DescribeEditTablesAsync(EditTables tables, CancellationToken cancellationToken)
        {
            DescribeCalls++;

            return Task.FromResult(Catalog is { } catalog ? Result.Success<IReadOnlyList<EditCatalogTable?>, DatabaseFailure>(catalog) : throw new NotSupportedException());
        }

        public Task<UnitResult<DatabaseFailure>> LimitLockWaitAsync(CancellationToken cancellationToken)
            => Task.FromResult(UnitResult.Success<DatabaseFailure>());

        /// <summary>RN-EDIT-021: a coluna inteira de cada "Salvar" que chegou à conexão com uma, e se ele pediu a transação do retrato.</summary>
        public List<(WholeColumnPlan Plan, bool WholeColumn)> SavedWholeColumns { get; } = [];

        /// <summary>RN-EDIT-019: as contagens da coluna inteira que chegaram à conexão, e o que elas respondem.</summary>
        public List<WholeColumnPlan> Counted { get; } = [];

        public long WholeColumnRows { get; set; }

        /// <summary>Como a base: o "Salvar" é um comando na conexão e fecha o cursor aberto; o plano roda com o catálogo de dentro da transação.</summary>
        public Task<Result<int, DatabaseFailure>> ApplyEditsAsync(EditTables tables, bool oneAtATime, bool wholeColumn, Func<IReadOnlyList<EditCatalogTable?>, Result<EditPlan, DatabaseFailure>> plan, CancellationToken cancellationToken)
        {
            HasOpenCursor = false;
            var planned = plan(Catalog ?? throw new NotSupportedException());
            if (planned.IsFailure)
                return Task.FromResult(Result.Failure<int, DatabaseFailure>(planned.Error));

            Saved.Add(planned.Value.Commands);
            if (planned.Value.WholeColumn is { } whole)
                SavedWholeColumns.Add((whole, wholeColumn));

            return Task.FromResult(Result.Success<int, DatabaseFailure>(planned.Value.Commands.Count + (planned.Value.WholeColumn is null ? 0 : 1)));
        }

        /// <summary>Como a base: a contagem é um comando na conexão e fecha o cursor aberto; o plano roda com o catálogo da própria sessão.</summary>
        public Task<Result<long, DatabaseFailure>> CountWholeColumnAsync(EditTables tables, Func<IReadOnlyList<EditCatalogTable?>, Result<WholeColumnPlan, DatabaseFailure>> plan, CancellationToken cancellationToken)
        {
            HasOpenCursor = false;
            var planned = plan(Catalog ?? throw new NotSupportedException());
            if (planned.IsFailure)
                return Task.FromResult(Result.Failure<long, DatabaseFailure>(planned.Error));

            Counted.Add(planned.Value);

            return Task.FromResult(Result.Success<long, DatabaseFailure>(WholeColumnRows));
        }

        public Task<Result<ImportCatalog?, DatabaseFailure>> DescribeImportTargetAsync(string schema, string table, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<IReadOnlyList<string?>>, DatabaseFailure>> CheckImportCastsAsync(IReadOnlyList<string> types, IReadOnlyList<IReadOnlyList<object?>> values, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        /// <summary>RN-EXPORT-017: a leitura da exportação é de uma conexão à parte, que o registro de sessões nunca usa.</summary>
        public Task<UnitResult<DatabaseFailure>> BeginExportAsync(CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<Result<long?, DatabaseFailure>> CountExportAsync(string sql, bool required, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<QueryColumn>, DatabaseFailure>> StartExportReadAsync(string sql, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
            => throw new NotSupportedException();

        public Task<Result<ExportBatch, DatabaseFailure>> ReadExportRowsAsync(ExportReadPlan plan, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        /// <summary>RN-IMPORT-015: o carregador da importação e da cópia é de uma conexão à parte, que o registro de sessões nunca usa.</summary>
        public Task<UnitResult<DatabaseFailure>> BeginLoadAsync(CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public int LoadRowsPerCommand(int columns)
            => throw new NotSupportedException();

        public Task<UnitResult<DatabaseFailure>> BeginLoadTransactionAsync(CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<UnitResult<DatabaseFailure>> EmptyTableAsync(string schema, string table, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<UnitResult<DatabaseFailure>> InsertRowsAsync(LoadTarget target, IReadOnlyList<IReadOnlyList<EditParameter>> rows, CancellationToken cancellationToken)
            => throw new NotSupportedException();

        public Task<UnitResult<DatabaseFailure>> CommitLoadAsync()
            => throw new NotSupportedException();
    }
}
