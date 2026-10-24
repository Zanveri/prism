using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using static Prism.Infrastructure.Databases.Clients.WholeColumnSql;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-VAR-033 e RN-EDIT-020: a coluna inteira de um resultado cujo comando leva parâmetros. O `&lt;Q&gt;` leva os marcadores e os valores dele, e cada forma numera de novo,
/// na ordem do texto final: no PostgreSQL os do `SET` são `$1` a `$k` e os do `&lt;Q&gt;` que ficam passam a `$k+1` em diante (na forma direta, que leva só a condição,
/// os marcadores do `SELECT` saem com os valores, e os da condição são numerados de novo sem buraco); no Db2 e no Informix, os `?` do `SET` e depois os do `&lt;Q&gt;`
/// que ficaram. O caminho por lotes do Informix lê as chaves pelo `&lt;Q&gt;` com os valores dele.
/// </summary>
public sealed class WholeColumnSqlParametersTests
{
    private static readonly QueryColumn[] Columns = [new("id", "integer", "number"), new("status", "text", "text"), new("quantidade", "integer", "number")];

    private static readonly EditTarget Target = new(
        [new EditTable("loja", "pedido", [0], true, null, EditTableKind.Table, ["id"])],
        [new EditColumn(0, "id", true, null, false, null, "integer"), new EditColumn(0, "status", true, null, true, null, "varchar(20)"), new EditColumn(0, "quantidade", true, null, false, null, "integer")],
        RowOperations: true,
        OneAtATime: false);

    private static QueryParameter Text(string value) => new(EQueryParameterType.Text, value);

    private static QueryParameter Number(string value) => new(EQueryParameterType.Number, value);

    private static readonly EditChange Status = new(EEditKind.UpdateAll, 0, [], [new EditValue(1, "paga")], 3);

    private static WholeColumnPlan Planned(ESqlDialect dialect, string sql, params QueryParameter[] parameters)
    {
        var planned = Plan(dialect, sql, read: true, Target, Columns, Status, 0, requiresRows: true, parameters);
        Assert.True(planned.IsSuccess, planned.IsFailure ? planned.Error.Message : null);

        return planned.Value;
    }

    private static string[] Typed(IEnumerable<EditParameter> parameters)
        => [.. parameters.Select(parameter => parameter.Query is { } query ? $"{query.Type}:{query.Value}" : Convert.ToString(parameter.Value, System.Globalization.CultureInfo.InvariantCulture) ?? "<nulo>")];

