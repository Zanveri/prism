using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Features.ExecuteQuery;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Models;
using System.Net;
using System.Text.Json;

namespace Prism.UnitTesting.DatabaseSessions;

public sealed class ExecuteQueryHandlerTests
{
    private const string Sql = "SELECT numero, observacao FROM loja.pedido";

    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    /// <summary>RN-SQL-024: o comando sem `keep`, que esquece os resultados guardados da sessão.</summary>
    /// <summary>RN-VAR-032: o comando sem `params` chega ao registro de sessões com a lista vazia.</summary>
    private static IReadOnlyList<QueryParameter> NoParameters => Match.Create<IReadOnlyList<QueryParameter>>(parameters => parameters.Count == 0);

    private static IReadOnlyCollection<Guid> NoKeep => Match.Create<IReadOnlyCollection<Guid>>(keep => keep.Count == 0);

    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "OK devolve a primeira página, com as colunas, o tempo e o total que o comando devolveu")]
    public async Task Handle_ShouldBeOK_WithRows()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        var resultID = Guid.CreateVersion7();
        var page = new QueryPage([new QueryColumn("numero", "integer", "number", new ColumnOrigin(16384, 1)), new QueryColumn("observacao", "text", "text")], [["1001", "Pedido 1"], ["1007", null]], false, 12, [[1, 1]], 1000, resultID, ResultEditability.ReadOnly("o comando gravou e devolveu linhas"));
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, null, QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(page, null, 15)));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

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
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, Sql, null, QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken), Times.Once);
        _databaseSessionService.Verify(s => s.ConnectionOf(sessionID), Times.AtLeastOnce);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "OK devolve as linhas afetadas quando o comando não devolve linhas")]
    public async Task Handle_ShouldBeOK_WithRowsAffected()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, "UPDATE loja.pedido SET id = id", null, QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 1000, 40)));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

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
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, null, QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Failure<QueryOutcome, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.SessionBusy, "A sessão está ocupada com outro comando.")));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

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
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, null, QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Failure<QueryOutcome, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "syntax error at or near \"FRM\"", "42601", 10)));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

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
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, untouched, null, QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 0, 1)));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

        //Act
        await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = untouched }, cancellationToken);

        //Assert
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, untouched, null, QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken), Times.Once);
        _databaseSessionService.Verify(s => s.ConnectionOf(sessionID), Times.AtLeastOnce);
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
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, null, 500, false, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 0, 1)));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql, PageSize = JsonSerializer.SerializeToElement(500) }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, Sql, null, 500, false, NoKeep, NoParameters, cancellationToken), Times.Once);
        _databaseSessionService.Verify(s => s.ConnectionOf(sessionID), Times.AtLeastOnce);
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
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, null, 200, false, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 0, 1)));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

        //Act
        await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql }, cancellationToken);
        await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql, PageSize = JsonSerializer.SerializeToElement<object?>(null) }, cancellationToken);

        //Assert
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, Sql, null, 200, false, NoKeep, NoParameters, cancellationToken), Times.Exactly(2));
        _databaseSessionService.Verify(s => s.ConnectionOf(sessionID), Times.AtLeastOnce);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>
    /// RN-SQL-024: os `resultID` de `keep` vão ao registro de sessões, o repetido uma vez só; `keep` nulo, ausente ou vazio é a lista vazia, que
    /// esquece os guardados.
    /// </summary>
    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "OK envia os resultados de keep, sem repetir, e nenhum com keep nulo ou vazio")]
    public async Task Handle_ShouldSendTheKeptResults()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        var (first, second) = (Guid.CreateVersion7(), Guid.CreateVersion7());
        IReadOnlyCollection<Guid>? sent = null;
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, null, QueryPaging.DefaultPageSize, false, It.Is<IReadOnlyCollection<Guid>>(keep => keep.Count > 0), NoParameters, cancellationToken))
            .Callback((Guid _, string _, string? _, int _, bool _, IReadOnlyCollection<Guid> keep, IReadOnlyList<QueryParameter> _, CancellationToken _) => sent = keep)
            .ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 0, 1)));
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, null, QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 0, 1)));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

        //Act
        await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql, Keep = JsonSerializer.SerializeToElement(new[] { first, second, first }) }, cancellationToken);
        await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql, Keep = JsonSerializer.SerializeToElement<object?>(null) }, cancellationToken);
        await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql, Keep = JsonSerializer.SerializeToElement(Array.Empty<Guid>()) }, cancellationToken);

        //Assert
        Assert.Equal([first, second], sent);
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, Sql, null, QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken), Times.Exactly(2));
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
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, "numero > 1000 ORDER BY numero DESC", QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(page, null, 2)));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql, Filter = "numero > 1000 ORDER BY numero DESC" }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("merged", result.Value.FilterApplied);
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, Sql, "numero > 1000 ORDER BY numero DESC", QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken), Times.Once);
        _databaseSessionService.Verify(s => s.ConnectionOf(sessionID), Times.AtLeastOnce);
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
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, null, QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 0, 1)));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql, Filter = filter }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Null(result.Value.FilterApplied);
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, Sql, null, QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken), Times.Once);
        _databaseSessionService.Verify(s => s.ConnectionOf(sessionID), Times.AtLeastOnce);
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
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, "a = 'x", QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Failure<QueryOutcome, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.FilterInvalid, "O filtro tem aspas sem fechar.")));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql, Filter = "a = 'x" }, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(("FILTER_INVALID", HttpStatusCode.UnprocessableEntity, "O filtro tem aspas sem fechar."), (result.Error.Type, result.Error.StatusCode, result.Error.Detail));
    }

    /// <summary>RN-PROT-002 e 006: a proteção é a do cofre agora, lida pela conexão da sessão, e vai ao registro de sessões com o comando.</summary>
    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "OK na conexão somente leitura o comando vai ao registro de sessões como somente leitura")]
    public async Task Handle_ShouldExecuteAsReadOnly_WhenTheConnectionIsReadOnly()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        var connectionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.ConnectionOf(sessionID)).Returns(connectionID);
        _connectionQueries.Setup(q => q.IsReadOnly(connectionID, cancellationToken)).ReturnsAsync(Result.Success<bool?, EVaultError>(true));
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, null, QueryPaging.DefaultPageSize, true, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 0, 1)));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        _databaseSessionService.Verify(s => s.ExecuteAsync(sessionID, Sql, null, QueryPaging.DefaultPageSize, true, NoKeep, NoParameters, cancellationToken), Times.Once);
    }

    /// <summary>RN-PROT-002: a recusa do registro de sessões é 422 `CONNECTION_READ_ONLY`, sem `executed`.</summary>
    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "Erro o comando que não é leitura na conexão somente leitura vira 422 CONNECTION_READ_ONLY")]
    public async Task Handle_ShouldBeError_ConnectionReadOnly()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        var connectionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.ConnectionOf(sessionID)).Returns(connectionID);
        _connectionQueries.Setup(q => q.IsReadOnly(connectionID, cancellationToken)).ReturnsAsync(Result.Success<bool?, EVaultError>(true));
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, "DELETE FROM loja.pedido", null, QueryPaging.DefaultPageSize, true, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Failure<QueryOutcome, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ConnectionReadOnly, "A conexão é somente leitura.")));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = "DELETE FROM loja.pedido" }, cancellationToken);

        //Assert
        Assert.Equal(("CONNECTION_READ_ONLY", HttpStatusCode.UnprocessableEntity), (result.Error.Type, result.Error.StatusCode));
        Assert.False(result.Error.Extensions.ContainsKey("executed"));
    }

    /// <summary>O cofre fechado é o 401 de sempre, e a conexão excluída (as sessões dela estão fechando) responde como a sessão que não existe; nada vai ao banco.</summary>
    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Theory(DisplayName = "Erro cofre fechado e conexão excluída não executam nada")]
    [InlineData(true, "VAULT_LOCKED", HttpStatusCode.Unauthorized)]
    [InlineData(false, "DATABASE_SESSION_NOT_FOUND", HttpStatusCode.NotFound)]
    public async Task Handle_ShouldNotExecute_WhenTheProtectionCannotBeRead(bool locked, string code, HttpStatusCode status)
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        var connectionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.ConnectionOf(sessionID)).Returns(connectionID);
        _connectionQueries.Setup(q => q.IsReadOnly(connectionID, cancellationToken)).ReturnsAsync(locked ? Result.Failure<bool?, EVaultError>(EVaultError.Locked) : Result.Success<bool?, EVaultError>(null));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql }, cancellationToken);

        //Assert
        Assert.Equal((code, status), (result.Error.Type, result.Error.StatusCode));
        _databaseSessionService.Verify(s => s.ConnectionOf(sessionID), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>A sessão que não existe não tem conexão: o cofre nem é lido, e quem responde que ela não existe é o registro de sessões.</summary>
    [Trait("ExecuteQueryHandler", "ExecuteQueryCommand")]
    [Fact(DisplayName = "OK sessão que não existe não lê o cofre, e o registro de sessões responde")]
    public async Task Handle_WithoutTheSession_ShouldNotReadTheVault()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var sessionID = Guid.CreateVersion7();
        _databaseSessionService.Setup(s => s.ExecuteAsync(sessionID, Sql, null, QueryPaging.DefaultPageSize, false, NoKeep, NoParameters, cancellationToken)).ReturnsAsync(Result.Failure<QueryOutcome, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.")));
        var handler = new ExecuteQueryHandler(_connectionQueries.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = Sql }, cancellationToken);

        //Assert
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", result.Error.Type);
        _connectionQueries.VerifyNoOtherCalls();
    }
}
