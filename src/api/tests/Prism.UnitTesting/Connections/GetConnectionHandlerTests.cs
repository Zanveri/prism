using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Features.GetConnection;
using Prism.Application.Connections.Models.Dtos;
using Prism.Application.Connections.Queries;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Connections;

public sealed class GetConnectionHandlerTests
{
    private readonly Mock<IConnectionQueries> _connectionQueries = new();

    [Trait("GetConnectionHandler", "GetConnectionCommand")]
    [Fact(DisplayName = "OK devolve a conexão sem a senha")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection(password: "segredo");
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));
        var handler = new GetConnectionHandler(_connectionQueries.Object);

        //Act
        var result = await handler.Handle(new GetConnectionCommand(record.ID), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(record.ToDto(), result.Value);
        Assert.True(result.Value.HasPassword);
        _connectionQueries.Verify(q => q.GetRecordByID(record.ID, cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
    }

    [Trait("GetConnectionHandler", "GetConnectionCommand")]
    [Fact(DisplayName = "Erro conexão não existe")]
    public async Task Handle_ShouldBeError_ConnectionQueries_GetRecordByID_NotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var id = Guid.CreateVersion7();
        _connectionQueries.Setup(q => q.GetRecordByID(id, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(null));
        var handler = new GetConnectionHandler(_connectionQueries.Object);

        //Act
        var result = await handler.Handle(new GetConnectionCommand(id), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _connectionQueries.Verify(q => q.GetRecordByID(id, cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
    }

    [Trait("GetConnectionHandler", "GetConnectionCommand")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Handle_ShouldBeError_ConnectionQueries_GetRecordByID_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var id = Guid.CreateVersion7();
        _connectionQueries.Setup(q => q.GetRecordByID(id, cancellationToken)).ReturnsAsync(Result.Failure<VaultConnectionRecord?, EVaultError>(EVaultError.Locked));
        var handler = new GetConnectionHandler(_connectionQueries.Object);

        //Act
        var result = await handler.Handle(new GetConnectionCommand(id), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _connectionQueries.Verify(q => q.GetRecordByID(id, cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
    }
}
