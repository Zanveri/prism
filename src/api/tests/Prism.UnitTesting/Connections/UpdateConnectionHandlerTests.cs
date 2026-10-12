using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Moq;
using Prism.Application.Connections.Domain;
using Prism.Application.Connections.Features.UpdateConnection;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Queries;
using Prism.Application.Connections.Repositories;
using Prism.Application.Folders.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Fakers.Connections;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Connections;

public sealed class UpdateConnectionHandlerTests
{
    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IConnectionRepository> _connectionRepository = new();
    private readonly FakeTimeProvider _timeProvider = new(new DateTimeOffset(2026, 10, 9, 12, 0, 0, TimeSpan.Zero));

    private static Result<VaultConnectionRecord?, EVaultError> Found(VaultConnectionRecord record)
        => Result.Success<VaultConnectionRecord?, EVaultError>(record);

    /// <summary>RN-CONN-004: sem senha no pedido, a gravada segue valendo.</summary>
    [Trait("UpdateConnectionHandler", "UpdateConnectionCommand")]
    [Fact(DisplayName = "OK senha omitida mantém a gravada, e a criação também")]
    public async Task Handle_ShouldBeOK_WithoutPassword()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var stored = VaultFakers.CreateConnection(password: "senha-gravada");
        var folderID = Guid.CreateVersion7();
        var command = ConnectionFakers.ReturnUpdateConnectionCommandValid(iD: stored.ID, folderID: folderID, name: "  Novo   Nome ", engine: EDatabaseEngine.Db2, host: " db2.local ", port: 50000, environmentName: "Homologação", environmentColor: "#00FF00");
        Connection? updated = null;
        _connectionQueries.Setup(q => q.GetRecordByID(stored.ID, cancellationToken)).ReturnsAsync(Found(stored));
        _connectionRepository.Setup(r => r.Update(It.IsAny<Connection>(), null, cancellationToken)).Callback<Connection, string?, CancellationToken>((connection, _, _) => updated = connection).ReturnsAsync(UnitResult.Success<ApiErrorDto>());
        var handler = new UpdateConnectionHandler(_connectionQueries.Object, _connectionRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(updated);
        Assert.Equal(stored.ID, updated.ID);
        Assert.Equal("senha-gravada", updated.Password);
        Assert.Equal(stored.CreatedAt, updated.CreatedAt);
        Assert.Equal(_timeProvider.GetUtcNow().UtcDateTime, updated.UpdatedAt);
        Assert.Equal(folderID, updated.FolderID);
        Assert.Equal("Novo Nome", updated.Name);
        Assert.Equal(EDatabaseEngine.Db2, updated.Engine);
        Assert.Equal("db2.local", updated.Host);
        Assert.Equal(50000, updated.Port);
        Assert.Equal("Homologação", updated.EnvironmentName);
        Assert.Equal(stored.ID, result.Value.ID);
        Assert.Equal("Novo Nome", result.Value.Name);
        Assert.True(result.Value.HasPassword);
        Assert.Equal(stored.CreatedAt, result.Value.CreatedAt);
        _connectionQueries.Verify(q => q.GetRecordByID(stored.ID, cancellationToken), Times.Once);
        _connectionRepository.Verify(r => r.Update(updated, null, cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _connectionRepository.VerifyNoOtherCalls();
    }

    [Trait("UpdateConnectionHandler", "UpdateConnectionCommand")]
    [Fact(DisplayName = "OK senha enviada troca a gravada")]
    public async Task Handle_ShouldBeOK_WithPassword()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var stored = VaultFakers.CreateConnection(password: "senha-gravada");
        var command = ConnectionFakers.ReturnUpdateConnectionCommandValid(iD: stored.ID, password: "senha-nova");
        Connection? updated = null;
        _connectionQueries.Setup(q => q.GetRecordByID(stored.ID, cancellationToken)).ReturnsAsync(Found(stored));
        _connectionRepository.Setup(r => r.Update(It.IsAny<Connection>(), "senha-nova", cancellationToken)).Callback<Connection, string?, CancellationToken>((connection, _, _) => updated = connection).ReturnsAsync(UnitResult.Success<ApiErrorDto>());
        var handler = new UpdateConnectionHandler(_connectionQueries.Object, _connectionRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("senha-nova", updated!.Password);
        _connectionQueries.Verify(q => q.GetRecordByID(stored.ID, cancellationToken), Times.Once);
        _connectionRepository.Verify(r => r.Update(updated, "senha-nova", cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _connectionRepository.VerifyNoOtherCalls();
    }

    /// <summary>O cofre fechou entre a barreira e a leitura: a consulta carrega a falha, e a resposta é 401, e não 404.</summary>
    [Trait("UpdateConnectionHandler", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro cofre fechado na leitura")]
    public async Task Handle_ShouldBeError_ConnectionQueries_GetRecordByID_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = ConnectionFakers.ReturnUpdateConnectionCommandValid();
        _connectionQueries.Setup(q => q.GetRecordByID(command.ID, cancellationToken)).ReturnsAsync(Result.Failure<VaultConnectionRecord?, EVaultError>(EVaultError.Locked));
        var handler = new UpdateConnectionHandler(_connectionQueries.Object, _connectionRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _connectionQueries.Verify(q => q.GetRecordByID(command.ID, cancellationToken), Times.Once);
        _connectionRepository.Verify(r => r.Update(It.IsAny<Connection>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
        _connectionQueries.VerifyNoOtherCalls();
        _connectionRepository.VerifyNoOtherCalls();
    }

    [Trait("UpdateConnectionHandler", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro conexão não existe")]
    public async Task Handle_ShouldBeError_ConnectionQueries_GetRecordByID_NotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = ConnectionFakers.ReturnUpdateConnectionCommandValid();
        _connectionQueries.Setup(q => q.GetRecordByID(command.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(null));
        var handler = new UpdateConnectionHandler(_connectionQueries.Object, _connectionRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _connectionQueries.Verify(q => q.GetRecordByID(command.ID, cancellationToken), Times.Once);
        _connectionRepository.Verify(r => r.Update(It.IsAny<Connection>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
        _connectionQueries.VerifyNoOtherCalls();
        _connectionRepository.VerifyNoOtherCalls();
    }

    [Trait("UpdateConnectionHandler", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro nome já existe na pasta, dito pela gravação")]
    public async Task Handle_ShouldBeError_ConnectionRepository_Update_AlreadyExists()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var stored = VaultFakers.CreateConnection();
        var command = ConnectionFakers.ReturnUpdateConnectionCommandValid(iD: stored.ID);
        _connectionQueries.Setup(q => q.GetRecordByID(stored.ID, cancellationToken)).ReturnsAsync(Found(stored));
        _connectionRepository.Setup(r => r.Update(It.IsAny<Connection>(), null, cancellationToken)).ReturnsAsync(UnitResult.Failure(ConnectionErrors.AlreadyExists(command.Name)));
        var handler = new UpdateConnectionHandler(_connectionQueries.Object, _connectionRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_ALREADY_EXISTS", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _connectionQueries.Verify(q => q.GetRecordByID(stored.ID, cancellationToken), Times.Once);
        _connectionRepository.Verify(r => r.Update(It.IsAny<Connection>(), null, cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _connectionRepository.VerifyNoOtherCalls();
    }

    [Trait("UpdateConnectionHandler", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro pasta não existe, dita pela gravação")]
    public async Task Handle_ShouldBeError_ConnectionRepository_Update_FolderNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var stored = VaultFakers.CreateConnection();
        var folderID = Guid.CreateVersion7();
        var command = ConnectionFakers.ReturnUpdateConnectionCommandValid(iD: stored.ID, folderID: folderID);
        _connectionQueries.Setup(q => q.GetRecordByID(stored.ID, cancellationToken)).ReturnsAsync(Found(stored));
        _connectionRepository.Setup(r => r.Update(It.IsAny<Connection>(), null, cancellationToken)).ReturnsAsync(UnitResult.Failure(FolderErrors.NotFound(folderID)));
        var handler = new UpdateConnectionHandler(_connectionQueries.Object, _connectionRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _connectionQueries.Verify(q => q.GetRecordByID(stored.ID, cancellationToken), Times.Once);
        _connectionRepository.Verify(r => r.Update(It.Is<Connection>(connection => connection.FolderID == folderID), null, cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _connectionRepository.VerifyNoOtherCalls();
    }
}
