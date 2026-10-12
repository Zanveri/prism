using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Moq;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Domain;
using Prism.Application.Connections.Features.CreateConnection;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Repositories;
using Prism.Application.Folders.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Fakers.Connections;
using System.Net;

namespace Prism.UnitTesting.Connections;

public sealed class CreateConnectionHandlerTests
{
    private readonly Mock<IConnectionRepository> _connectionRepository = new();
    private readonly FakeTimeProvider _timeProvider = new(new DateTimeOffset(2026, 10, 9, 12, 0, 0, TimeSpan.Zero));

    [Trait("CreateConnectionHandler", "CreateConnectionCommand")]
    [Fact(DisplayName = "OK grava a conexão normalizada, com a senha, e responde sem ela")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var folderID = Guid.CreateVersion7();
        var command = ConnectionFakers.ReturnCreateConnectionCommandValid(folderID: folderID, name: "  Produção   Sul ", engine: EDatabaseEngine.Informix, host: " ifx.local ", port: 9089, password: "segredo", environmentName: "Produção", environmentColor: "#FF0000");
        Connection? inserted = null;
        _connectionRepository.Setup(r => r.Insert(It.IsAny<Connection>(), cancellationToken)).Callback<Connection, CancellationToken>((connection, _) => inserted = connection).ReturnsAsync(UnitResult.Success<ApiErrorDto>());
        var handler = new CreateConnectionHandler(_connectionRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(inserted);
        Assert.Equal(folderID, inserted.FolderID);
        Assert.Equal("Produção Sul", inserted.Name);
        Assert.Equal(EDatabaseEngine.Informix, inserted.Engine);
        Assert.Equal("ifx.local", inserted.Host);
        Assert.Equal(9089, inserted.Port);
        Assert.Equal("segredo", inserted.Password);
        Assert.Equal(_timeProvider.GetUtcNow().UtcDateTime, inserted.CreatedAt);
        Assert.Equal(inserted.CreatedAt, inserted.UpdatedAt);
        Assert.Equal(inserted.ID, result.Value.ID);
        Assert.Equal("Produção Sul", result.Value.Name);
        Assert.Equal("ifx.local", result.Value.Host);
        Assert.True(result.Value.HasPassword);
        Assert.Equal("#FF0000", result.Value.EnvironmentColor);
        _connectionRepository.Verify(r => r.Insert(inserted, cancellationToken), Times.Once);
        _connectionRepository.VerifyNoOtherCalls();
    }

    /// <summary>Quem diz que a pasta não existe é a gravação: a consulta que não leu o cofre não decide um 404.</summary>
    [Trait("CreateConnectionHandler", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro pasta não existe, dito pela gravação")]
    public async Task Handle_ShouldBeError_ConnectionRepository_Insert_FolderNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var folderID = Guid.CreateVersion7();
        var command = ConnectionFakers.ReturnCreateConnectionCommandValid(folderID: folderID);
        _connectionRepository.Setup(r => r.Insert(It.IsAny<Connection>(), cancellationToken)).ReturnsAsync(UnitResult.Failure(FolderErrors.NotFound(folderID)));
        var handler = new CreateConnectionHandler(_connectionRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _connectionRepository.Verify(r => r.Insert(It.Is<Connection>(connection => connection.FolderID == folderID), cancellationToken), Times.Once);
        _connectionRepository.VerifyNoOtherCalls();
    }

    [Trait("CreateConnectionHandler", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro nome já existe na pasta, dito pela gravação")]
    public async Task Handle_ShouldBeError_ConnectionRepository_Insert_AlreadyExists()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = ConnectionFakers.ReturnCreateConnectionCommandValid();
        _connectionRepository.Setup(r => r.Insert(It.IsAny<Connection>(), cancellationToken)).ReturnsAsync(UnitResult.Failure(ConnectionErrors.AlreadyExists(command.Name)));
        var handler = new CreateConnectionHandler(_connectionRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_ALREADY_EXISTS", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _connectionRepository.Verify(r => r.Insert(It.IsAny<Connection>(), cancellationToken), Times.Once);
        _connectionRepository.VerifyNoOtherCalls();
    }

    [Trait("CreateConnectionHandler", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro cofre fechado, dito pela gravação")]
    public async Task Handle_ShouldBeError_ConnectionRepository_Insert_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = ConnectionFakers.ReturnCreateConnectionCommandValid();
        _connectionRepository.Setup(r => r.Insert(It.IsAny<Connection>(), cancellationToken)).ReturnsAsync(UnitResult.Failure(VaultErrors.From(EVaultError.Locked)));
        var handler = new CreateConnectionHandler(_connectionRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _connectionRepository.Verify(r => r.Insert(It.IsAny<Connection>(), cancellationToken), Times.Once);
        _connectionRepository.VerifyNoOtherCalls();
    }
}
