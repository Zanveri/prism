using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.GetTableIndexes;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class GetTableIndexesHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("GetTableIndexesHandler", "GetTableIndexesCommand")]
    [Fact(DisplayName = "OK devolve os índices da tabela")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string table = "pedido";
        IReadOnlyList<IndexInfo> items = [new IndexInfo("uk_pedido_numero", ["numero"], true, "btree")];
        _databaseSessionService.Setup(s => s.GetIndexesAsync(sessionID, schema, table, cancellationToken)).ReturnsAsync(Result.Success<IReadOnlyList<IndexInfo>, DatabaseFailure>(items));
        var handler = new GetTableIndexesHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetTableIndexesCommand(sessionID, schema, table), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Same(items, result.Value);
        _databaseSessionService.Verify(s => s.GetIndexesAsync(sessionID, schema, table, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetTableIndexesHandler", "GetTableIndexesCommand")]
    [Fact(DisplayName = "Erro sessão não existe")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetIndexesAsync_SessionNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string table = "pedido";
        _databaseSessionService.Setup(s => s.GetIndexesAsync(sessionID, schema, table, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<IndexInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.")));
        var handler = new GetTableIndexesHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetTableIndexesCommand(sessionID, schema, table), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.GetIndexesAsync(sessionID, schema, table, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetTableIndexesHandler", "GetTableIndexesCommand")]
    [Fact(DisplayName = "Erro o banco recusou a consulta de catálogo, com a mensagem dele")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetIndexesAsync_ExecutionFailed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string table = "pedido";
        _databaseSessionService.Setup(s => s.GetIndexesAsync(sessionID, schema, table, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<IndexInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "permission denied for schema loja", "42501")));
        var handler = new GetTableIndexesHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetTableIndexesCommand(sessionID, schema, table), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("SQL_EXECUTION_FAILED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("permission denied for schema loja", result.Error.Detail);
        Assert.Equal("42501", result.Error.Extensions["sqlState"]);
    }
}
