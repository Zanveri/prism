using CSharpFunctionalExtensions;
using FluentValidation.TestHelper;
using Moq;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Features.ExecuteQuery;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Text.Json;

namespace Prism.UnitTesting.DatabaseSessions;

/// <summary>
/// RN-AUDIT-001 a 003 e RN-HIST-002: a gravação das execuções SQL no diário, o retrato da conexão (com ambiente próprio ou herdado), a recusa pelo
/// somente leitura, o SQLSTATE e a mensagem do erro, a proteção dos valores dos parâmetros e a dedup da atualização automática.
/// </summary>
public sealed class ExecuteQueryJournalTests
{
    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();
    private readonly Mock<IVaultService> _vaultService = new();
    private readonly Mock<IJournalRecorder> _journal = new();
    private readonly List<JournalEntryStart> _starts = [];
    private readonly List<(long ID, JournalEntryEnd End)> _ends = [];
    private long _nextEntryID = 100;

    public ExecuteQueryJournalTests()
    {
        _journal.Setup(recorder => recorder.Begin(It.IsAny<JournalEntryStart>())).Callback((JournalEntryStart start) => _starts.Add(start)).Returns(() => ++_nextEntryID);
        _journal.Setup(recorder => recorder.Complete(It.IsAny<long>(), It.IsAny<JournalEntryEnd>())).Callback((long id, JournalEntryEnd end) => _ends.Add((id, end)));
    }

    private ExecuteQueryHandler CreateHandler()
        => new(_connectionQueries.Object, _databaseSessionService.Object, _vaultService.Object, _journal.Object);

