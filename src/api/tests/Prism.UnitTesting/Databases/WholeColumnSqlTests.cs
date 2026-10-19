using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using static Prism.Infrastructure.Databases.Clients.WholeColumnSql;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EDIT-018, 020 e 023: a coluna inteira em cada banco. O `<Q>` limpo do fim, a forma direta só quando o texto depois da tabela é `[WHERE] [ORDER BY]`,
/// a forma pela chave sempre com `"q".` (sem ele, a coluna que o comando não devolve casaria com todas as linhas da tabela), o `EXISTS` com `"u"` na chave
/// de várias colunas, o caminho por lotes do Informix e as recusas, na ordem da regra.
/// </summary>
public sealed class WholeColumnSqlTests
{
    private const string Records = "SELECT * FROM \"loja\".\"pedido\"";

    private static readonly QueryColumn[] Columns = [new("id", "integer", "number"), new("status", "text", "text"), new("quantidade", "integer", "number"), new("dobro", "integer", "number")];

    private static readonly EditTarget Target = new(
        [new EditTable("loja", "pedido", [0], true, null, EditTableKind.Table, ["id"])],
        [new EditColumn(0, "id", true, null, false, null, "integer"), new EditColumn(0, "status", true, null, true, null, "varchar(20)"), new EditColumn(0, "quantidade", true, null, false, null, "integer"), new EditColumn(0, "dobro", false, "gerada pelo banco", true, ColumnGeneration.Always, "integer")],
        RowOperations: true,
        OneAtATime: false);

    private static EditChange Status(string? value = "paga", long? rows = 3)
        => new(EEditKind.UpdateAll, 0, [], [new EditValue(1, value)], rows);

    private static WholeColumnPlan Planned(ESqlDialect dialect, string sql, EditChange? change = null, EditTarget? target = null, IReadOnlyList<QueryColumn>? columns = null)
    {
        var planned = Plan(dialect, sql, read: true, target ?? Target, columns ?? Columns, change ?? Status(), 0, requiresRows: true);
        Assert.True(planned.IsSuccess, planned.IsFailure ? planned.Error.Message : null);

        return planned.Value;
    }

    private static DatabaseFailure Refused(ESqlDialect dialect, string sql, EditChange? change = null, EditTarget? target = null, IReadOnlyList<QueryColumn>? columns = null, bool read = true)
    {
        var planned = Plan(dialect, sql, read, target ?? Target, columns ?? Columns, change ?? Status(), 0, requiresRows: true);
        Assert.True(planned.IsFailure);

        return planned.Error;
    }

    [Trait("WholeColumnSql", "Cleaned")]
    [Theory(DisplayName = "OK o comando sai sem o ; das pontas e sem os comentários e os espaços depois do último pedaço de código")]
    [InlineData("SELECT * FROM t;", "SELECT * FROM t")]
    [InlineData("SELECT * FROM t ;; -- fim\n", "SELECT * FROM t")]
    [InlineData("SELECT * FROM t -- fim", "SELECT * FROM t")]
    [InlineData("SELECT * FROM t /* fim */\n\n", "SELECT * FROM t")]
    [InlineData(";\n  SELECT * FROM t WHERE a = ';' -- x", "SELECT * FROM t WHERE a = ';'")]
    [InlineData("SELECT * FROM t WHERE a = 1 -- meio\n AND b = 2;", "SELECT * FROM t WHERE a = 1 -- meio\n AND b = 2")]
    public void Cleaned_ShouldDropTheTailThatTheReaderSeesAfterTheEnd(string sql, string expected)
        => Assert.Equal(expected, Cleaned(sql, ESqlDialect.PostgreSql));

