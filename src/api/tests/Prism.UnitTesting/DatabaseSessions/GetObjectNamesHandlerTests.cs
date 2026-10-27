using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.GetObjectNames;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class GetObjectNamesHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("GetObjectNamesHandler", "GetObjectNamesCommand")]
    [Fact(DisplayName = "OK devolve o índice de nomes como veio")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        var names = new ObjectNamesInfo([new SchemaObjectNamesInfo("loja", false, ["pedido"], ["resumo"]), new SchemaObjectNamesInfo("pg_catalog", true, ["pg_class"], [])], false);
        _databaseSessionService.Setup(s => s.GetObjectNamesAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Success<ObjectNamesInfo, DatabaseFailure>(names));
        var handler = new GetObjectNamesHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetObjectNamesCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Same(names, result.Value);
        _databaseSessionService.Verify(s => s.GetObjectNamesAsync(sessionID, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetObjectNamesHandler", "GetObjectNamesCommand")]
    [Fact(DisplayName = "OK o índice cortado na API chega com o corte ligado")]
    public async Task Handle_ShouldBeOK_Truncated()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        var names = new ObjectNamesInfo([new SchemaObjectNamesInfo("loja", false, ["a"], [])], true);
        _databaseSessionService.Setup(s => s.GetObjectNamesAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Success<ObjectNamesInfo, DatabaseFailure>(names));
        var handler = new GetObjectNamesHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetObjectNamesCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Truncated);
    }

    [Trait("GetObjectNamesHandler", "GetObjectNamesCommand")]
    [Fact(DisplayName = "Erro sessão não existe")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetObjectNamesAsync_SessionNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.GetObjectNamesAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Failure<ObjectNamesInfo, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.")));
        var handler = new GetObjectNamesHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetObjectNamesCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.GetObjectNamesAsync(sessionID, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetObjectNamesHandler", "GetObjectNamesCommand")]
    [Fact(DisplayName = "Erro o banco recusou a consulta dos nomes, com a mensagem dele")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetObjectNamesAsync_ExecutionFailed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.GetObjectNamesAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Failure<ObjectNamesInfo, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "permission denied for table pg_class", "42501")));
        var handler = new GetObjectNamesHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetObjectNamesCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("SQL_EXECUTION_FAILED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("permission denied for table pg_class", result.Error.Detail);
        Assert.Equal("42501", result.Error.Extensions["sqlState"]);
    }
}
