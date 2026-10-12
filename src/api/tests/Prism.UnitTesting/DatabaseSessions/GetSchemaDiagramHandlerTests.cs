using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.GetSchemaDiagram;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class GetSchemaDiagramHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("GetSchemaDiagramHandler", "GetSchemaDiagramCommand")]
    [Fact(DisplayName = "OK devolve as tabelas e as chaves do esquema")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        SchemaDiagramInfo value = new SchemaDiagramInfo([new DiagramTableInfo("cliente", [new DiagramColumnInfo("id", "integer", false, true)])], []);
        _databaseSessionService.Setup(s => s.GetDiagramAsync(sessionID, schema, cancellationToken)).ReturnsAsync(Result.Success<SchemaDiagramInfo, DatabaseFailure>(value));
        var handler = new GetSchemaDiagramHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetSchemaDiagramCommand(sessionID, schema), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Same(value, result.Value);
        _databaseSessionService.Verify(s => s.GetDiagramAsync(sessionID, schema, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetSchemaDiagramHandler", "GetSchemaDiagramCommand")]
    [Fact(DisplayName = "Erro sessão não existe")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetDiagramAsync_SessionNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        _databaseSessionService.Setup(s => s.GetDiagramAsync(sessionID, schema, cancellationToken)).ReturnsAsync(Result.Failure<SchemaDiagramInfo, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.")));
        var handler = new GetSchemaDiagramHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetSchemaDiagramCommand(sessionID, schema), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.GetDiagramAsync(sessionID, schema, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetSchemaDiagramHandler", "GetSchemaDiagramCommand")]
    [Fact(DisplayName = "Erro o banco recusou a consulta de catálogo, com a mensagem dele")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetDiagramAsync_ExecutionFailed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        _databaseSessionService.Setup(s => s.GetDiagramAsync(sessionID, schema, cancellationToken)).ReturnsAsync(Result.Failure<SchemaDiagramInfo, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "permission denied for table pg_constraint", "42501")));
        var handler = new GetSchemaDiagramHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetSchemaDiagramCommand(sessionID, schema), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("SQL_EXECUTION_FAILED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("permission denied for table pg_constraint", result.Error.Detail);
        Assert.Equal("42501", result.Error.Extensions["sqlState"]);
    }
}
