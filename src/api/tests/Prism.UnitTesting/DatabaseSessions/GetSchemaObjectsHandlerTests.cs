using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.GetSchemaObjects;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class GetSchemaObjectsHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("GetSchemaObjectsHandler", "GetSchemaObjectsCommand")]
    [Fact(DisplayName = "OK devolve os objetos do esquema")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string kind = "tables";
        IReadOnlyList<DatabaseObjectInfo> items = [new DatabaseObjectInfo("pedido", "table", 1000, "Os pedidos"), new DatabaseObjectInfo("cliente", "table", null, null)];
        _databaseSessionService.Setup(s => s.GetObjectsAsync(sessionID, schema, kind, cancellationToken)).ReturnsAsync(Result.Success<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>(items));
        var handler = new GetSchemaObjectsHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetSchemaObjectsCommand(sessionID, schema, kind), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Same(items, result.Value);
        _databaseSessionService.Verify(s => s.GetObjectsAsync(sessionID, schema, kind, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetSchemaObjectsHandler", "GetSchemaObjectsCommand")]
    [Fact(DisplayName = "Erro sessão não existe")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetObjectsAsync_SessionNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string kind = "tables";
        _databaseSessionService.Setup(s => s.GetObjectsAsync(sessionID, schema, kind, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.")));
        var handler = new GetSchemaObjectsHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetSchemaObjectsCommand(sessionID, schema, kind), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.GetObjectsAsync(sessionID, schema, kind, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetSchemaObjectsHandler", "GetSchemaObjectsCommand")]
    [Fact(DisplayName = "Erro o banco recusou a consulta de catálogo, com a mensagem dele")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetObjectsAsync_ExecutionFailed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string kind = "tables";
        _databaseSessionService.Setup(s => s.GetObjectsAsync(sessionID, schema, kind, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "permission denied for schema loja", "42501")));
        var handler = new GetSchemaObjectsHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetSchemaObjectsCommand(sessionID, schema, kind), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("SQL_EXECUTION_FAILED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("permission denied for schema loja", result.Error.Detail);
        Assert.Equal("42501", result.Error.Extensions["sqlState"]);
    }
}
