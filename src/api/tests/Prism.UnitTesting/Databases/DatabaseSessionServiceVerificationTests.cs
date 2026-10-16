using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.TestingCore.Extensions;
using Serilog.Core;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-VERIF-002 e RN-PROT-002: a verificação periódica e o comando de uma conexão somente leitura no registro de sessões, com conexões de mentira.
/// É a mesma classe do `DatabaseSessionServiceTests`, em outro arquivo, para dividir a conexão e o client de mentira.
/// </summary>
public sealed partial class DatabaseSessionServiceTests
{
    private static readonly Guid VerifiedConnectionID = Guid.Parse("0199e0a0-0000-7000-8000-0000000000d1");

    /// <summary>Uma página sem mais linhas: o resultado fica na sessão (é uma aba), e o cursor não fica aberto.</summary>
    private static QueryOutcome FinishedPage()
        => new(new QueryPage([new QueryColumn("n", "integer", "number")], [["1"]], false, 1, []), null, 1);

    /// <summary>O registro com uma conexão de mentira por sessão, na ordem em que elas abrem.</summary>
    private DatabaseSessionService CreateService(params FakeConnection[] connections)
        => new([new QueueClient(connections)], _vault.Object, _clock, Logger.None);

    private static async Task<DatabaseSessionInfo> OpenAsync(DatabaseSessionService service, Guid connectionID)
        => (await service.OpenAsync(connectionID, Settings, 0, CancellationToken.None)).Value;

    [Trait("DatabaseSessionService", "VerifyAsync")]
    [Fact(DisplayName = "OK sem sessão aberta da conexão, notConnected, e nenhuma sessão é aberta para verificar")]
    public async Task Verify_WithoutAnOpenSession_IsNotConnected()
    {
        //Arrange
        var other = new FakeConnection();
        var service = CreateService(other);
        await OpenAsync(service, Guid.CreateVersion7());

        //Act
        var verified = await service.VerifyAsync(VerifiedConnectionID, null, 0, CancellationToken.None);

        //Assert
        Assert.Equal(new ConnectionVerification(EVerificationStatus.NotConnected), verified);
        Assert.Empty(other.Verified);
    }

    /// <summary>A sessão aberta com as credenciais de outro cofre (a geração de antes) não responde pela conexão: ela está sendo fechada.</summary>
    [Trait("DatabaseSessionService", "VerifyAsync")]
    [Fact(DisplayName = "OK a sessão de outra geração do cofre não conta, e a resposta é notConnected")]
    public async Task Verify_OnlyCountsTheSessionsOfTheVaultGeneration()
    {
        //Arrange
        var connection = new FakeConnection();
        var service = CreateService(connection);
        await OpenAsync(service, VerifiedConnectionID);

        //Act
        var verified = await service.VerifyAsync(VerifiedConnectionID, null, 1, CancellationToken.None);

        //Assert
        Assert.Equal(EVerificationStatus.NotConnected, verified.Status);
        Assert.Empty(connection.Verified);
    }

    [Trait("DatabaseSessionService", "VerifyAsync")]
    [Fact(DisplayName = "OK a consulta responde, com o tempo, e a sessão fica como estava")]
    public async Task Verify_Ok()
    {
        //Arrange
        var connection = new FakeConnection();
        var service = CreateService(connection);
        var session = await OpenAsync(service, VerifiedConnectionID);

        //Act
        var verified = await service.VerifyAsync(VerifiedConnectionID, "SELECT 2", 0, CancellationToken.None);
        var afterwards = await service.GetDatabasesAsync(session.ID, CancellationToken.None);

        //Assert
        Assert.Equal(EVerificationStatus.Ok, verified.Status);
        Assert.NotNull(verified.ElapsedMs);
        Assert.Null(verified.Message);
        Assert.Equal(["SELECT 2"], connection.Verified);
        Assert.True(afterwards.IsSuccess);
        Assert.Equal(0, connection.CloseCursorCalls);
    }