    [Trait("WholeColumnSql", "Cleaned")]
    [Fact(DisplayName = "OK o comentário entre chaves do Informix e o aninhado do Db2 saem do fim, como cada banco os lê")]
    public void Cleaned_ShouldReadTheCommentsOfEachEngine()
    {
        Assert.Equal("SELECT * FROM t", Cleaned("SELECT * FROM t { fim };", ESqlDialect.Informix));
        Assert.Equal("SELECT * FROM t", Cleaned("SELECT * FROM t /* a /* b */ c */", ESqlDialect.Db2));
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK nos Registros com filtro a forma é a direta, com a condição como foi escrita seguida de uma quebra de linha, e o valor em parâmetro")]
    public void Plan_OfTheRecordsWithAFilter_ShouldUseTheDirectForm()
    {
        //Act
        var plan = Planned(ESqlDialect.PostgreSql, $"{Records}\nWHERE status = 'aberta' -- as abertas\nORDER BY 1;");

        //Assert
        Assert.Equal("SELECT COUNT(*) FROM \"loja\".\"pedido\" WHERE status = 'aberta'\n", plan.CountSql);
        Assert.Equal("UPDATE \"loja\".\"pedido\" SET \"status\" = $1 WHERE status = 'aberta'\n", plan.Update!.Sql);
        Assert.Equal(["paga"], plan.Update.Parameters.Select(parameter => (string?)parameter.Value));
        Assert.Equal((0, (long?)3, false), (plan.Change, plan.Rows, plan.ReadsKeys));
    }

    [Trait("WholeColumnSql", "Plan")]
    [Theory(DisplayName = "OK sem WHERE no nível de fora, a forma direta sai sem WHERE; o WHERE de uma subconsulta da lista não conta")]
    [InlineData(Records)]
    [InlineData(Records + "\nORDER BY \"status\" DESC NULLS FIRST")]
    [InlineData("SELECT id, (SELECT max(x) FROM outra WHERE outra.y = 1) AS m FROM \"loja\".\"pedido\"")]
    public void Plan_WithoutAWhere_ShouldUseTheDirectFormWithoutWhere(string sql)
    {
        //Act
        var plan = Planned(ESqlDialect.PostgreSql, sql);

        //Assert
        Assert.Equal("SELECT COUNT(*) FROM \"loja\".\"pedido\"", plan.CountSql);
        Assert.Equal("UPDATE \"loja\".\"pedido\" SET \"status\" = $1", plan.Update!.Sql);
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK a forma direta vale com a tabela sem esquema e com o ORDER BY e o LIMIT de uma subconsulta da condição, e leva a tabela do catálogo")]
    public void Plan_DirectForm_ShouldNameTheTableOfTheCatalog()
    {
        //Act
        var plan = Planned(ESqlDialect.PostgreSql, "select * from pedido where id in (select pedido_id from item order by 1 limit 5)");

        //Assert
        Assert.Equal("UPDATE \"loja\".\"pedido\" SET \"status\" = $1 WHERE id in (select pedido_id from item order by 1 limit 5)\n", plan.Update!.Sql);
    }

    [Trait("WholeColumnSql", "Plan")]
    [Theory(DisplayName = "OK o que não é [WHERE] [ORDER BY] depois da tabela leva à forma pela chave")]
    [InlineData("PostgreSql", "SELECT * FROM \"loja\".\"pedido\" p WHERE p.status = 'a'")]
    [InlineData("PostgreSql", "SELECT * FROM \"loja\".\"pedido\" AS p")]
    [InlineData("PostgreSql", Records + " ORDER BY 1 LIMIT 5")]
    [InlineData("PostgreSql", Records + " ORDER BY 1 OFFSET 2")]
    [InlineData("PostgreSql", Records + " WHERE id > 1 FOR SHARE")]
    [InlineData("Db2", Records + " WHERE id > 1 WITH UR")]
    [InlineData("Db2", Records + " WHERE id > 1 FOR READ ONLY")]
    [InlineData("Db2", Records + " ORDER BY 1 FETCH FIRST 5 ROWS ONLY")]
    [InlineData("Db2", Records + " WHERE id > 1 OPTIMIZE FOR 5 ROWS")]
    [InlineData("Informix", "SELECT FIRST 5 * FROM \"loja\".\"pedido\" ORDER BY 1")]
    [InlineData("Informix", "SELECT SKIP 2 * FROM \"loja\".\"pedido\" ORDER BY 1")]
    [InlineData("Informix", "SELECT LIMIT 5 * FROM \"loja\".\"pedido\" ORDER BY 1")]
    [InlineData("Informix", "SELECT SKIP 1 LIMIT 5 * FROM \"loja\".\"pedido\" ORDER BY 1")]
    public void FormOf_ShouldFallBackToTheKeyForm(string dialect, string sql)
        => Assert.Equal(EForm.Key, FormOf(sql, Enum.Parse<ESqlDialect>(dialect), singleTableWithoutAlias: !sql.Contains(" p", StringComparison.Ordinal)));

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK a leitura do driver do Db2 que diverge da do banco leva à forma pela chave")]
    public void FormOf_WhenTheDb2ReadingsDiffer_ShouldUseTheKeyForm()
        => Assert.Equal(EForm.Key, FormOf(Records + " WHERE id > 1 /* a /* b */ c */ AND id < 9", ESqlDialect.Db2, singleTableWithoutAlias: true));

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK a condição da forma direta é o texto entre o WHERE e o ORDER BY de fora, com os comentários de dentro")]
    public void DirectConditionOf_ShouldBeTheTextAsWritten()
    {
        Assert.Equal("a = 1 /* x */ AND (b ORDER BY) IS NULL", DirectConditionOf(Records + " WHERE a = 1 /* x */ AND (b ORDER BY) IS NULL ORDER BY a", ESqlDialect.PostgreSql));
        Assert.Null(DirectConditionOf(Records + " ORDER BY a", ESqlDialect.PostgreSql));
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK a forma pela chave de uma coluna acha a coluna da chave pelo nome dela no resultado, SEMPRE com \"q\". na frente")]
    public void Plan_KeyForm_ShouldQualifyTheKeyByQ()
    {
        //Arrange
        QueryColumn[] columns = [new("codigo", "integer", "number"), new("status", "text", "text"), new("quantidade", "integer", "number"), new("dobro", "integer", "number")];
        const string sql = "SELECT p.id AS codigo, p.status, p.quantidade, p.dobro FROM \"loja\".\"pedido\" p WHERE p.quantidade > 1 ORDER BY 1 LIMIT 10;";

        //Act
        var plan = Planned(ESqlDialect.PostgreSql, sql, columns: columns);

        //Assert
        const string q = "SELECT p.id AS codigo, p.status, p.quantidade, p.dobro FROM \"loja\".\"pedido\" p WHERE p.quantidade > 1 ORDER BY 1 LIMIT 10";
        Assert.Equal($"SELECT COUNT(*) FROM (\n{q}\n) AS \"q\"", plan.CountSql);
        Assert.Equal($"UPDATE \"loja\".\"pedido\" SET \"status\" = $1\nWHERE \"id\" IN (SELECT \"q\".\"codigo\" FROM (\n{q}\n) AS \"q\")", plan.Update!.Sql);
        Assert.DoesNotContain("SELECT \"codigo\"", plan.Update.Sql, StringComparison.Ordinal);
        Assert.DoesNotContain("SELECT \"id\"", plan.Update.Sql, StringComparison.Ordinal);
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK a chave de várias colunas vai por EXISTS, com a tabela como \"u\" e cada coluna da chave com \"q\"., no Db2 com ? e o nome com aspas dobradas")]
    public void Plan_CompositeKey_ShouldUseExistsWithU()
    {
        //Arrange
        var target = new EditTarget(
            [new EditTable("VENDAS", "PE\"DIDO", [0, 1], true, null, EditTableKind.Table, ["LOJA", "NUMERO"])],
            [new EditColumn(0, "LOJA", true, null, false, null, "INTEGER"), new EditColumn(0, "NUMERO", true, null, false, null, "INTEGER"), new EditColumn(0, "TOTAL", true, null, true, null, "INTEGER")],
            RowOperations: true,
            OneAtATime: false);
        QueryColumn[] columns = [new("LOJA", "INTEGER", "number"), new("N", "INTEGER", "number"), new("TOTAL", "INTEGER", "number")];
        const string sql = "SELECT LOJA, NUMERO AS N, TOTAL FROM VENDAS.\"PE\"\"DIDO\" ORDER BY 1, 2 FETCH FIRST 5 ROWS ONLY";

        //Act
        var plan = Planned(ESqlDialect.Db2, sql, new EditChange(EEditKind.UpdateAll, 0, [], [new EditValue(2, "10")], 5), target, columns);

        //Assert
        Assert.Equal($"UPDATE \"VENDAS\".\"PE\"\"DIDO\" AS \"u\" SET \"TOTAL\" = ?\nWHERE EXISTS (SELECT 1 FROM (\n{sql}\n) AS \"q\" WHERE \"q\".\"LOJA\" = \"u\".\"LOJA\" AND \"q\".\"N\" = \"u\".\"NUMERO\")", plan.Update!.Sql);
        Assert.Equal([10], plan.Update.Parameters.Select(parameter => parameter.Value));
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK várias colunas vão num SET só, na ordem do pedido, com um parâmetro cada, e o nulo é o parâmetro nulo")]
    public void Plan_SeveralColumns_ShouldGoInOneSet()
    {
        //Act
        var plan = Planned(ESqlDialect.PostgreSql, Records, new EditChange(EEditKind.UpdateAll, 0, [], [new EditValue(2, "7"), new EditValue(1, null)], 0));

        //Assert
        Assert.Equal("UPDATE \"loja\".\"pedido\" SET \"quantidade\" = $1, \"status\" = $2", plan.Update!.Sql);
        Assert.Equal(["7", null], plan.Update.Parameters.Select(parameter => (string?)parameter.Value));
        Assert.Equal(0, plan.Rows);
    }

    [Trait("WholeColumnSql", "Plan")]
    [Theory(DisplayName = "OK no Informix, o LIMIT, o OFFSET e o FETCH do fim vão pelo caminho por lotes, que lê as chaves do próprio comando")]
    [InlineData("SELECT * FROM \"loja\".\"pedido\" ORDER BY 1 LIMIT 5")]
    [InlineData("SELECT * FROM \"loja\".\"pedido\" ORDER BY 1 OFFSET 2")]
    [InlineData("SELECT SKIP 1 * FROM \"loja\".\"pedido\" ORDER BY 1 LIMIT 5;")]
    public void Plan_InformixWithAnOuterLimit_ShouldReadTheKeys(string sql)
    {
        //Act
        var plan = Planned(ESqlDialect.Informix, sql);

        //Assert
        Assert.True(plan.ReadsKeys);
        Assert.Equal(Cleaned(sql, ESqlDialect.Informix), plan.CountSql);
        Assert.Equal([0], plan.KeyColumns!);
        Assert.Null(plan.Update);
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK os lotes levam até 1.000 chaves cada, como parâmetros convertidos, depois do valor do SET")]
    public void Batches_ShouldGoInBatchesOfAThousand()
    {
        //Arrange
        var plan = Planned(ESqlDialect.Informix, "SELECT * FROM \"loja\".\"pedido\" ORDER BY 1 LIMIT 2500");
        var keys = Enumerable.Range(1, 2500).Select(key => (IReadOnlyList<string>)[key.ToString(System.Globalization.CultureInfo.InvariantCulture)]).ToList();

        //Act
        var batches = plan.Batches!(keys).Value;

        //Assert
        Assert.Equal([1000, 1000, 500], batches.Select(batch => batch.Keys));
        Assert.StartsWith("UPDATE \"loja\".\"pedido\" SET \"status\" = ? WHERE \"id\" IN (?, ?, ", batches[0].Command.Sql, StringComparison.Ordinal);
        Assert.Equal(1001, batches[0].Command.Parameters.Count);
        Assert.Equal(["paga", 1, 2], batches[0].Command.Parameters.Take(3).Select(parameter => parameter.Value));
        Assert.Equal(2001, batches[2].Command.Parameters[1].Value);
        Assert.All(batches, batch => Assert.Equal(0, batch.Command.Change));
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK no caminho por lotes, a chave de várias colunas é um OR de pares")]
    public void Batches_OfACompositeKey_ShouldBeAnOrOfPairs()
    {
        //Arrange
        var target = new EditTarget(
            [new EditTable("dono", "pedido", [0, 1], true, null, EditTableKind.Table, ["loja", "numero"])],
            [new EditColumn(0, "loja", true, null, false, null, "integer"), new EditColumn(0, "numero", true, null, false, null, "integer"), new EditColumn(0, "total", true, null, true, null, "integer")],
            RowOperations: true,
            OneAtATime: false);
        QueryColumn[] columns = [new("loja", "integer", "number"), new("numero", "integer", "number"), new("total", "integer", "number")];
        var plan = Planned(ESqlDialect.Informix, "SELECT * FROM dono.pedido ORDER BY 1, 2 LIMIT 2", new EditChange(EEditKind.UpdateAll, 0, [], [new EditValue(2, "3")], 2), target, columns);

        //Act
        var batch = Assert.Single(plan.Batches!([["1", "10"], ["2", "20"]]).Value);

        //Assert
        Assert.Equal("UPDATE \"dono\".\"pedido\" SET \"total\" = ? WHERE (\"loja\" = ? AND \"numero\" = ?) OR (\"loja\" = ? AND \"numero\" = ?)", batch.Command.Sql);
        Assert.Equal([3, 1, 10, 2, 20], batch.Command.Parameters.Select(parameter => parameter.Value));
        Assert.Equal(2, batch.Keys);
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK fora do Informix, o LIMIT de fora com ORDER BY fica na tabela derivada, pela chave")]
    public void Plan_PostgresAndDb2WithAnOuterLimit_ShouldUseTheKeyForm()
    {
        Assert.False(Planned(ESqlDialect.PostgreSql, Records + " ORDER BY 1 LIMIT 5 OFFSET 2").ReadsKeys);
        Assert.False(Planned(ESqlDialect.Db2, Records + " ORDER BY 1 LIMIT 5 OFFSET 2").ReadsKeys);
        Assert.False(Planned(ESqlDialect.Informix, "SELECT SKIP 2 FIRST 5 * FROM \"loja\".\"pedido\" ORDER BY 1").ReadsKeys);
    }

    [Trait("WholeColumnSql", "Plan")]
    [Theory(DisplayName = "OK o limite de linhas sem ORDER BY no mesmo nível é recusado, também dentro de parênteses; o nome qualificado e o texto não contam")]
    [InlineData("PostgreSql", Records + " LIMIT 5", true)]
    [InlineData("PostgreSql", Records + " OFFSET 5", true)]
    [InlineData("PostgreSql", Records + " WHERE id IN (SELECT id FROM \"loja\".\"pedido\" LIMIT 5) ORDER BY 1", true)]
    [InlineData("PostgreSql", Records + " WHERE id IN (SELECT id FROM \"loja\".\"pedido\" ORDER BY 1 LIMIT 5)", false)]
    [InlineData("PostgreSql", "SELECT * FROM (SELECT * FROM \"loja\".\"pedido\" ORDER BY 1) x LIMIT 5", true)]
    [InlineData("PostgreSql", Records + " WHERE status = 'LIMIT 5' AND p.limit = 1", false)]
    [InlineData("Db2", Records + " FETCH FIRST 5 ROWS ONLY", true)]
    [InlineData("Db2", Records + " ORDER BY 1 FETCH NEXT 5 ROWS ONLY", false)]
    [InlineData("Informix", "SELECT FIRST 5 * FROM \"loja\".\"pedido\"", true)]
    [InlineData("Informix", "SELECT SKIP 2 * FROM \"loja\".\"pedido\"", true)]
    [InlineData("Informix", "SELECT LIMIT 5 * FROM \"loja\".\"pedido\"", true)]
    [InlineData("Informix", "SELECT first FROM \"loja\".\"pedido\"", false)]
    public void Plan_WithARowLimitWithoutOrder_ShouldBeRefused(string dialect, string sql, bool refused)
    {
        var planned = Plan(Enum.Parse<ESqlDialect>(dialect), sql, read: true, Target, Columns, Status(), 0, requiresRows: true);

        Assert.Equal(refused, planned.IsFailure && planned.Error.Reason == LimitReason);
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK as recusas da coluna inteira vêm com o código, a frase da regra, a posição e, quando é de uma coluna, a dela")]
    public void Plan_ShouldRefuseWithTheReasonsOfTheRule()
    {
        //Arrange
        var join = Target with { RowOperations = false, Tables = [Target.Tables[0], Target.Tables[0] with { Name = "item" }] };
        QueryColumn[] repeated = [new("id", "integer", "number"), new("status", "text", "text"), new("id", "integer", "number"), new("dobro", "integer", "number")];

        //Act
        var refusals = new[]
        {
            Refused(ESqlDialect.PostgreSql, Records, target: join),
            Refused(ESqlDialect.PostgreSql, Records, new EditChange(EEditKind.UpdateAll, 0, [], [new EditValue(0, "1")], 3)),
            Refused(ESqlDialect.PostgreSql, Records, columns: repeated),
            Refused(ESqlDialect.PostgreSql, Records, read: false),
            Refused(ESqlDialect.PostgreSql, "SELECT * FROM \"loja\".\"pedido\" WHERE nextval('s') > 0"),
            Refused(ESqlDialect.PostgreSql, Records + " TABLESAMPLE SYSTEM (10)")
        };

        //Assert
        Assert.All(refusals, refusal => Assert.Equal(EDatabaseFailure.EditAllRowsNotSupported, refusal.Kind));
        Assert.Equal([JoinReason, KeyReason("id", "pedido"), RepeatedKeyReason("id", "pedido"), NotReadReason, NotReadReason, SampleReason], refusals.Select(refusal => refusal.Reason));
        Assert.Equal([null, 0, 0, null, null, null], refusals.Select(refusal => refusal.Column));
        Assert.All(refusals, refusal => Assert.Equal(0, refusal.Change));
        Assert.Equal($"A coluna inteira não se altera neste resultado: {SampleReason}.", refusals[^1].Message);
        Assert.Equal("id é da chave de pedido: na coluna inteira, todas as linhas ficariam com a mesma chave", refusals[1].Reason);
        Assert.Equal("id, da chave de pedido, aparece com o mesmo nome em mais de uma coluna do resultado", refusals[2].Reason);
    }

    [Trait("WholeColumnSql", "Plan")]
    [Theory(DisplayName = "OK o que não se aplica é EDIT_INVALID com a alteração e a coluna, antes do banco")]
    [InlineData("sem-rows", null, "Informe quantas linhas a contagem deu (rows).")]
    [InlineData("rows-negativo", null, "O número de linhas (rows) tem de ser um inteiro de 0 em diante.")]
    [InlineData("vazia", null, "A alteração da coluna inteira não tem nenhuma coluna.")]
    [InlineData("repetida", 1, "A mesma coluna aparece duas vezes na alteração.")]
    [InlineData("gerada", 3, "A coluna não se edita: gerada pelo banco.")]
    [InlineData("fora", 9, "A coluna não existe no resultado.")]
    [InlineData("tabela", null, "A tabela da alteração não existe neste resultado.")]
    [InlineData("valor", 2, "Valor inválido para inteiro: \"muitos\".")]
    public void Plan_ShouldRefuseWhatDoesNotApply(string @case, int? column, string message)
    {
        //Arrange
        var change = @case switch
        {
            "sem-rows" => Status(rows: null),
            "rows-negativo" => Status(rows: -1),
            "vazia" => new EditChange(EEditKind.UpdateAll, 0, [], [], 3),
            "repetida" => new EditChange(EEditKind.UpdateAll, 0, [], [new EditValue(1, "a"), new EditValue(1, "b")], 3),
            "gerada" => new EditChange(EEditKind.UpdateAll, 0, [], [new EditValue(3, "1")], 3),
            "fora" => new EditChange(EEditKind.UpdateAll, 0, [], [new EditValue(9, "1")], 3),
            "tabela" => new EditChange(EEditKind.UpdateAll, 4, [], [new EditValue(1, "1")], 3),
            _ => new EditChange(EEditKind.UpdateAll, 0, [], [new EditValue(2, "muitos")], 3)
        };

        //Act
        var refusal = Refused(@case == "valor" ? ESqlDialect.Informix : ESqlDialect.PostgreSql, Records, change);

        //Assert
        Assert.Equal((EDatabaseFailure.EditInvalid, (int?)0, column), (refusal.Kind, refusal.Change, refusal.Column));
        if (@case != "valor")
            Assert.Equal(message, refusal.Message);
    }

    [Trait("WholeColumnSql", "Plan")]
    [Fact(DisplayName = "OK a contagem da pergunta não precisa do rows, e o \"Ver SQL\" também não")]
    public void Plan_WithoutRows_ShouldServeTheCount()
    {
        var planned = Plan(ESqlDialect.PostgreSql, Records, read: true, Target, Columns, Status(rows: null), 0, requiresRows: false);

        Assert.True(planned.IsSuccess);
        Assert.Null(planned.Value.Rows);
    }

    [Trait("WholeColumnSql", "Preview")]
    [Fact(DisplayName = "OK o Ver SQL mostra a contagem com a nota dela e o UPDATE com o valor como literal")]
    public void Preview_ShouldShowTheCountAndTheUpdate()
    {
        //Act
        var statements = Preview(ESqlDialect.PostgreSql, Records + "\nWHERE id > 1", read: true, Target, Columns, Status("it's"), 0).Value;

        //Assert
        Assert.Equal(
        [
            new EditStatement("SELECT COUNT(*) FROM \"loja\".\"pedido\" WHERE id > 1\n", [], CountNote),
            new EditStatement("UPDATE \"loja\".\"pedido\" SET \"status\" = 'it''s' WHERE id > 1\n", [])
        ], statements, new StatementComparer());
    }

    [Trait("WholeColumnSql", "Preview")]
    [Fact(DisplayName = "OK no caminho por lotes, o Ver SQL mostra o comando que lê as chaves e o UPDATE do primeiro lote, com ? no lugar das chaves")]
    public void Preview_OfTheBatches_ShouldShowTheKeysReadAndTheFirstBatch()
    {
        //Act
        var statements = Preview(ESqlDialect.Informix, "SELECT * FROM \"loja\".\"pedido\" ORDER BY 1 LIMIT 5;", read: true, Target, Columns, Status(), 0).Value;

        //Assert
        Assert.Equal(
        [
            new EditStatement("SELECT * FROM \"loja\".\"pedido\" ORDER BY 1 LIMIT 5", [], CountNote),
            new EditStatement("UPDATE \"loja\".\"pedido\" SET \"status\" = 'paga' WHERE \"id\" IN (?, ?, …)", [], BatchNote)
        ], statements, new StatementComparer());
    }

    [Trait("WholeColumnSql", "Find")]
    [Fact(DisplayName = "OK há no máximo uma coluna inteira por pedido, em qualquer lugar da lista; a contagem leva só ela")]
    public void Find_And_OnlyOne_ShouldRefuseWhatTheRuleRefuses()
    {
        EditChange update = new(EEditKind.Update, 0, ["1"], [new EditValue(1, "a")]);

        Assert.Equal(1, Find([update, Status()]).Value);
        Assert.Null(Find([update]).Value);
        Assert.Equal((EDatabaseFailure.EditInvalid, (int?)2), (Find([Status(), update, Status()]).Error.Kind, Find([Status(), update, Status()]).Error.Change));
        Assert.Equal(0, OnlyOne([Status()]).Value);
        Assert.Equal((int?)1, OnlyOne([Status(), update]).Error.Change);
        Assert.Equal((int?)1, OnlyOne([Status(), Status()]).Error.Change);
        Assert.Null(OnlyOne([]).Error.Change);
        Assert.Equal("A contagem precisa da alteração da coluna inteira (updateAll).", OnlyOne([]).Error.Message);
    }

    [Trait("WholeColumnSql", "Messages")]
    [Fact(DisplayName = "OK os detalhes do RESULT_CHANGED começam pela frase da regra, com o número com ponto nos milhares e o singular de uma linha")]
    public void Messages_ShouldFollowTheRule()
    {
        Assert.Equal("O resultado mudou desde a contagem: o comando devolve agora 1.240 linhas, e não as 1.234 confirmadas. Nada foi gravado; salve de novo para contar outra vez.", CountChanged(1240, 1234));
        Assert.Equal("O resultado mudou desde a contagem: o comando devolve agora 1 linha, e não a 1 confirmada. Nada foi gravado; salve de novo para contar outra vez.", CountChanged(1, 1));
        Assert.StartsWith("O resultado mudou desde a contagem: o comando alterou 1.240 linhas, e não as 1.234 confirmadas. Nada foi gravado; salve de novo para contar outra vez. Se o número se repetir", UpdateChanged(1240, 1234), StringComparison.Ordinal);
        Assert.Equal("A coluna inteira foi alterada em 0 linhas, e não nas 1.000.000 contadas: o resultado mudou desde a contagem. Este banco não tem log de transação, e a alteração ficou gravada.", WrittenAnyway(0, 1_000_000));
    }

    /// <summary>O `EditStatement` tem uma lista, que o `record` compara pela referência.</summary>
    private sealed class StatementComparer : IEqualityComparer<EditStatement>
    {
        public bool Equals(EditStatement? x, EditStatement? y)
            => x is not null && y is not null && x.Sql == y.Sql && x.Note == y.Note && x.Values.SequenceEqual(y.Values);

        public int GetHashCode(EditStatement obj)
            => obj.Sql.GetHashCode(StringComparison.Ordinal);
    }
}
