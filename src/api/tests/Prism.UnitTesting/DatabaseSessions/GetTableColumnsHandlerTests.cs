using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.GetTableColumns;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class GetTableColumnsHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("GetTableColumnsHandler", "GetTableColumnsCommand")]
    [Fact(DisplayName = "OK devolve as colunas da tabela")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string table = "pedido";
        IReadOnlyList<ColumnInfo> items = [new ColumnInfo("id", "integer", false, true, 1, null, "always"), new ColumnInfo("criado_em", "timestamp", false, false, 2, "CURRENT_TIMESTAMP", null)];
        _databaseSessionService.Setup(s => s.GetColumnsAsync(sessionID, schema, table, cancellationToken)).ReturnsAsync(Result.Success<IReadOnlyList<ColumnInfo>, DatabaseFailure>(items));
        var handler = new GetTableColumnsHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetTableColumnsCommand(sessionID, schema, table), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Same(items, result.Value);
        _databaseSessionService.Verify(s => s.GetColumnsAsync(sessionID, schema, table, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetTableColumnsHandler", "GetTableColumnsCommand")]
    [Fact(DisplayName = "Erro sessão não existe")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetColumnsAsync_SessionNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string table = "pedido";
        _databaseSessionService.Setup(s => s.GetColumnsAsync(sessionID, schema, table, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<ColumnInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.")));
        var handler = new GetTableColumnsHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetTableColumnsCommand(sessionID, schema, table), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.GetColumnsAsync(sessionID, schema, table, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetTableColumnsHandler", "GetTableColumnsCommand")]
    [Fact(DisplayName = "Erro o banco recusou a consulta de catálogo, com a mensagem dele")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetColumnsAsync_ExecutionFailed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string table = "pedido";
        _databaseSessionService.Setup(s => s.GetColumnsAsync(sessionID, schema, table, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<ColumnInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "permission denied for schema loja", "42501")));
        var handler = new GetTableColumnsHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetTableColumnsCommand(sessionID, schema, table), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("SQL_EXECUTION_FAILED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("permission denied for schema loja", result.Error.Detail);
        Assert.Equal("42501", result.Error.Extensions["sqlState"]);
    }
}
