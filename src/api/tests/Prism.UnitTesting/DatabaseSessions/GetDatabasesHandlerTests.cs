using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.GetDatabases;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class GetDatabasesHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("GetDatabasesHandler", "GetDatabasesCommand")]
    [Fact(DisplayName = "OK devolve os bancos do servidor")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        IReadOnlyList<DatabaseInfo> value = [new DatabaseInfo("prism", true), new DatabaseInfo("postgres", false)];
        _databaseSessionService.Setup(s => s.GetDatabasesAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Success<IReadOnlyList<DatabaseInfo>, DatabaseFailure>(value));
        var handler = new GetDatabasesHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetDatabasesCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Same(value, result.Value);
        _databaseSessionService.Verify(s => s.GetDatabasesAsync(sessionID, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetDatabasesHandler", "GetDatabasesCommand")]
    [Fact(DisplayName = "Erro sessão não existe")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetDatabasesAsync_SessionNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.GetDatabasesAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<DatabaseInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.")));
        var handler = new GetDatabasesHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetDatabasesCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.GetDatabasesAsync(sessionID, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetDatabasesHandler", "GetDatabasesCommand")]
    [Fact(DisplayName = "Erro o banco recusou a consulta, com a mensagem dele")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetDatabasesAsync_ExecutionFailed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.GetDatabasesAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<DatabaseInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "permission denied for table pg_database", "42501")));
        var handler = new GetDatabasesHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetDatabasesCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("SQL_EXECUTION_FAILED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("permission denied for table pg_database", result.Error.Detail);
        Assert.Equal("42501", result.Error.Extensions["sqlState"]);
    }
}
