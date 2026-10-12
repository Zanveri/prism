using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.GetTableChecks;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class GetTableChecksHandlerTests
{
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("GetTableChecksHandler", "GetTableChecksCommand")]
    [Fact(DisplayName = "OK devolve as restrições de conferência da tabela")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string table = "pedido";
        IReadOnlyList<CheckConstraintInfo> value = [new CheckConstraintInfo("ck_valor_positivo", "valor > 0::numeric")];
        _databaseSessionService.Setup(s => s.GetChecksAsync(sessionID, schema, table, cancellationToken)).ReturnsAsync(Result.Success<IReadOnlyList<CheckConstraintInfo>, DatabaseFailure>(value));
        var handler = new GetTableChecksHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetTableChecksCommand(sessionID, schema, table), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Same(value, result.Value);
        _databaseSessionService.Verify(s => s.GetChecksAsync(sessionID, schema, table, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetTableChecksHandler", "GetTableChecksCommand")]
    [Fact(DisplayName = "Erro sessão não existe")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetChecksAsync_SessionNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string table = "pedido";
        _databaseSessionService.Setup(s => s.GetChecksAsync(sessionID, schema, table, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<CheckConstraintInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.")));
        var handler = new GetTableChecksHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetTableChecksCommand(sessionID, schema, table), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.GetChecksAsync(sessionID, schema, table, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("GetTableChecksHandler", "GetTableChecksCommand")]
    [Fact(DisplayName = "Erro o banco recusou a consulta de catálogo, com a mensagem dele")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_GetChecksAsync_ExecutionFailed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string schema = "loja";
        const string table = "pedido";
        _databaseSessionService.Setup(s => s.GetChecksAsync(sessionID, schema, table, cancellationToken)).ReturnsAsync(Result.Failure<IReadOnlyList<CheckConstraintInfo>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "permission denied for table pg_constraint", "42501")));
        var handler = new GetTableChecksHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new GetTableChecksCommand(sessionID, schema, table), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("SQL_EXECUTION_FAILED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("permission denied for table pg_constraint", result.Error.Detail);
        Assert.Equal("42501", result.Error.Extensions["sqlState"]);
    }
}
