using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Features.DeleteConnection;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Models;
using System.Net;

namespace Prism.UnitTesting.Connections;

public sealed class DeleteConnectionHandlerTests
{
    private readonly Mock<IConnectionRepository> _connectionRepository = new();
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    /// <summary>RN-CONN-014: a conexão excluída tem as sessões abertas dela encerradas, depois de a exclusão estar gravada.</summary>
    [Trait("DeleteConnectionHandler", "DeleteConnectionCommand")]
    [Fact(DisplayName = "OK exclui a conexão e encerra as sessões dela")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = new DeleteConnectionCommand(Guid.CreateVersion7());
        _connectionRepository.Setup(r => r.Delete(command.ID, cancellationToken)).ReturnsAsync(UnitResult.Success<ApiErrorDto>());
        _databaseSessionService.Setup(s => s.CloseByConnectionAsync(command.ID)).Returns(Task.CompletedTask);
        var handler = new DeleteConnectionHandler(_connectionRepository.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        _connectionRepository.Verify(r => r.Delete(command.ID, cancellationToken), Times.Once);
        _databaseSessionService.Verify(s => s.CloseByConnectionAsync(command.ID), Times.Once);
        _connectionRepository.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>Que a conexão exista é dito só pela gravação, onde o cofre fechado vira 401, e não 404.</summary>
    [Trait("DeleteConnectionHandler", "DeleteConnectionCommand")]
    [Fact(DisplayName = "Erro conexão não existe, dito pela gravação")]
    public async Task Handle_ShouldBeError_ConnectionRepository_Delete_NotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = new DeleteConnectionCommand(Guid.CreateVersion7());
        _connectionRepository.Setup(r => r.Delete(command.ID, cancellationToken)).ReturnsAsync(UnitResult.Failure(ConnectionErrors.NotFound(command.ID)));
        var handler = new DeleteConnectionHandler(_connectionRepository.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _connectionRepository.Verify(r => r.Delete(command.ID, cancellationToken), Times.Once);
        _databaseSessionService.Verify(s => s.CloseByConnectionAsync(It.IsAny<Guid>()), Times.Never);
        _connectionRepository.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("DeleteConnectionHandler", "DeleteConnectionCommand")]
    [Fact(DisplayName = "Erro cofre fechado, dito pela gravação")]
    public async Task Handle_ShouldBeError_ConnectionRepository_Delete_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = new DeleteConnectionCommand(Guid.CreateVersion7());
        _connectionRepository.Setup(r => r.Delete(command.ID, cancellationToken)).ReturnsAsync(UnitResult.Failure(VaultErrors.From(EVaultError.Locked)));
        var handler = new DeleteConnectionHandler(_connectionRepository.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _connectionRepository.Verify(r => r.Delete(command.ID, cancellationToken), Times.Once);
        _databaseSessionService.Verify(s => s.CloseByConnectionAsync(It.IsAny<Guid>()), Times.Never);
        _connectionRepository.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
    }
}
