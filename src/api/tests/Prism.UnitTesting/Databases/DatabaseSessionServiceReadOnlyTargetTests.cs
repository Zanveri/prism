using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-GRADE-020: o alvo do "Gerar SQL" numa conexão somente leitura, com a conexão de mentira. É a mesma classe do `DatabaseSessionServiceTests`, em
/// outro arquivo, como a dos resultados guardados.
/// </summary>
public sealed partial class DatabaseSessionServiceTests
{
    /// <summary>
    /// O alvo do "Gerar SQL" numa conexão somente leitura é resolvido como o da edição e não fica guardado: o `edit-target` da edição, quando a conexão deixa de
    /// ser somente leitura, consulta o catálogo de novo e vem editável. O alvo que a edição já guardou serve ao "Gerar SQL", sem consultar, com tudo só leitura.
    /// </summary>
    [Trait("DatabaseSessionService", "GetReadOnlyEditTargetAsync")]
    [Fact(DisplayName = "OK o alvo do Gerar SQL na conexão somente leitura vem só leitura e não se guarda; o guardado pela edição serve a ele")]
    public async Task GetReadOnlyEditTarget_IsNotKept_AndUsesTheKeptOne()
    {
        //Arrange
        const string reason = "a conexão é somente leitura";
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        var result = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO");

        //Act
        var readOnly = await service.GetReadOnlyEditTargetAsync(session, result, null, reason, CancellationToken.None);
        var describedForSql = _connection.DescribeCalls;
        var edit = await service.GetEditTargetAsync(session, result, null, CancellationToken.None);
        var describedForEdit = _connection.DescribeCalls;
        var again = await service.GetReadOnlyEditTargetAsync(session, result, null, reason, CancellationToken.None);

        //Assert
        Assert.True(readOnly.IsSuccess, readOnly.IsFailure ? readOnly.Error.Message : null);
        Assert.Equal((false, reason, EditTableKind.Table), (readOnly.Value.Tables[0].Editable, readOnly.Value.Tables[0].Reason, readOnly.Value.Tables[0].Kind));
        Assert.Equal(["ID"], readOnly.Value.Tables[0].KeyColumns);
        Assert.All(readOnly.Value.Columns, column => Assert.Equal((false, reason), (column.Editable, column.Reason)));
        Assert.False(readOnly.Value.RowOperations);
        Assert.Equal(1, describedForSql);
        Assert.True(edit.Value.Tables[0].Editable);
        Assert.True(edit.Value.RowOperations);
        Assert.Equal(2, describedForEdit);
        Assert.Equal((false, reason), (again.Value.Tables[0].Editable, again.Value.Tables[0].Reason));
        Assert.Equal(2, _connection.DescribeCalls);
    }

    /// <summary>
    /// O resultado lido na conexão somente leitura (o caminho de verdade, pelo `ExecuteAsync` com `readOnly`): a página diz o resultado inteiro só leitura,
    /// com o motivo da conexão, e o alvo do "Gerar SQL" sai do que o texto diz das tabelas, como numa conexão comum. Desmarcado o somente leitura, o mesmo
    /// `resultID` consulta o catálogo para a edição e vem editável.
    /// </summary>
    [Trait("DatabaseSessionService", "GetReadOnlyEditTargetAsync")]
    [Fact(DisplayName = "OK o resultado lido na conexão somente leitura responde o alvo do Gerar SQL, e a edição dele depois que ela deixa de ser")]
    public async Task GetReadOnlyEditTarget_OfAResultReadOnTheReadOnlyConnection_AnswersTheTables()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        _connection.Outcomes.Enqueue(new QueryOutcome(new QueryPage(PedidoColumns, [["1", "aberta"]], false, 1, []), null, 1));
        var page = (await service.ExecuteAsync(session, "SELECT ID, STATUS FROM LOJA.PEDIDO", null, QueryPaging.DefaultPageSize, true, [], CancellationToken.None)).Value.Page!;

        //Act
        var forSql = await service.GetReadOnlyEditTargetAsync(session, page.ResultID!.Value, null, ReadOnlySql.ResultReason, CancellationToken.None);
        var unmarked = await service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None);

        //Assert
        Assert.Equal(ResultEditability.ReadOnly(ReadOnlySql.ResultReason), page.Editable);
        Assert.True(forSql.IsSuccess, forSql.IsFailure ? forSql.Error.Message : null);
        Assert.Equal(("PEDIDO", EditTableKind.Table, false, ReadOnlySql.ResultReason), (forSql.Value.Tables[0].Name, forSql.Value.Tables[0].Kind, forSql.Value.Tables[0].Editable, forSql.Value.Tables[0].Reason));
        Assert.Equal(["ID"], forSql.Value.Tables[0].KeyColumns);
        Assert.False(forSql.Value.RowOperations);
        Assert.True(unmarked.IsSuccess, unmarked.IsFailure ? unmarked.Error.Message : null);
        Assert.True(unmarked.Value.Tables[0].Editable);
        Assert.True(unmarked.Value.RowOperations);
        Assert.Equal(2, _connection.DescribeCalls);
    }

    /// <summary>Na conexão somente leitura, o resultado inteiro só leitura por outro motivo (a união) continua `ResultNotEditable`, com o motivo dele, sem ir ao catálogo.</summary>
    [Trait("DatabaseSessionService", "GetReadOnlyEditTargetAsync")]
    [Fact(DisplayName = "Erro na conexão somente leitura a união continua ResultNotEditable com o motivo dela")]
    public async Task GetReadOnlyEditTarget_ShouldBeError_WhenTheResultIsReadOnlyForAnotherReason()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        _connection.Outcomes.Enqueue(new QueryOutcome(new QueryPage(PedidoColumns, [["1", "aberta"]], false, 1, []), null, 1));
        var page = (await service.ExecuteAsync(session, "SELECT ID, STATUS FROM LOJA.PEDIDO UNION SELECT ID, STATUS FROM LOJA.PEDIDO", null, QueryPaging.DefaultPageSize, true, [], CancellationToken.None)).Value.Page!;

        //Act
        var target = await service.GetReadOnlyEditTargetAsync(session, page.ResultID!.Value, null, ReadOnlySql.ResultReason, CancellationToken.None);

        //Assert
        Assert.Equal(ResultEditability.ReadOnly(ReadOnlySql.ResultReason), page.Editable);
        Assert.Equal((EDatabaseFailure.ResultNotEditable, EditableSql.Union), (target.Error.Kind, target.Error.Reason));
        Assert.Equal(0, _connection.DescribeCalls);
    }

    /// <summary>O resultado que não é o atual nem um guardado responde como no `edit-target` da edição, sem ir ao catálogo.</summary>
    [Trait("DatabaseSessionService", "GetReadOnlyEditTargetAsync")]
    [Fact(DisplayName = "Erro o resultado que não está mais na sessão responde ResultChanged, como no edit-target")]
    public async Task GetReadOnlyEditTarget_ShouldBeError_WhenTheResultIsGone()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        var first = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO");
        await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO");

        //Act
        var target = await service.GetReadOnlyEditTargetAsync(session, first, null, "a conexão é somente leitura", CancellationToken.None);
        var missing = await service.GetReadOnlyEditTargetAsync(Guid.NewGuid(), first, null, "a conexão é somente leitura", CancellationToken.None);

        //Assert
        Assert.Equal(EDatabaseFailure.ResultChanged, target.Error.Kind);
        Assert.Equal(EDatabaseFailure.SessionNotFound, missing.Error.Kind);
        Assert.Equal(0, _connection.DescribeCalls);
    }
}