    /// <summary>A falha do banco é a resposta, com a mensagem como veio; a sessão cuja conexão caiu sai do registro, e a verificação seguinte não a acha.</summary>
    [Trait("DatabaseSessionService", "VerifyAsync")]
    [Fact(DisplayName = "OK a falha do banco é failed com a mensagem e o SQLSTATE, e a sessão que caiu sai do registro")]
    public async Task Verify_Failed_RemovesTheSessionWhoseConnectionDropped()
    {
        //Arrange
        var connection = new FakeConnection { VerificationFailure = new DatabaseFailure(EDatabaseFailure.ConnectionFailed, "terminating connection due to administrator command", "57P01"), ClosesItselfOnVerify = true };
        var service = CreateService(connection);
        var session = await OpenAsync(service, VerifiedConnectionID);

        //Act
        var verified = await service.VerifyAsync(VerifiedConnectionID, null, 0, CancellationToken.None);
        var next = await service.VerifyAsync(VerifiedConnectionID, null, 0, CancellationToken.None);
        var afterwards = service.Cancel(session.ID);

        //Assert
        Assert.Equal(EVerificationStatus.Failed, verified.Status);
        Assert.Equal(("terminating connection due to administrator command", "57P01"), (verified.Message, verified.SqlState));
        Assert.NotNull(verified.ElapsedMs);
        Assert.Equal(EVerificationStatus.NotConnected, next.Status);
        Assert.Equal(EDatabaseFailure.SessionNotFound, afterwards.Error.Kind);
    }

    /// <summary>RN-SQL-007: a consulta fecharia o cursor da pessoa; com a única sessão nesse estado, ou com um comando rodando, a resposta é busy na hora.</summary>
    [Trait("DatabaseSessionService", "VerifyAsync")]
    [Fact(DisplayName = "OK com o cursor aberto ou com um comando rodando, busy na hora, sem tocar na sessão")]
    public async Task Verify_IsBusy_WithAnOpenCursorOrARunningCommand()
    {
        //Arrange
        var withCursor = new FakeConnection { HasOpenCursor = true };
        var running = new FakeConnection();
        var service = CreateService(withCursor, running);
        await OpenAsync(service, VerifiedConnectionID);
        var runningSession = await OpenAsync(service, VerifiedConnectionID);
        _ = service.ExecuteAsync(runningSession.ID, "SELECT pg_sleep(60)", CancellationToken.None);

        //Act
        var verified = await service.VerifyAsync(VerifiedConnectionID, null, 0, CancellationToken.None);

        //Assert
        Assert.Equal(new ConnectionVerification(EVerificationStatus.Busy), verified);
        Assert.Empty(withCursor.Verified);
        Assert.Empty(running.Verified);
        Assert.Equal(0, withCursor.CloseCursorCalls);
    }

    /// <summary>A sessão sem resultado (a da árvore) vem antes da de uma aba, mesmo aberta depois; a de uma aba sem cursor serve quando é a única livre.</summary>
    [Trait("DatabaseSessionService", "VerifyAsync")]
    [Fact(DisplayName = "OK a verificação vai na sessão sem resultado, e na de uma aba sem cursor quando é a que sobra")]
    public async Task Verify_PrefersTheSessionWithoutAResult()
    {
        //Arrange
        var tab = new FakeConnection();
        tab.Outcomes.Enqueue(FinishedPage());
        var tree = new FakeConnection();
        var service = CreateService(tab, tree);
        var tabSession = await OpenAsync(service, VerifiedConnectionID);
        var treeSession = await OpenAsync(service, VerifiedConnectionID);
        await service.ExecuteAsync(tabSession.ID, "SELECT 1", CancellationToken.None);

        //Act
        var first = await service.VerifyAsync(VerifiedConnectionID, null, 0, CancellationToken.None);
        await service.CloseAsync(treeSession.ID);
        var second = await service.VerifyAsync(VerifiedConnectionID, null, 0, CancellationToken.None);

        //Assert
        Assert.Equal(EVerificationStatus.Ok, first.Status);
        Assert.Equal(EVerificationStatus.Ok, second.Status);
        Assert.Single(tree.Verified);
        Assert.Single(tab.Verified);
    }

    /// <summary>
    /// A verificação não deixa a sessão ocupada para a pessoa: o comando que chega durante ela espera o fim dela, e não responde `SessionBusy`;
    /// o resultado da aba continua o dela.
    /// </summary>
    [Trait("DatabaseSessionService", "VerifyAsync")]
    [Fact(DisplayName = "OK o comando que chega durante a verificação espera o fim dela, em vez de ouvir que a sessão está ocupada")]
    public async Task Verify_TheCommandThatArrivesWaitsForIt()
    {
        //Arrange
        var connection = new FakeConnection { VerificationGate = new TaskCompletionSource() };
        connection.Outcomes.Enqueue(FinishedPage());
        var service = CreateService(connection);
        var session = await OpenAsync(service, VerifiedConnectionID);
        var verifying = service.VerifyAsync(VerifiedConnectionID, null, 0, CancellationToken.None);

        //Act
        var executing = service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);
        var executedDuringTheVerification = executing.IsCompleted || connection.Executed.Count > 0;
        connection.VerificationGate.SetResult();
        var verified = await verifying;
        var executed = await executing.WaitAsync(TimeSpan.FromSeconds(5));

