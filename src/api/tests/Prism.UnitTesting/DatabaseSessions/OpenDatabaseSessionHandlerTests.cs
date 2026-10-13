using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Features.OpenDatabaseSession;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class OpenDatabaseSessionHandlerTests
{
    private const long Generation = 7;

    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();
    private readonly Mock<IVaultService> _vaultService = new();

    private OpenDatabaseSessionHandler CreateHandler()
        => new(_connectionQueries.Object, _databaseSessionService.Object, _vaultService.Object);

    [Trait("OpenDatabaseSessionHandler", "OpenDatabaseSessionCommand")]
    [Fact(DisplayName = "OK abre a sessão com as credenciais do cofre, a geração lida antes delas e a conexão conferida de novo depois")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection(password: "senha-do-banco", engine: EDatabaseEngine.PostgreSql);
        var settings = new ConnectionSettings(record.Engine, record.Host, record.Port, record.Database, record.UserName, record.Password);
        var info = new DatabaseSessionInfo(Guid.CreateVersion7(), record.ID, EDatabaseEngine.PostgreSql, record.Database, "PostgreSQL 18.0");
        var calls = new List<string>();
        _vaultService.SetupGet(v => v.Generation).Callback(() => calls.Add("Generation")).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).Callback(() => calls.Add("GetRecordByID")).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));
        _databaseSessionService.Setup(s => s.OpenAsync(record.ID, settings, Generation, cancellationToken)).Callback(() => calls.Add("OpenAsync")).ReturnsAsync(Result.Success<DatabaseSessionInfo, DatabaseFailure>(info));

        //Act
        var result = await CreateHandler().Handle(new OpenDatabaseSessionCommand { ConnectionID = record.ID }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(new DatabaseSessionDto { ID = info.ID, ConnectionID = record.ID, Engine = EDatabaseEngine.PostgreSql, Database = record.Database, ServerVersion = "PostgreSQL 18.0" }, result.Value);
        // A regra da geração: lida ANTES das credenciais, e a mesma vai ao registro de sessões.
        // A conexão é lida de novo depois de a sessão abrir: se a exclusão terminou no meio, a sessão não estava no registro para ser fechada por ela.
        Assert.Equal(["Generation", "GetRecordByID", "OpenAsync", "GetRecordByID"], calls);
        _vaultService.VerifyGet(v => v.Generation, Times.Once);
        _connectionQueries.Verify(q => q.GetRecordByID(record.ID, cancellationToken), Times.Exactly(2));
        _databaseSessionService.Verify(s => s.OpenAsync(record.ID, settings, Generation, cancellationToken), Times.Once);
        _vaultService.VerifyNoOtherCalls();
        _connectionQueries.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>RN-ARVORE-006: outro banco do mesmo servidor abre com as credenciais da conexão e o nome dele no lugar do banco dela.</summary>
    [Trait("OpenDatabaseSessionHandler", "OpenDatabaseSessionCommand")]
    [Fact(DisplayName = "OK abre a sessão de outro banco do servidor com as credenciais da conexão")]
    public async Task Handle_ShouldBeOK_OtherDatabase()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection(password: "senha-do-banco", engine: EDatabaseEngine.Informix);
        var settings = new ConnectionSettings(record.Engine, record.Host, record.Port, "sysmaster", record.UserName, record.Password);
        var info = new DatabaseSessionInfo(Guid.CreateVersion7(), record.ID, EDatabaseEngine.Informix, "sysmaster", "IDS/UNIX64 14.10");
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));
        _databaseSessionService.Setup(s => s.OpenAsync(record.ID, settings, Generation, cancellationToken)).ReturnsAsync(Result.Success<DatabaseSessionInfo, DatabaseFailure>(info));

        //Act
        var result = await CreateHandler().Handle(new OpenDatabaseSessionCommand { ConnectionID = record.ID, Database = "sysmaster" }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("sysmaster", result.Value.Database);
        _databaseSessionService.Verify(s => s.OpenAsync(record.ID, settings, Generation, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("OpenDatabaseSessionHandler", "OpenDatabaseSessionCommand")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Handle_ShouldBeError_ConnectionQueries_GetRecordByID_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var id = Guid.CreateVersion7();
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(id, cancellationToken)).ReturnsAsync(Result.Failure<VaultConnectionRecord?, EVaultError>(EVaultError.Locked));

        //Act
        var result = await CreateHandler().Handle(new OpenDatabaseSessionCommand { ConnectionID = id }, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.OpenAsync(It.IsAny<Guid>(), It.IsAny<ConnectionSettings>(), It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
        _connectionQueries.Verify(q => q.GetRecordByID(id, cancellationToken), Times.Once);
        _vaultService.VerifyGet(v => v.Generation, Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _vaultService.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("OpenDatabaseSessionHandler", "OpenDatabaseSessionCommand")]
    [Fact(DisplayName = "Erro conexão não existe")]
    public async Task Handle_ShouldBeError_ConnectionQueries_GetRecordByID_NotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var id = Guid.CreateVersion7();
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(id, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(null));

        //Act
        var result = await CreateHandler().Handle(new OpenDatabaseSessionCommand { ConnectionID = id }, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.OpenAsync(It.IsAny<Guid>(), It.IsAny<ConnectionSettings>(), It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
        _connectionQueries.Verify(q => q.GetRecordByID(id, cancellationToken), Times.Once);
        _vaultService.VerifyGet(v => v.Generation, Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _vaultService.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>
    /// RN-CONN-014: a exclusão termina enquanto a conexão ainda abre. O `CloseByConnectionAsync` dela não acha a sessão (ainda não está no
    /// registro) e a sessão se registraria depois, órfã de uma conexão que não existe mais. O serviço falso faz a exclusão acontecer DENTRO
    /// do `OpenAsync`: a segunda leitura já não acha a conexão, e a sessão é fechada.
    /// </summary>
    [Trait("OpenDatabaseSessionHandler", "OpenDatabaseSessionCommand")]
    [Fact(DisplayName = "Erro a conexão foi excluída enquanto a sessão abria: a sessão é fechada")]
    public async Task Handle_ShouldBeError_ConnectionQueries_GetRecordByID_DeletedWhileOpening()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection();
        var info = new DatabaseSessionInfo(Guid.CreateVersion7(), record.ID, EDatabaseEngine.PostgreSql, record.Database, "PostgreSQL 18.0");
        var deleted = false;
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(() => Result.Success<VaultConnectionRecord?, EVaultError>(deleted ? null : record));
        _databaseSessionService.Setup(s => s.OpenAsync(record.ID, It.IsAny<ConnectionSettings>(), Generation, cancellationToken)).Callback(() => deleted = true).ReturnsAsync(Result.Success<DatabaseSessionInfo, DatabaseFailure>(info));
        _databaseSessionService.Setup(s => s.CloseAsync(info.ID)).ReturnsAsync(UnitResult.Success<DatabaseFailure>());

        //Act
        var result = await CreateHandler().Handle(new OpenDatabaseSessionCommand { ConnectionID = record.ID }, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.CloseAsync(info.ID), Times.Once);
        _connectionQueries.Verify(q => q.GetRecordByID(record.ID, cancellationToken), Times.Exactly(2));
        _vaultService.VerifyGet(v => v.Generation, Times.Once);
        _databaseSessionService.Verify(s => s.OpenAsync(record.ID, It.IsAny<ConnectionSettings>(), Generation, cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _vaultService.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>O cofre fechou entre o registro da sessão e a segunda leitura: o aviso do cofre já tirou a sessão do registro, e quem pediu recebe o mesmo 401 do cofre fechado.</summary>
    [Trait("OpenDatabaseSessionHandler", "OpenDatabaseSessionCommand")]
    [Fact(DisplayName = "Erro o cofre fechou enquanto a sessão abria: a sessão é fechada")]
    public async Task Handle_ShouldBeError_ConnectionQueries_GetRecordByID_LockedWhileOpening()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection();
        var info = new DatabaseSessionInfo(Guid.CreateVersion7(), record.ID, EDatabaseEngine.PostgreSql, record.Database, "PostgreSQL 18.0");
        var locked = false;
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(() => locked ? Result.Failure<VaultConnectionRecord?, EVaultError>(EVaultError.Locked) : Result.Success<VaultConnectionRecord?, EVaultError>(record));
        _databaseSessionService.Setup(s => s.OpenAsync(record.ID, It.IsAny<ConnectionSettings>(), Generation, cancellationToken)).Callback(() => locked = true).ReturnsAsync(Result.Success<DatabaseSessionInfo, DatabaseFailure>(info));
        _databaseSessionService.Setup(s => s.CloseAsync(info.ID)).ReturnsAsync(UnitResult.Success<DatabaseFailure>());

        //Act
        var result = await CreateHandler().Handle(new OpenDatabaseSessionCommand { ConnectionID = record.ID }, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.CloseAsync(info.ID), Times.Once);
    }

    [Trait("OpenDatabaseSessionHandler", "OpenDatabaseSessionCommand")]
    [Fact(DisplayName = "Erro o banco recusou a conexão, com a mensagem dele")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_OpenAsync_ConnectionFailed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection();
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));
        _databaseSessionService.Setup(s => s.OpenAsync(record.ID, It.IsAny<ConnectionSettings>(), Generation, cancellationToken)).ReturnsAsync(Result.Failure<DatabaseSessionInfo, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ConnectionFailed, "password authentication failed for user \"operador\"", "28P01")));

        //Act
        var result = await CreateHandler().Handle(new OpenDatabaseSessionCommand { ConnectionID = record.ID }, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_CONNECTION_FAILED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("password authentication failed for user \"operador\"", result.Error.Detail);
        _connectionQueries.Verify(q => q.GetRecordByID(record.ID, cancellationToken), Times.Once);
        _vaultService.VerifyGet(v => v.Generation, Times.Once);
        _databaseSessionService.Verify(s => s.OpenAsync(record.ID, It.IsAny<ConnectionSettings>(), Generation, cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
        _vaultService.VerifyNoOtherCalls();
    }

    /// <summary>O cofre mudou entre a leitura das credenciais e a conexão ficar pronta: o registro de sessões não registra, e a rota responde como cofre fechado.</summary>
    [Trait("OpenDatabaseSessionHandler", "OpenDatabaseSessionCommand")]
    [Fact(DisplayName = "Erro o cofre mudou enquanto a sessão abria")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_OpenAsync_VaultChanged()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection();
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));
        _databaseSessionService.Setup(s => s.OpenAsync(record.ID, It.IsAny<ConnectionSettings>(), Generation, cancellationToken)).ReturnsAsync(Result.Failure<DatabaseSessionInfo, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.VaultChanged, "O cofre mudou enquanto a sessão era aberta.")));

        //Act
        var result = await CreateHandler().Handle(new OpenDatabaseSessionCommand { ConnectionID = record.ID }, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _connectionQueries.Verify(q => q.GetRecordByID(record.ID, cancellationToken), Times.Once);
        _vaultService.VerifyGet(v => v.Generation, Times.Once);
        _databaseSessionService.Verify(s => s.OpenAsync(record.ID, It.IsAny<ConnectionSettings>(), Generation, cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
        _vaultService.VerifyNoOtherCalls();
    }
}
