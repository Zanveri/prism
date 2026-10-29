using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.FetchNextPage;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class FetchNextPageHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("FetchNextPageHandler", "FetchNextPageCommand")]
    [Fact(DisplayName = "OK devolve as linhas seguintes")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        var page = new QueryPage([new QueryColumn("numero", "integer", "number")], [["1201"], ["1202"]], true, 3, []);
        _databaseSessionService.Setup(s => s.FetchNextAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Success<QueryPage, DatabaseFailure>(page));
        var handler = new FetchNextPageHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new FetchNextPageCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(page.Rows, result.Value.Rows);
        Assert.True(result.Value.HasMore);
        Assert.Equal(3, result.Value.ElapsedMs);
        Assert.Null(result.Value.RowsAffected);
        Assert.Null(result.Value.TotalRows);
        _databaseSessionService.Verify(s => s.FetchNextAsync(sessionID, cancellationToken), Times.Once);
        _databaseSessionService.Verify(s => s.TransactionOf(sessionID), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("FetchNextPageHandler", "FetchNextPageCommand")]
    [Fact(DisplayName = "Erro não há cursor aberto")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_FetchNextAsync_NoOpenCursor()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.FetchNextAsync(sessionID, cancellationToken)).ReturnsAsync(Result.Failure<QueryPage, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.NoOpenCursor, "Não há resultado aberto.")));
        var handler = new FetchNextPageHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new FetchNextPageCommand(sessionID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("NO_OPEN_CURSOR", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.FetchNextAsync(sessionID, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }
}
