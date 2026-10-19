using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EDIT-019 a 023: a coluna inteira no registro de sessões, com a conexão de mentira. O comando que a API guarda com o resultado (com o filtro já
/// junto) é o que a contagem e o "Salvar" executam de novo; a conferência das alterações vem antes do banco; e a coluna inteira vai primeiro no plano.
/// </summary>
public sealed partial class DatabaseSessionServiceTests
{
    private static readonly EditChange PaidEverywhere = new(EEditKind.UpdateAll, 0, [], [new EditValue(1, "paga")], 3);

    [Trait("DatabaseSessionService", "CountWholeColumnAsync")]
    [Fact(DisplayName = "OK a contagem conta o comando que a API executou, com o filtro junto, na sessão do resultado, e fecha o cursor")]
    public async Task CountWholeColumn_CountsTheCommandAsItRan()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        _connection.Outcomes.Enqueue(new QueryOutcome(new QueryPage(PedidoColumns, [["1", "aberta"]], true, 1, []), null, 1));
        var page = (await service.ExecuteAsync(session, "SELECT * FROM LOJA.PEDIDO", "STATUS = 'aberta'", QueryPaging.DefaultPageSize, false, [], CancellationToken.None)).Value.Page!;
        _connection.WholeColumnRows = 1234;

        //Act
        var counted = await service.CountWholeColumnAsync(session, page.ResultID!.Value, [PaidEverywhere with { Rows = null }], CancellationToken.None);

        //Assert
        Assert.Equal(1234, counted.Value);
        var plan = Assert.Single(_connection.Counted);
        Assert.Equal($"SELECT COUNT(*) FROM \"LOJA\".\"PEDIDO\" WHERE {DirectCondition(_connection.Executed[^1])}\n", plan.CountSql);
        Assert.Contains("STATUS = 'aberta'", plan.CountSql, StringComparison.Ordinal);
        Assert.False(_connection.HasOpenCursor);
    }

    [Trait("DatabaseSessionService", "CountWholeColumnAsync")]
    [Fact(DisplayName = "Erro a contagem com outra alteração, ou sem a coluna inteira, é EDIT_INVALID, sem ir à conexão")]
    public async Task CountWholeColumn_WithAnotherChange_IsRefusedBeforeTheConnection()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        var result = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO");

        //Act
        var mixed = await service.CountWholeColumnAsync(session, result, [PaidEverywhere, PaidOrder], CancellationToken.None);
        var none = await service.CountWholeColumnAsync(session, result, [], CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.EditInvalid, (int?)1), (mixed.Error.Kind, mixed.Error.Change));
        Assert.Equal((EDatabaseFailure.EditInvalid, (int?)null), (none.Error.Kind, none.Error.Change));
        Assert.Empty(_connection.Counted);
        Assert.Equal(0, _connection.DescribeCalls);
    }

    [Trait("DatabaseSessionService", "CountWholeColumnAsync")]
    [Fact(DisplayName = "OK a contagem vale para um resultado guardado do script; o que não está mais guardado é RESULT_CHANGED")]
    public async Task CountWholeColumn_OfAKeptResult_FollowsTheRulesOfTheKeptResults()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        var first = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO");
        var second = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO WHERE ID > 0", false, first);
        await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO", false, second);

        //Act
        var kept = await service.CountWholeColumnAsync(session, second, [PaidEverywhere], CancellationToken.None);
        var forgotten = await service.CountWholeColumnAsync(session, first, [PaidEverywhere], CancellationToken.None);

        //Assert
        Assert.True(kept.IsSuccess, kept.IsFailure ? kept.Error.Message : null);
        Assert.Equal("SELECT COUNT(*) FROM \"LOJA\".\"PEDIDO\" WHERE ID > 0\n", Assert.Single(_connection.Counted).CountSql);
        Assert.Equal(EDatabaseFailure.ResultChanged, forgotten.Error.Kind);
    }

    [Trait("DatabaseSessionService", "ApplyEditsAsync")]
    [Fact(DisplayName = "OK no Salvar a coluna inteira vai no plano, com o rows confirmado e a transação do retrato, e as alterações por linha depois")]
    public async Task ApplyEdits_WithTheWholeColumn_PlansItFirst()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        var result = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO ORDER BY ID FETCH FIRST 10 ROWS ONLY");

        //Act
        var saved = await service.ApplyEditsAsync(session, result, [PaidOrder, PaidEverywhere], CancellationToken.None);

        //Assert
        Assert.Equal(2, saved.Value);
        var (plan, wholeColumn) = Assert.Single(_connection.SavedWholeColumns);
        Assert.True(wholeColumn);
        Assert.Equal((1, (long?)3), (plan.Change, plan.Rows));
        Assert.StartsWith("UPDATE \"LOJA\".\"PEDIDO\" SET \"STATUS\" = ?\nWHERE \"ID\" IN (SELECT \"q\".\"ID\" FROM (\nSELECT ID, STATUS FROM LOJA.PEDIDO ORDER BY ID FETCH FIRST 10 ROWS ONLY\n) AS \"q\")", plan.Update!.Sql, StringComparison.Ordinal);
        Assert.Equal([0], Assert.Single(_connection.Saved).Select(command => command.Change));
    }

    [Trait("DatabaseSessionService", "ApplyEditsAsync")]
    [Fact(DisplayName = "Erro no Salvar, a coluna inteira sem rows, duas colunas inteiras e a coluna da chave são recusadas antes de ir à conexão")]
    public async Task ApplyEdits_WithAWholeColumnThatDoesNotApply_IsRefusedBeforeTheConnection()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        var result = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO");

        //Act
        var withoutRows = await service.ApplyEditsAsync(session, result, [PaidOrder, PaidEverywhere with { Rows = null }], CancellationToken.None);
        var twice = await service.ApplyEditsAsync(session, result, [PaidEverywhere, PaidEverywhere], CancellationToken.None);
        var key = await service.ApplyEditsAsync(session, result, [PaidEverywhere with { Values = [new EditValue(0, "9")] }], CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.EditInvalid, (int?)1), (withoutRows.Error.Kind, withoutRows.Error.Change));
        Assert.Equal((EDatabaseFailure.EditInvalid, (int?)1), (twice.Error.Kind, twice.Error.Change));
        Assert.Equal((EDatabaseFailure.EditAllRowsNotSupported, (int?)0, (int?)0), (key.Error.Kind, key.Error.Change, key.Error.Column));
        Assert.Empty(_connection.Saved);
    }

    [Trait("DatabaseSessionService", "PreviewEditsAsync")]
    [Fact(DisplayName = "OK o Ver SQL mostra a contagem e o UPDATE da coluna inteira antes dos comandos por linha, com a nota da contagem")]
    public async Task PreviewEdits_WithTheWholeColumn_ShowsItFirst()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        var result = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO");

        //Act
        var preview = await service.PreviewEditsAsync(session, result, [PaidOrder, PaidEverywhere with { Rows = null }], CancellationToken.None);

        //Assert
        Assert.Equal(["SELECT COUNT(*) FROM \"LOJA\".\"PEDIDO\"", "UPDATE \"LOJA\".\"PEDIDO\" SET \"STATUS\" = 'paga'", "UPDATE \"LOJA\".\"PEDIDO\" SET \"STATUS\" = 'paga' WHERE \"ID\" = 1"], preview.Value.Statements.Select(statement => statement.Sql));
        Assert.Equal([WholeColumnSql.CountNote, null, null], preview.Value.Statements.Select(statement => statement.Note));
    }

    /// <summary>A condição da forma direta do comando como a sessão o executou: o texto entre o `WHERE` e o fim.</summary>
    private static string DirectCondition(string sql)
        => WholeColumnSql.DirectConditionOf(sql, ESqlDialect.Db2)!;
}