    private static string[] Values(IEnumerable<QueryParameter>? parameters)
        => [.. (parameters ?? []).Select(parameter => $"{parameter.Type}:{parameter.Value}")];

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK no PostgreSQL a forma direta leva só a condição, e os marcadores dela são numerados de novo sem buraco, com os valores do SELECT e do ORDER BY de fora")]
    public void Plan_PostgreSql_DirectForm_ShouldRenumberTheCondition()
    {
        //Act
        var plan = Planned(ESqlDialect.PostgreSql, "SELECT $1::text AS x, id, status FROM \"loja\".\"pedido\" WHERE status = $3 AND quantidade > $2 ORDER BY $4::int", Text("sel"), Number("5"), Text("aberta"), Number("1"));

        //Assert
        Assert.Equal("SELECT COUNT(*) FROM \"loja\".\"pedido\" WHERE status = $1 AND quantidade > $2\n", plan.CountSql);
        Assert.Equal(["Text:aberta", "Number:5"], Values(plan.CountParameters));
        Assert.Equal("UPDATE \"loja\".\"pedido\" SET \"status\" = $1 WHERE status = $2 AND quantidade > $3\n", plan.Update!.Sql);
        Assert.Equal(["paga", "Text:aberta", "Number:5"], Typed(plan.Update.Parameters));
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK no PostgreSQL a forma pela chave leva o Q inteiro: a contagem como está, e o UPDATE com os marcadores do Q depois dos do SET")]
    public void Plan_PostgreSql_KeyForm_ShouldShiftTheMarkersOfTheQ()
    {
        //Arrange
        const string Sql = "SELECT $2 AS x, p.id, p.status FROM \"loja\".\"pedido\" p WHERE p.status = $1 AND p.quantidade > $2";

        //Act
        var plan = Planned(ESqlDialect.PostgreSql, Sql, Text("aberta"), Number("5"));

        //Assert
        Assert.Equal($"SELECT COUNT(*) FROM (\n{Sql}\n) AS \"q\"", plan.CountSql);
        Assert.Equal(["Text:aberta", "Number:5"], Values(plan.CountParameters));
        Assert.Equal("UPDATE \"loja\".\"pedido\" SET \"status\" = $1\nWHERE \"id\" IN (SELECT \"q\".\"id\" FROM (\nSELECT $2 AS x, p.id, p.status FROM \"loja\".\"pedido\" p WHERE p.status = $3 AND p.quantidade > $2\n) AS \"q\")", plan.Update!.Sql);
        Assert.Equal(["paga", "Number:5", "Text:aberta"], Typed(plan.Update.Parameters));
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK no Db2 a forma direta leva os ? da condição, na ordem, sem os do SELECT e do ORDER BY, e o SET vem primeiro")]
    public void Plan_Db2_DirectForm_ShouldKeepTheQuestionMarksOfTheCondition()
    {
        //Act
        var plan = Planned(ESqlDialect.Db2, "SELECT ?, id FROM \"loja\".\"pedido\" WHERE status = ? AND quantidade > ? ORDER BY ?", Text("sel"), Text("aberta"), Number("5"), Number("1"));

        //Assert
        Assert.Equal("SELECT COUNT(*) FROM \"loja\".\"pedido\" WHERE status = ? AND quantidade > ?\n", plan.CountSql);
        Assert.Equal(["Text:aberta", "Number:5"], Values(plan.CountParameters));
        Assert.Equal("UPDATE \"loja\".\"pedido\" SET \"status\" = ? WHERE status = ? AND quantidade > ?\n", plan.Update!.Sql);
        Assert.Equal(["paga", "Text:aberta", "Number:5"], Typed(plan.Update.Parameters));
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK no Db2 a forma pela chave leva o Q inteiro com todos os valores, depois do SET, no EXISTS da chave de várias colunas também")]
    public void Plan_Db2_KeyForm_ShouldCarryEveryValueOfTheQ()
    {
        //Act
        var plan = Planned(ESqlDialect.Db2, "SELECT id, status FROM \"loja\".\"pedido\" WHERE status = ? ORDER BY id FETCH FIRST ? ROWS ONLY", Text("aberta"), Number("10"));

        //Assert
        Assert.Equal(["Text:aberta", "Number:10"], Values(plan.CountParameters));
        Assert.Contains("FETCH FIRST ? ROWS ONLY\n) AS \"q\"", plan.CountSql, StringComparison.Ordinal);
        Assert.Equal(["paga", "Text:aberta", "Number:10"], Typed(plan.Update!.Parameters));
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK no Informix o caminho por lotes lê as chaves pelo Q com os valores dele, e os lotes levam só o SET e as chaves")]
    public void Plan_Informix_Batches_ShouldReadTheKeysWithTheValuesOfTheQ()
    {
        //Act
        var plan = Planned(ESqlDialect.Informix, "SELECT id, status FROM \"loja\".\"pedido\" WHERE status = ? ORDER BY id LIMIT ?", Text("aberta"), Number("10"));

        //Assert
        Assert.True(plan.ReadsKeys);
        Assert.Equal(["Text:aberta", "Number:10"], Values(plan.CountParameters));
        var batches = plan.Batches!([["1"], ["2"]]);
        Assert.True(batches.IsSuccess);
        var batch = Assert.Single(batches.Value).Command;
        Assert.Equal("UPDATE \"loja\".\"pedido\" SET \"status\" = ? WHERE \"id\" IN (?, ?)", batch.Sql);
        Assert.All(batch.Parameters, parameter => Assert.Null(parameter.Query));
        Assert.Equal(3, batch.Parameters.Count);
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK sem parâmetros o plano é o de antes: sem valores na contagem, e o SET como único parâmetro")]
    public void Plan_WithoutParameters_ShouldBeTheOldPlan()
    {
        //Act
        var plan = Planned(ESqlDialect.PostgreSql, "SELECT * FROM \"loja\".\"pedido\" WHERE status = 'aberta'");

        //Assert
        Assert.Empty(plan.CountParameters ?? []);
        Assert.Equal(["paga"], Typed(plan.Update!.Parameters));
        Assert.Equal("UPDATE \"loja\".\"pedido\" SET \"status\" = $1 WHERE status = 'aberta'\n", plan.Update.Sql);
    }

    [Trait("WholeColumnSql", "Preview")]
    [Fact(DisplayName = "OK o Ver SQL escreve o valor de cada marcador do Q como literal, e o que não tem literal fica como ? com o valor ao lado")]
    public void Preview_ShouldWriteTheMarkersAsLiterals()
    {
        //Arrange
        const string Sql = "SELECT id, status FROM \"loja\".\"pedido\" p WHERE p.status = $1 AND p.quantidade > $2 AND p.obs = $3";

        //Act
        var preview = Preview(ESqlDialect.PostgreSql, Sql, read: true, Target, Columns, Status, 0, [Text("it's"), Number("5"), Text("a\nb")]);

        //Assert
        Assert.True(preview.IsSuccess, preview.IsFailure ? preview.Error.Message : null);
        var (count, update) = (preview.Value[0], preview.Value[1]);
        Assert.Contains("WHERE p.status = 'it''s' AND p.quantidade > 5 AND p.obs = ?", count.Sql, StringComparison.Ordinal);
        Assert.Equal(["a\nb"], count.Values);
        Assert.Contains("WHERE p.status = 'it''s' AND p.quantidade > 5 AND p.obs = ?", update.Sql, StringComparison.Ordinal);
        Assert.Equal(["a\nb"], update.Values);
    }

    [Trait("WholeColumnSql", "Preview")]
    [Fact(DisplayName = "OK no Db2 o Ver SQL da forma direta escreve só os literais da condição")]
    public void Preview_Db2_DirectForm_ShouldWriteTheConditionOnly()
    {
        //Act
        var preview = Preview(ESqlDialect.Db2, "SELECT ?, id FROM \"loja\".\"pedido\" WHERE status = ? AND quantidade > ?", read: true, Target, Columns, Status, 0, [Text("x"), Text("aberta"), Number("5")]);

        //Assert
        Assert.Equal("SELECT COUNT(*) FROM \"loja\".\"pedido\" WHERE status = 'aberta' AND quantidade > 5\n", preview.Value[0].Sql);
        Assert.Equal("UPDATE \"loja\".\"pedido\" SET \"status\" = 'paga' WHERE status = 'aberta' AND quantidade > 5\n", preview.Value[1].Sql);
    }
}
