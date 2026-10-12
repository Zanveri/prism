using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.GetDatabaseProperties;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class GetDatabasePropertiesHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("GetDatabasePropertiesHandler", "GetDatabasePropertiesCommand")]
    [Fact(DisplayName = "OK devolve as propriedades do banco")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        IReadOnlyList<DatabasePropertyInfo> value = [new DatabasePropertyInfo("encoding", "UTF8")];
        _databaseSessionService.Setup(s => s.GetPropertiesAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Success<IReadOnlyList<DatabasePropertyInfo>, DatabaseFailure>(value));
        var handler = new GetDatabasePropertiesHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetDatabasePropertiesCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Same(value, result.Value);
        _databaseSessionService.Verify(s => s.GetPropertiesAsync(sessionID, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetDatabasePropertiesHandler", "GetDatabasePropertiesCommand")]
    [Fact(DisplayName = "Erro sessão não existe")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetPropertiesAsync_SessionNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.GetPropertiesAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<DatabasePropertyInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.")));
        var handler = new GetDatabasePropertiesHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetDatabasePropertiesCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.GetPropertiesAsync(sessionID, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetDatabasePropertiesHandler", "GetDatabasePropertiesCommand")]
    [Fact(DisplayName = "Erro o banco recusou a consulta de catálogo, com a mensagem dele")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetPropertiesAsync_ExecutionFailed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.GetPropertiesAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<DatabasePropertyInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "permission denied for table pg_constraint", "42501")));
        var handler = new GetDatabasePropertiesHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetDatabasePropertiesCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("SQL_EXECUTION_FAILED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("permission denied for table pg_constraint", result.Error.Detail);
        Assert.Equal("42501", result.Error.Extensions["sqlState"]);
    }
}
