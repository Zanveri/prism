using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.CloseDatabaseSession;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class CloseDatabaseSessionHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("CloseDatabaseSessionHandler", "CloseDatabaseSessionCommand")]
    [Fact(DisplayName = "OK fecha a sessão")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.CloseAsync(sessionID)).ReturnsAsync(UnitResult.Success<DatabaseFailure>());
        var handler = new CloseDatabaseSessionHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new CloseDatabaseSessionCommand(sessionID), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        _databaseSessionService.Verify(s => s.CloseAsync(sessionID), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("CloseDatabaseSessionHandler", "CloseDatabaseSessionCommand")]
    [Fact(DisplayName = "Erro sessão não existe")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_CloseAsync_SessionNotFound()
    {
        //Arrange
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.CloseAsync(sessionID)).ReturnsAsync(UnitResult.Failure(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.")));
        var handler = new CloseDatabaseSessionHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new CloseDatabaseSessionCommand(sessionID), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.CloseAsync(sessionID), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }
}
