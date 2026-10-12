using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.GetViewDefinition;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class GetViewDefinitionHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("GetViewDefinitionHandler", "GetViewDefinitionCommand")]
    [Fact(DisplayName = "OK devolve o texto da visão")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string view = "pedido_resumo";
        ViewDefinitionInfo value = new ViewDefinitionInfo(" SELECT cliente_id\n   FROM loja.pedido;");
        _databaseSessionService.Setup(s => s.GetViewDefinitionAsync(sessionID, schema, view, cancellationToken)).ReturnsAsync(Result.Success<ViewDefinitionInfo, DatabaseFailure>(value));
        var handler = new GetViewDefinitionHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetViewDefinitionCommand(sessionID, schema, view), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Same(value, result.Value);
        _databaseSessionService.Verify(s => s.GetViewDefinitionAsync(sessionID, schema, view, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetViewDefinitionHandler", "GetViewDefinitionCommand")]
    [Fact(DisplayName = "Erro sessão não existe")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetViewDefinitionAsync_SessionNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string view = "pedido_resumo";
        _databaseSessionService.Setup(s => s.GetViewDefinitionAsync(sessionID, schema, view, cancellationToken)).ReturnsAsync(Result.Failure<ViewDefinitionInfo, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.")));
        var handler = new GetViewDefinitionHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetViewDefinitionCommand(sessionID, schema, view), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.GetViewDefinitionAsync(sessionID, schema, view, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetViewDefinitionHandler", "GetViewDefinitionCommand")]
    [Fact(DisplayName = "Erro o banco recusou a consulta de catálogo, com a mensagem dele")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetViewDefinitionAsync_ExecutionFailed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string view = "pedido_resumo";
        _databaseSessionService.Setup(s => s.GetViewDefinitionAsync(sessionID, schema, view, cancellationToken)).ReturnsAsync(Result.Failure<ViewDefinitionInfo, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "permission denied for table pg_constraint", "42501")));
        var handler = new GetViewDefinitionHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetViewDefinitionCommand(sessionID, schema, view), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("SQL_EXECUTION_FAILED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("permission denied for table pg_constraint", result.Error.Detail);
        Assert.Equal("42501", result.Error.Extensions["sqlState"]);
    }
}