    [Trait("ExecuteQueryHandler", "Journal")]
    [Fact(DisplayName = "OK grava Begin antes de ir ao banco e Complete no fim, com o nível, o motivo e o retrato da conexão")]
    public async Task Execute_RecordsBeginThenComplete_WithLevelReasonAndSnapshot()
    {
        //Arrange
        var sessionID = Guid.CreateVersion7();
        var scriptRunID = Guid.CreateVersion7();
        var connection = VaultFakers.CreateConnection(name: "MES Produção", engine: EDatabaseEngine.PostgreSql, database: "mes_prod", environmentName: "Produção", environmentColor: "red", confirmCommands: "irreversible", readOnly: false);
        _vaultService.Setup(vault => vault.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument { Connections = [connection] }));
        _databaseSessionService.Setup(service => service.ConnectionOf(sessionID)).Returns(connection.ID);
        _databaseSessionService.Setup(service => service.InfoOf(sessionID)).Returns(new DatabaseSessionInfo(sessionID, connection.ID, EDatabaseEngine.PostgreSql, "mes_prod", "16.2"));
        _connectionQueries.Setup(queries => queries.IsReadOnly(connection.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<bool?, EVaultError>(false));
        _databaseSessionService.Setup(service => service.ExecuteAsync(sessionID, "DELETE FROM producao.apontamento_tmp", null, QueryPaging.DefaultPageSize, false, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<IReadOnlyList<QueryParameter>>(), It.IsAny<CancellationToken>()))
            .Callback(() => Assert.Single(_starts))
            .ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 1204, 18)));

        //Act
        var result = await CreateHandler().Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = "DELETE FROM producao.apontamento_tmp", Origin = "editor", HistoryText = "DELETE FROM producao.apontamento_tmp;", Confirmed = true, ScriptRunID = scriptRunID }, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        var start = Assert.Single(_starts);
        Assert.Equal((EJournalKind.Sql, "DELETE", EJournalLevel.Critical, "DELETE sem WHERE: apaga todas as linhas de producao.apontamento_tmp.", "editor", true, scriptRunID), (start.Kind, start.Action, start.Level, start.Reason, start.Origin, start.Confirmed, start.ScriptRunId));
        Assert.Equal("DELETE FROM producao.apontamento_tmp", start.Sql);
        Assert.Equal("DELETE FROM producao.apontamento_tmp;", start.HistoryText);
        Assert.Equal(new JournalConnectionSnapshot(connection.ID, "MES Produção", "PostgreSQL", null, "Produção", "red", "mes_prod"), start.Connection);
        Assert.Equal("Confirmar: só irreversíveis · Somente leitura: não", start.Protections);

        var (id, end) = Assert.Single(_ends);
        Assert.Equal(101, id);
        Assert.Equal(new JournalEntryEnd(EJournalOutcome.Ok, 1204, null, null, null), end);
    }

    [Trait("ExecuteQueryHandler", "Journal")]
    [Fact(DisplayName = "OK o ambiente e o somente leitura herdados da pasta entram no retrato da execução")]
    public async Task Execute_InheritedEnvironment_IsSnapshotted()
    {
        //Arrange
        var sessionID = Guid.CreateVersion7();
        var rootFolder = VaultFakers.CreateFolder(name: "Fábrica", environmentName: "Produção", environmentColor: "red", readOnly: true, confirmCommands: "all");
        var childFolder = VaultFakers.CreateFolder(name: "Turno A", parentID: rootFolder.ID);
        var connection = VaultFakers.CreateConnection(name: "Coleta", folderID: childFolder.ID, engine: EDatabaseEngine.Informix, database: "coleta_db", environmentName: null, environmentColor: null, readOnly: false, confirmCommands: null);
        _vaultService.Setup(vault => vault.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument { Folders = [rootFolder, childFolder], Connections = [connection] }));
        _databaseSessionService.Setup(service => service.ConnectionOf(sessionID)).Returns(connection.ID);
        _databaseSessionService.Setup(service => service.InfoOf(sessionID)).Returns(new DatabaseSessionInfo(sessionID, connection.ID, EDatabaseEngine.Informix, "coleta_db", "14.10"));
        _connectionQueries.Setup(queries => queries.IsReadOnly(connection.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<bool?, EVaultError>(true));
        _databaseSessionService.Setup(service => service.ExecuteAsync(sessionID, "SELECT * FROM ordens", null, QueryPaging.DefaultPageSize, true, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<IReadOnlyList<QueryParameter>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(new QueryPage([new QueryColumn("id", "integer", "number")], [["1"], ["2"]], false, 4, [], 2, Guid.CreateVersion7(), ResultEditability.ReadOnly("a conexão é somente leitura")), null, 4)));

        //Act
        var result = await CreateHandler().Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = "SELECT * FROM ordens", Origin = "editor" }, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        var start = Assert.Single(_starts);
        Assert.Equal(new JournalConnectionSnapshot(connection.ID, "Coleta", "Informix", "Fábrica / Turno A", "Produção", "red", "coleta_db"), start.Connection);
        Assert.Equal("Confirmar: todos os comandos · Somente leitura: sim", start.Protections);
        Assert.Equal(new JournalEntryEnd(EJournalOutcome.Ok, 2, null, null, null), Assert.Single(_ends).End);
    }

    [Trait("ExecuteQueryHandler", "Journal")]
    [Fact(DisplayName = "OK o comando recusado pelo somente leitura fica gravado como Refused")]
    public async Task Execute_ReadOnlyRefusal_RecordsRefused()
    {
        //Arrange
        var sessionID = Guid.CreateVersion7();
        var connection = VaultFakers.CreateConnection(name: "ERP Informix", engine: EDatabaseEngine.Informix, database: "erp", readOnly: true);
        _vaultService.Setup(vault => vault.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument { Connections = [connection] }));
        _databaseSessionService.Setup(service => service.ConnectionOf(sessionID)).Returns(connection.ID);
        _databaseSessionService.Setup(service => service.InfoOf(sessionID)).Returns(new DatabaseSessionInfo(sessionID, connection.ID, EDatabaseEngine.Informix, "erp", "14.10"));
        _connectionQueries.Setup(queries => queries.IsReadOnly(connection.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<bool?, EVaultError>(true));
        const string refusal = "A conexão é somente leitura: TRUNCATE altera ou apaga dados. Nada foi enviado ao banco.";
        _databaseSessionService.Setup(service => service.ExecuteAsync(sessionID, "TRUNCATE TABLE producao.log_coleta", null, QueryPaging.DefaultPageSize, true, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<IReadOnlyList<QueryParameter>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<QueryOutcome, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ConnectionReadOnly, refusal)));

        //Act
        var result = await CreateHandler().Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = "TRUNCATE TABLE producao.log_coleta", Origin = "editor" }, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        var start = Assert.Single(_starts);
        Assert.Equal((EJournalLevel.Critical, "TRUNCATE"), (start.Level, start.Action));
        Assert.Equal(new JournalEntryEnd(EJournalOutcome.Refused, null, "CONNECTION_READ_ONLY", null, refusal), Assert.Single(_ends).End);
    }

    [Trait("ExecuteQueryHandler", "Journal")]
    [Fact(DisplayName = "OK o erro do banco fica gravado com o código, o SQLSTATE e a mensagem")]
    public async Task Execute_Error_RecordsSqlStateAndMessage()
    {
        //Arrange
        var sessionID = Guid.CreateVersion7();
        var connection = VaultFakers.CreateConnection(name: "MES Produção", engine: EDatabaseEngine.PostgreSql, database: "mes_prod");
        _vaultService.Setup(vault => vault.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument { Connections = [connection] }));
        _databaseSessionService.Setup(service => service.ConnectionOf(sessionID)).Returns(connection.ID);
        _databaseSessionService.Setup(service => service.InfoOf(sessionID)).Returns(new DatabaseSessionInfo(sessionID, connection.ID, EDatabaseEngine.PostgreSql, "mes_prod", "16.2"));
        _connectionQueries.Setup(queries => queries.IsReadOnly(connection.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<bool?, EVaultError>(false));
        _databaseSessionService.Setup(service => service.ExecuteAsync(sessionID, "DROP INDEX ix_apont_ordem", null, QueryPaging.DefaultPageSize, false, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<IReadOnlyList<QueryParameter>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<QueryOutcome, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "ERROR: index \"ix_apont_ordem\" does not exist", SqlState: "42704")));

        //Act
        var result = await CreateHandler().Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = "DROP INDEX ix_apont_ordem", Origin = "editor" }, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(new JournalEntryEnd(EJournalOutcome.Error, null, "SQL_EXECUTION_FAILED", "42704", "ERROR: index \"ix_apont_ordem\" does not exist"), Assert.Single(_ends).End);
    }

    [Trait("ExecuteQueryHandler", "Journal")]
    [Fact(DisplayName = "OK os valores dos parâmetros nunca entram no registro do diário")]
    public async Task Execute_Params_ValuesNeverRecorded()
    {
        //Arrange
        var sessionID = Guid.CreateVersion7();
        const string secretValue = "segredo-super-confidencial-998877";
        var parameters = JsonDocument.Parse($"[{{\"type\":\"text\",\"value\":\"{secretValue}\"}}]").RootElement.Clone();
        _databaseSessionService.Setup(service => service.ExecuteAsync(sessionID, "SELECT * FROM usuarios WHERE cpf = $1", null, QueryPaging.DefaultPageSize, false, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<IReadOnlyList<QueryParameter>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 1, 5)));

        //Act
        var result = await CreateHandler().Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = "SELECT * FROM usuarios WHERE cpf = $1", HistoryText = "SELECT * FROM usuarios WHERE cpf = @cpf", Origin = "values", Params = parameters }, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        var start = Assert.Single(_starts);
        Assert.DoesNotContain(secretValue, start.Sql ?? string.Empty);
        Assert.DoesNotContain(secretValue, start.HistoryText ?? string.Empty);
        Assert.DoesNotContain(secretValue, start.Reason);
    }

    [Trait("ExecuteQueryValidator", "Journal")]
    [Fact(DisplayName = "Erro a origem fora da lista e o historyText acima de 256 KiB são recusados com QUERY_INVALID no campo")]
    public void Validator_UnknownOrigin_IsQueryInvalid()
    {
        //Arrange
        var validator = new ExecuteQueryValidator(_databaseSessionService.Object);
        var hugeHistory = new string('A', (256 * 1024) + 1);

        //Act
        var unknownOrigin = validator.TestValidate(new ExecuteQueryCommand { Sql = "SELECT 1", Origin = "terminal" });
        var tooLargeHistory = validator.TestValidate(new ExecuteQueryCommand { Sql = "SELECT 1", Origin = "editor", HistoryText = hugeHistory });
        var validOrigins = new[] { null, "editor", "script", "values", "statement", "rerun", "filter", "auto-refresh", "other" }
            .Select(origin => validator.TestValidate(new ExecuteQueryCommand { Sql = "SELECT 1", Origin = origin, HistoryText = "SELECT @id" }));

        //Assert
        unknownOrigin.ShouldHaveValidationErrorFor(command => command.Origin).WithErrorCode("QUERY_INVALID");
        tooLargeHistory.ShouldHaveValidationErrorFor(command => command.HistoryText).WithErrorCode("QUERY_INVALID");
        Assert.All(validOrigins, validation => validation.ShouldNotHaveAnyValidationErrors());
    }

    [Trait("ExecuteQueryHandler", "Journal")]
    [Fact(DisplayName = "OK o auto-refresh grava só a primeira execução e quando o comando muda")]
    public async Task AutoRefresh_RecordsOnlyFirstAndChanged()
    {
        //Arrange
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(service => service.ExecuteAsync(sessionID, It.IsAny<string>(), It.IsAny<string?>(), QueryPaging.DefaultPageSize, false, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<IReadOnlyList<QueryParameter>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 1, 3)));

        //Act
        await CreateHandler().Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = "SELECT count(*) FROM fila", Origin = "auto-refresh" }, CancellationToken.None);
        await CreateHandler().Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = "SELECT count(*) FROM fila", Origin = "auto-refresh" }, CancellationToken.None);
        await CreateHandler().Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = "SELECT count(*) FROM fila WHERE status = 'pendente'", Origin = "auto-refresh" }, CancellationToken.None);
        await CreateHandler().Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = "SELECT count(*) FROM fila WHERE status = 'pendente'", Origin = "auto-refresh" }, CancellationToken.None);

        //Assert
        Assert.Equal(2, _starts.Count);
        Assert.Equal(["SELECT count(*) FROM fila", "SELECT count(*) FROM fila WHERE status = 'pendente'"], _starts.Select(start => start.Sql));
    }

    [Trait("ExecuteQueryCommand", "Journal")]
    [Fact(DisplayName = "OK o ToString do comando não vaza o SQL nem o historyText")]
    public void ToString_DoesNotLeakSql()
    {
        //Arrange
        var command = new ExecuteQueryCommand { Sql = "SELECT senha FROM segredo", HistoryText = "SELECT @senha FROM segredo", Origin = "editor" };

        //Act & Assert
        Assert.Equal(nameof(ExecuteQueryCommand), command.ToString());
    }
}
