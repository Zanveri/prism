using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.CountQuery;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class CountQueryHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("CountQueryHandler", "CountQueryCommand")]
    [Fact(DisplayName = "OK devolve o total")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.CountAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Success<long, DatabaseFailure>(1000));
        var handler = new CountQueryHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new CountQueryCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(new QueryCountDto(1000), result.Value);
        _databaseSessionService.Verify(s => s.CountAsync(sessionID, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("CountQueryHandler", "CountQueryCommand")]
    [Fact(DisplayName = "Erro não há consulta para contar")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_CountAsync_NoQueryToCount()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.CountAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Failure<long, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.NoQueryToCount, "Nenhum comando desta sessão devolveu linhas para contar.")));
        var handler = new CountQueryHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new CountQueryCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("NO_QUERY_TO_COUNT", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.CountAsync(sessionID, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }
}