        //Assert
        Assert.False(executedDuringTheVerification);
        Assert.Equal(EVerificationStatus.Ok, verified.Status);
        Assert.True(executed.IsSuccess);
        Assert.Equal(["SELECT 1"], connection.Executed);
    }

    /// <summary>
    /// RN-SQL-010: o "cancelar" pedido enquanto o comando espera a verificação faz o comando desistir na hora, sem ir ao banco e sem esperar o fim
    /// dela (que pode levar o prazo do driver); a verificação continua e termina. O comando seguinte roda normalmente.
    /// </summary>
    [Trait("DatabaseSessionService", "VerifyAsync")]
    [Fact(DisplayName = "OK cancelar o comando que espera a verificação o faz desistir na hora, sem ir ao banco, e a verificação não é interrompida")]
    public async Task Verify_CancelingTheWaitingCommand_GivesUpAtOnce()
    {
        //Arrange
        var connection = new FakeConnection { VerificationGate = new TaskCompletionSource() };
        connection.Outcomes.Enqueue(FinishedPage());
        var service = CreateService(connection);
        var session = await OpenAsync(service, VerifiedConnectionID);
        var verifying = service.VerifyAsync(VerifiedConnectionID, null, 0, CancellationToken.None);
        var executing = service.ExecuteAsync(session.ID, "DELETE FROM loja.pedido", CancellationToken.None);

        //Act
        var canceled = service.Cancel(session.ID);
        var executed = await executing.WaitAsync(TimeSpan.FromSeconds(5));
        var verificationRunning = !verifying.IsCompleted;
        connection.VerificationGate.SetResult();
        var verified = await verifying;
        var next = await service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);

        //Assert
        Assert.True(canceled.IsSuccess);
        Assert.Equal(0, connection.CancelCalls);
        Assert.True(executed.IsFailure);
        Assert.Equal((EDatabaseFailure.ExecutionFailed, ECancelOutcome.Canceled, "O comando foi cancelado antes de ir ao banco: nada foi executado."), (executed.Error.Kind, executed.Error.Outcome, executed.Error.Message));
        Assert.True(verificationRunning);
        Assert.Equal(EVerificationStatus.Ok, verified.Status);
        Assert.True(next.IsSuccess);
        Assert.Equal(["SELECT 1"], connection.Executed);
    }

    /// <summary>A sessão fechada enquanto o comando espera a verificação: ele responde na hora que ela não existe, e o fechamento espera o fim da verificação.</summary>
    [Trait("DatabaseSessionService", "VerifyAsync")]
    [Fact(DisplayName = "OK fechar a sessão enquanto o comando espera a verificação faz ele responder na hora que a sessão não existe")]
    public async Task Verify_ClosingTheSession_ReleasesTheWaitingCommandAtOnce()
    {
        //Arrange
        var connection = new FakeConnection { VerificationGate = new TaskCompletionSource() };
        var service = CreateService(connection);
        var session = await OpenAsync(service, VerifiedConnectionID);
        var verifying = service.VerifyAsync(VerifiedConnectionID, null, 0, CancellationToken.None);
        var executing = service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);

        //Act
        var closing = service.CloseAsync(session.ID);
        var executed = await executing.WaitAsync(TimeSpan.FromSeconds(5));
        var disposedBeforeTheVerificationEnded = connection.Disposed;
        connection.VerificationGate.SetResult();
        await verifying;
        var closed = await closing.WaitAsync(TimeSpan.FromSeconds(5));

        //Assert
        Assert.Equal(EDatabaseFailure.SessionNotFound, executed.Error.Kind);
        Assert.False(disposedBeforeTheVerificationEnded);
        Assert.True(closed.IsSuccess);
        Assert.True(connection.Disposed);
        Assert.Empty(connection.Executed);
    }

    /// <summary>A requisição abandonada enquanto o comando espera a verificação: ele desiste na hora, como o catálogo que desiste da vez, e não como cancelado.</summary>
    [Trait("DatabaseSessionService", "VerifyAsync")]
    [Fact(DisplayName = "OK a requisição abandonada enquanto o comando espera a verificação faz ele desistir na hora, sem ir ao banco")]
    public async Task Verify_AbandoningTheRequest_ReleasesTheWaitingCommandAtOnce()
    {
        //Arrange
        var connection = new FakeConnection { VerificationGate = new TaskCompletionSource() };
        var service = CreateService(connection);
        var session = await OpenAsync(service, VerifiedConnectionID);
        using var abandoned = new CancellationTokenSource();
        var verifying = service.VerifyAsync(VerifiedConnectionID, null, 0, CancellationToken.None);
        var executing = service.ExecuteAsync(session.ID, "SELECT 1", abandoned.Token);

        //Act
        await abandoned.CancelAsync();
        var executed = await executing.WaitAsync(TimeSpan.FromSeconds(5));
        var verificationRunning = !verifying.IsCompleted;
        connection.VerificationGate.SetResult();
        var verified = await verifying;

        //Assert
        Assert.Equal((EDatabaseFailure.ExecutionFailed, (ECancelOutcome?)null, "A operação foi cancelada antes de chegar a vez dela na sessão."), (executed.Error.Kind, executed.Error.Outcome, executed.Error.Message));
        Assert.True(verificationRunning);
        Assert.Equal(EVerificationStatus.Ok, verified.Status);
        Assert.Empty(connection.Executed);
    }

    /// <summary>RN-PROT-002: na conexão somente leitura o comando que não é leitura nem chega à conexão, e o resultado de antes continua.</summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "Erro na conexão somente leitura o que não é leitura é ConnectionReadOnly, sem ir à conexão nem tirar o resultado")]
    public async Task ExecuteReadOnly_ShouldRefuse_WhatIsNotARead()
    {
        //Arrange
        var connection = new FakeConnection();
        connection.Outcomes.Enqueue(FinishedPage());
        var service = CreateService(connection);
        var session = await OpenAsync(service, VerifiedConnectionID);
        var read = await service.ExecuteAsync(session.ID, "SELECT 1", null, QueryPaging.DefaultPageSize, true, CancellationToken.None);

        //Act
        var refused = await service.ExecuteAsync(session.ID, "UPDATE loja.pedido SET status = 'x'", null, QueryPaging.DefaultPageSize, true, CancellationToken.None);
        var cells = service.GetCells(session.ID, read.Value.Page!.ResultID!.Value, []);

        //Assert
        Assert.Equal(EDatabaseFailure.ConnectionReadOnly, refused.Error.Kind);
        Assert.Equal("A conexão é somente leitura, e só leituras são executadas nela: um UPDATE não é leitura. Nada foi enviado ao banco.", refused.Error.Message);
        Assert.False(refused.Error.Executed);
        Assert.Equal(["SELECT 1"], connection.ExecutedReadOnly);
        Assert.Empty(connection.Executed);
        Assert.True(cells.IsSuccess);
    }

    /// <summary>RN-PROT-002 e RN-EDIT-002: a leitura vai pelo caminho somente leitura da conexão, e o resultado inteiro é só leitura, com o motivo.</summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "OK na conexão somente leitura a leitura vai pelo caminho dela, e o resultado é só leitura com o motivo")]
    public async Task ExecuteReadOnly_ShouldRunTheReadAsReadOnly()
    {
        //Arrange
        var connection = new FakeConnection();
        connection.Outcomes.Enqueue(FinishedPage());
        connection.Outcomes.Enqueue(FinishedPage());
        var service = CreateService(connection);
        var session = await OpenAsync(service, VerifiedConnectionID);

        //Act
        var readOnly = await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido", "status = 'a'", QueryPaging.DefaultPageSize, true, CancellationToken.None);
        var common = await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido", null, QueryPaging.DefaultPageSize, false, CancellationToken.None);

        //Assert
        Assert.Equal(["SELECT * FROM loja.pedido WHERE (status = 'a')"], connection.ExecutedReadOnly);
        Assert.Equal(["SELECT * FROM loja.pedido"], connection.Executed);
        Assert.Equal(ResultEditability.ReadOnly("a conexão é somente leitura"), readOnly.Value.Page!.Editable);
        Assert.NotEqual(ResultEditability.ReadOnly("a conexão é somente leitura"), common.Value.Page!.Editable);
    }

    /// <summary>
    /// RN-PROT-002 e RN-SQL-007: a recusa do somente leitura não chega ao cursor aberto, que continua aberto, nem conta como leitura: ele fecha aos
    /// cinco minutos da última página, como fecharia sem ela, e não aos cinco minutos da recusa. Se a recusa desligasse o temporizador, o cursor (no
    /// PostgreSQL, a transação só de leitura) ficaria aberto até o comando seguinte.
    /// </summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "OK a recusa do somente leitura com o cursor aberto não o fecha nem o adia: ele fecha aos cinco minutos da última leitura")]
    public async Task ExecuteReadOnly_Refusal_KeepsTheCursorClosingFiveMinutesAfterTheLastRead()
    {
        //Arrange
        var clock = new FakeTimeProvider();
        var connection = new FakeConnection();
        connection.Outcomes.Enqueue(new QueryOutcome(OnePage(hasMore: true), null, 0));
        var service = new DatabaseSessionService([new QueueClient([connection])], _vault.Object, clock, Logger.None);
        var session = await OpenAsync(service, VerifiedConnectionID);
        await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido", null, QueryPaging.DefaultPageSize, true, CancellationToken.None);

        //Act
        clock.Advance(TimeSpan.FromMinutes(1));
        var refused = await service.ExecuteAsync(session.ID, "DELETE FROM loja.pedido", null, QueryPaging.DefaultPageSize, true, CancellationToken.None);
        var openAfterTheRefusal = connection.HasOpenCursor;
        clock.Advance(TimeSpan.FromMinutes(4) - TimeSpan.FromSeconds(1));
        var closedBeforeTheTime = connection.CloseCursorCalls;
        clock.Advance(TimeSpan.FromSeconds(1));
        var closedOnTime = connection.CloseCursorCalls;
        clock.Advance(TimeSpan.FromHours(3));

        //Assert
        Assert.Equal(EDatabaseFailure.ConnectionReadOnly, refused.Error.Kind);
        Assert.True(openAfterTheRefusal);
        Assert.Equal(0, closedBeforeTheTime);
        Assert.Equal(1, closedOnTime);
        Assert.Equal(1, connection.CloseCursorCalls);
        Assert.False(connection.HasOpenCursor);
    }

    /// <summary>
    /// RN-SQL-007: o aviso do temporizador que chega enquanto outra operação tem a vez desiste, contando com ela. Aqui ele não dispara (o relógio do
    /// teste não dispara nada sozinho), e a recusa que chega depois dos cinco minutos da última leitura confere o prazo ao terminar e fecha o cursor.
    /// </summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "OK a recusa do somente leitura depois dos cinco minutos sem leitura fecha o cursor ao terminar")]
    public async Task ExecuteReadOnly_Refusal_ClosesTheCursorWhoseTimeIsUp()
    {
        //Arrange
        var connection = new FakeConnection();
        connection.Outcomes.Enqueue(new QueryOutcome(OnePage(hasMore: true), null, 0));
        var service = CreateService(connection);
        var session = await OpenAsync(service, VerifiedConnectionID);
        await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido", null, QueryPaging.DefaultPageSize, true, CancellationToken.None);
        _clock.Advance(TimeSpan.FromMinutes(6));

        //Act
        var refused = await service.ExecuteAsync(session.ID, "UPDATE loja.pedido SET status = 'x'", null, QueryPaging.DefaultPageSize, true, CancellationToken.None);

        //Assert
        Assert.Equal(EDatabaseFailure.ConnectionReadOnly, refused.Error.Kind);
        Assert.Equal(1, connection.CloseCursorCalls);
        Assert.False(connection.HasOpenCursor);
        Assert.Equal(["SELECT * FROM loja.pedido"], connection.ExecutedReadOnly);
    }

    [Trait("DatabaseSessionService", "ConnectionOf")]
    [Fact(DisplayName = "OK a conexão da sessão aberta, e nula sem a sessão")]
    public async Task ConnectionOf_ShouldBeTheSessionConnection()
    {
        //Arrange
        var service = CreateService(new FakeConnection());
        var session = await OpenAsync(service, VerifiedConnectionID);

        //Act
        var open = service.ConnectionOf(session.ID);
        await service.CloseAsync(session.ID);
        var closed = service.ConnectionOf(session.ID);

        //Assert
        Assert.Equal(VerifiedConnectionID, open);
        Assert.Null(closed);
    }

    /// <summary>Um client que entrega uma conexão de mentira por abertura, na ordem: cada sessão com a sua.</summary>
    private sealed class QueueClient(IEnumerable<FakeConnection> connections) : IDatabaseClient
    {
        private readonly Queue<FakeConnection> _connections = new(connections);

        public EDatabaseEngine Engine => EDatabaseEngine.PostgreSql;

        public Task<Result<IDatabaseConnection, DatabaseFailure>> OpenAsync(ConnectionSettings settings, CancellationToken cancellationToken)
            => Task.FromResult(Result.Success<IDatabaseConnection, DatabaseFailure>(_connections.Dequeue()));
    }
}
