using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.CancelQuery;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class CancelQueryHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("CancelQueryHandler", "CancelQueryCommand")]
    [Fact(DisplayName = "OK cancela o comando em andamento")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.Cancel(sessionID)).Returns(UnitResult.Success<DatabaseFailure>());
        var handler = new CancelQueryHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new CancelQueryCommand(sessionID), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        _databaseSessionService.Verify(s => s.Cancel(sessionID), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("CancelQueryHandler", "CancelQueryCommand")]
    [Fact(DisplayName = "Erro sessão não existe")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_Cancel_SessionNotFound()
    {
        //Arrange
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.Cancel(sessionID)).Returns(UnitResult.Failure(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.")));
        var handler = new CancelQueryHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new CancelQueryCommand(sessionID), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.Cancel(sessionID), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }
}
