using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.GetSchemas;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class GetSchemasHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("GetSchemasHandler", "GetSchemasCommand")]
    [Fact(DisplayName = "OK devolve os esquemas")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        IReadOnlyList<SchemaInfo> items = [new SchemaInfo("loja", false, 3, 1, 1), new SchemaInfo("pg_catalog", true, 64, 72, 3000)];
        _databaseSessionService.Setup(s => s.GetSchemasAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Success<IReadOnlyList<SchemaInfo>, DatabaseFailure>(items));
        var handler = new GetSchemasHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetSchemasCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Same(items, result.Value);
        _databaseSessionService.Verify(s => s.GetSchemasAsync(sessionID, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetSchemasHandler", "GetSchemasCommand")]
    [Fact(DisplayName = "Erro sessão não existe")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetSchemasAsync_SessionNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.GetSchemasAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<SchemaInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.")));
        var handler = new GetSchemasHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetSchemasCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.GetSchemasAsync(sessionID, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetSchemasHandler", "GetSchemasCommand")]
    [Fact(DisplayName = "Erro o banco recusou a consulta de catálogo, com a mensagem dele")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetSchemasAsync_ExecutionFailed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.GetSchemasAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<SchemaInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "permission denied for schema loja", "42501")));
        var handler = new GetSchemasHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetSchemasCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("SQL_EXECUTION_FAILED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("permission denied for schema loja", result.Error.Detail);
        Assert.Equal("42501", result.Error.Extensions["sqlState"]);
    }
}
