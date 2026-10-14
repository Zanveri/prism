using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DatabaseSessions.Features.ExecuteQuery;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;
using System.Text.Json;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class ExecuteQueryHandlerTests
{
    private const string Sql = "SELECT numero, observacao FROM loja.pedido";

    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "OK devolve a primeira página, com as colunas, o tempo e o total que o comando devolveu")]
    public async Task Handle_ShouldBeOK_WithRows()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        var resultID = Guid.CreateVersion7();
        var page = new QueryPage([new QueryColumn("numero", "integer", "number", new ColumnOrigin(16384, 1)), new QueryColumn("observacao", "text", "text")], [["1001", "Pedido 1"], ["1007", null]], false, 12, [[1, 1]], 1000, resultID, ResultEditability.ReadOnly("o comando gravou e devolveu linhas"));
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, QueryPaging.DefaultPageSize, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(page, null, 15)));
        var handler = new ExecuteQueryHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal([new QueryColumnDto("numero", "integer", "number"), new QueryColumnDto("observacao", "text", "text")], result.Value.Columns);
        Assert.Equal(page.Rows, result.Value.Rows);
        Assert.False(result.Value.HasMore);
        Assert.Equal(15, result.Value.ElapsedMs);
        Assert.Equal(page.TruncatedCells, result.Value.TruncatedCells);
        Assert.Null(result.Value.RowsAffected);
        Assert.Equal(1000, result.Value.TotalRows);

        // RN-EDIT-002: o resultado e o que se sabe da edição dele vão com a página; a origem das colunas fica na API.
        Assert.Equal(resultID, result.Value.ResultID);
        Assert.Equal(ResultEditability.ReadOnly("o comando gravou e devolveu linhas"), result.Value.Editable);
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, Sql, QueryPaging.DefaultPageSize, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "OK devolve as linhas afetadas quando o comando não devolve linhas")]
    public async Task Handle_ShouldBeOK_WithRowsAffected()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, "UPDATE loja.pedido SET id = id", QueryPaging.DefaultPageSize, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 1000, 40)));
        var handler = new ExecuteQueryHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = "UPDATE loja.pedido SET id = id" }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(new QueryResultDto { RowsAffected = 1000, ElapsedMs = 40 }, result.Value);
        Assert.Null(result.Value.Columns);
        Assert.Null(result.Value.Rows);
    }

    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "Erro sessão ocupada")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_ExecuteAsync_SessionBusy()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, QueryPaging.DefaultPageSize, cancellationToken)).ReturnsAsync(Result.Failure<QueryOutcome, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.SessionBusy, "A sessão está ocupada com outro comando.")));
        var handler = new ExecuteQueryHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql }, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("SESSION_BUSY", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
    }

    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "Erro do banco, com a mensagem, o SQLSTATE e a posição")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_ExecuteAsync_ExecutionFailed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, QueryPaging.DefaultPageSize, cancellationToken)).ReturnsAsync(Result.Failure<QueryOutcome, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "syntax error at or near \"FRM\"", "42601", 10)));
        var handler = new ExecuteQueryHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql }, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("SQL_EXECUTION_FAILED", result.Error.Type);
        Assert.Equal("syntax error at or near \"FRM\"", result.Error.Detail);
        Assert.Equal("42601", result.Error.Extensions["sqlState"]);
        Assert.Equal(10, result.Error.Extensions["position"]);
    }

    /// <summary>RN-SQL-003: o texto vai ao banco como o usuário o escreveu, sem ser aparado nem reescrito.</summary>
    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "OK envia o SQL sem alterar")]
    public async Task Handle_ShouldSendTheSqlAsIs()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        const string untouched = "  \n select 1 -- fim\n";
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, untouched, QueryPaging.DefaultPageSize, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 0, 1)));
        var handler = new ExecuteQueryHandler(_databaseSessionService.Object);

        //Act
        await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = untouched }, cancellationToken);

        //Assert
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, untouched, QueryPaging.DefaultPageSize, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>RN-SQL-016: o tamanho pedido vai até o registro de sessões, que o leva ao cursor.</summary>
    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "OK envia as linhas por busca que o corpo pediu")]
    public async Task Handle_ShouldSendThePageSize()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, 500, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 0, 1)));
        var handler = new ExecuteQueryHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql, PageSize = JsonSerializer.SerializeToElement(500) }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, Sql, 500, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>RN-SQL-016: sem `pageSize` no corpo, ou com ele nulo, a busca traz 200 linhas.</summary>
    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "OK sem linhas por busca no corpo, ou com nulo, envia 200")]
    public async Task Handle_WithoutPageSize_ShouldSend200()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, 200, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 0, 1)));
        var handler = new ExecuteQueryHandler(_databaseSessionService.Object);

        //Act
        await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql }, cancellationToken);
        await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql, PageSize = JsonSerializer.SerializeToElement<object?>(null) }, cancellationToken);

        //Assert
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, Sql, 200, cancellationToken), Times.Exactly(2));
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>RN-GRADE-011: com filtro, o registro de sessões recebe o comando e o filtro como vieram, e a página diz como ele entrou.</summary>
    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "OK com filtro envia o comando e o filtro, e a página diz como o filtro entrou")]
    public async Task Handle_WithFilter_ShouldSendTheFilter()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        var page = new QueryPage([new QueryColumn("numero", "integer", "number")], [["1001"]], false, 2, [], FilterApplied: EFilterApplied.Merged);
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, "numero > 1000 ORDER BY numero DESC", QueryPaging.DefaultPageSize, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(page, null, 2)));
        var handler = new ExecuteQueryHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql, Filter = "numero > 1000 ORDER BY numero DESC" }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("merged", result.Value.FilterApplied);
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, Sql, "numero > 1000 ORDER BY numero DESC", QueryPaging.DefaultPageSize, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>RN-GRADE-011: o filtro vazio ou só de espaços é a falta dele, e o comando vai sem filtro, como antes.</summary>
    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Theory(DisplayName = "OK filtro vazio ou só de espaços envia o comando sem filtro")]
    [InlineData("")]
    [InlineData("  \n ")]
    public async Task Handle_WithBlankFilter_ShouldSendWithoutFilter(string filter)
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, QueryPaging.DefaultPageSize, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 0, 1)));
        var handler = new ExecuteQueryHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql, Filter = filter }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Null(result.Value.FilterApplied);
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, Sql, QueryPaging.DefaultPageSize, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>RN-GRADE-011: a recusa do filtro pelo registro de sessões é 422 `FILTER_INVALID`, com o motivo.</summary>
    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "Erro filtro recusado pelo registro de sessões")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_ExecuteAsync_FilterInvalid()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, "a = 'x", QueryPaging.DefaultPageSize, cancellationToken)).ReturnsAsync(Result.Failure<QueryOutcome, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.FilterInvalid, "O filtro tem aspas sem fechar.")));
        var handler = new ExecuteQueryHandler(_databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql, Filter = "a = 'x" }, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(("FILTER_INVALID", HttpStatusCode.UnprocessableEntity, "O filtro tem aspas sem fechar."), (result.Error.Type, result.Error.StatusCode, result.Error.Detail));
    }
}
