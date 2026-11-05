using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-VAR-035: os valores de uma coluna e a conferência deles, sem banco: o texto de cada banco (o da regra), os nomes entre aspas, a busca escapada e como
/// parâmetro, a recusa pelo catálogo, a página (o corte do valor e da descrição, o `hasMore`) e a comparação pelo valor no tipo da coluna. RN-VAR-036: os tipos
/// que levam valores escrevem só o nome no `ToString()`.
/// </summary>
public sealed class ColumnValuesSqlTests
{
    private static readonly ColumnInfo[] Pedido =
    [
        new("id", "integer", false, true, 1, null, null),
        new("status", "character varying(20)", true, false, 2, null, null),
        new("nome", "text", true, false, 3, null, null),
        new("foto", "bytea", true, false, 4, null, null)
    ];

    private static ColumnValuesRequest Request(string column = "status", string? description = null, string? search = null, int offset = 0, int limit = 100, bool total = false)
        => new(column, description, search, offset, limit, total);

    private static ColumnInfo Column(string type)
        => new("c", type, true, false, 1, null, null);

    private static QueryParameter[] Values(params string?[] values)
        => [.. values.Select(value => new QueryParameter(EQueryParameterType.Text, value))];

    private static IReadOnlyList<int> MissingOf(EDatabaseEngine engine, string type, string?[] asked, params string?[] found)
        => ColumnValuesSql.Missing(ColumnValuesSql.Check(engine, "s", "t", Column(type), Values(asked))!, found);

    [Trait("ColumnValuesSql", "Values")]
    [Fact(DisplayName = "OK sem busca e sem descrição o texto do PostgreSQL lê o limite mais um, sem parâmetro")]
    public void Values_PostgreSql_WithoutSearch_ShouldReadOneMoreThanTheLimit()
    {
        //Act
        var (sql, parameters) = ColumnValuesSql.Values(EDatabaseEngine.PostgreSql, "loja", "pedido", Request(offset: 40, limit: 20))!.Value;

        //Assert
        Assert.Equal("SELECT DISTINCT \"status\" FROM \"loja\".\"pedido\" WHERE \"status\" IS NOT NULL ORDER BY \"status\" LIMIT 21 OFFSET 40", sql);
        Assert.Empty(parameters);
    }

    /// <summary>O texto da regra, banco a banco, com a descrição e a busca: no PostgreSQL o `$1` serve às duas colunas, no Db2 e no Informix vai um `?` por coluna.</summary>
    [Trait("ColumnValuesSql", "Values")]
    [Theory(DisplayName = "OK o texto de cada banco é o da regra, com a busca nas duas colunas")]
    [InlineData(EDatabaseEngine.PostgreSql, "SELECT DISTINCT \"c\", \"d\" FROM \"s\".\"t\" WHERE \"c\" IS NOT NULL AND (\"c\"::text ILIKE $1 ESCAPE '!' OR \"d\"::text ILIKE $1 ESCAPE '!') ORDER BY \"c\" LIMIT 101 OFFSET 0", 1)]
    [InlineData(EDatabaseEngine.Db2, "SELECT DISTINCT \"c\", \"d\" FROM \"s\".\"t\" WHERE \"c\" IS NOT NULL AND (LOWER(VARCHAR(\"c\")) LIKE LOWER(?) ESCAPE '!' OR LOWER(VARCHAR(\"d\")) LIKE LOWER(?) ESCAPE '!') ORDER BY \"c\" OFFSET 0 ROWS FETCH FIRST 101 ROWS ONLY", 2)]
    [InlineData(EDatabaseEngine.Informix, "SELECT SKIP 0 FIRST 101 DISTINCT \"c\", \"d\" FROM \"s\".\"t\" WHERE \"c\" IS NOT NULL AND (LOWER(\"c\"::LVARCHAR) LIKE LOWER(?) ESCAPE '!' OR LOWER(\"d\"::LVARCHAR) LIKE LOWER(?) ESCAPE '!') ORDER BY \"c\"", 2)]
    public void Values_WithDescriptionAndSearch_ShouldBeTheTextOfTheRule(EDatabaseEngine engine, string expected, int markers)
    {
        //Act
        var (sql, parameters) = ColumnValuesSql.Values(engine, "s", "t", Request("c", "d", "abc"))!.Value;

        //Assert
        Assert.Equal(expected, sql);
        Assert.Equal(markers, parameters.Count);
        Assert.All(parameters, parameter => Assert.Equal(new QueryParameter(EQueryParameterType.Text, "%abc%"), parameter));
    }

    /// <summary>No Db2 e no Informix o texto passa pela troca das aspas duplas de valor (`ConfigureUserCommand`); os nomes e o `ESCAPE '!'` ficam como estão.</summary>
    [Trait("ColumnValuesSql", "Values")]
    [Fact(DisplayName = "OK a troca das aspas duplas do Db2 e do Informix não mexe no texto dos valores, do total nem da conferência")]
    public void Values_IbmText_ShouldSurviveTheDoubleQuoteRewrite()
    {
        //Arrange
        var request = Request("c", "d", "abc", total: true);
        var check = Values("1", "2");

        //Act
        var texts = new[] { (Engine: EDatabaseEngine.Db2, Dialect: ESqlDialect.Db2), (Engine: EDatabaseEngine.Informix, Dialect: ESqlDialect.Informix) }.SelectMany(pair => new[]
        {
            (pair.Dialect, Sql: ColumnValuesSql.Values(pair.Engine, "s", "t", request)!.Value.Sql),
            (pair.Dialect, Sql: ColumnValuesSql.Total(pair.Engine, "s", "t", request)!.Value.Sql),
            (pair.Dialect, Sql: ColumnValuesSql.Check(pair.Engine, "s", "t", Column("INTEGER"), check)!.Sql!)
        }).ToList();

        //Assert
        Assert.Equal(6, texts.Count);
        Assert.All(texts, text => Assert.Equal(text.Sql, SqlText.RewriteDoubleQuotedLiterals(text.Sql, text.Dialect)));
    }

    [Trait("ColumnValuesSql", "Values")]
    [Fact(DisplayName = "OK o nome com aspas dupla vai com a aspa dobrada, e a busca vazia não acrescenta nada")]
    public void Values_ShouldQuoteTheNamesAndIgnoreAnEmptySearch()
    {
        //Act
        var (sql, parameters) = ColumnValuesSql.Values(EDatabaseEngine.PostgreSql, "lo\"ja", "pe\"dido", Request("sta\"tus", search: string.Empty))!.Value;

        //Assert
        Assert.Equal("SELECT DISTINCT \"sta\"\"tus\" FROM \"lo\"\"ja\".\"pe\"\"dido\" WHERE \"sta\"\"tus\" IS NOT NULL ORDER BY \"sta\"\"tus\" LIMIT 101 OFFSET 0", sql);
        Assert.Empty(parameters);
    }

    [Trait("ColumnValuesSql", "Total")]
    [Fact(DisplayName = "OK o total conta os valores diferentes com a mesma busca")]
    public void Total_ShouldCountTheDistinctValuesWithTheSameSearch()
    {
        //Act
        var (sql, parameters) = ColumnValuesSql.Total(EDatabaseEngine.PostgreSql, "s", "t", Request("c", search: "x"))!.Value;

        //Assert
        Assert.Equal("SELECT COUNT(DISTINCT \"c\") FROM \"s\".\"t\" WHERE \"c\" IS NOT NULL AND (\"c\"::text ILIKE $1 ESCAPE '!')", sql);
        Assert.Equal([new QueryParameter(EQueryParameterType.Text, "%x%")], parameters);
    }

    [Trait("ColumnValuesSql", "Values")]
    [Fact(DisplayName = "OK fora dos três bancos não há texto")]
    public void Values_OutsideTheThreeEngines_ShouldBeNull()
    {
        //Act
        var values = ColumnValuesSql.Values(EDatabaseEngine.Sqlite, "s", "t", Request());
        var check = ColumnValuesSql.Check(EDatabaseEngine.MySql, "s", "t", Column("int"), Values("1"));

        //Assert
        Assert.Null(values);
        Assert.Null(check);
        Assert.False(ColumnValuesSql.IsAvailable(EDatabaseEngine.SqlServer));
    }

    [Trait("ColumnValuesSql", "LikePattern")]
    [Fact(DisplayName = "OK a busca escapa o !, o % e o _ com !, entre %")]
    public void LikePattern_ShouldEscapeTheWildcardsAndTheEscape()
    {
        //Act
        var pattern = ColumnValuesSql.LikePattern("50%_off!");

        //Assert
        Assert.Equal("%50!%!_off!!%", pattern);
    }

    [Trait("ColumnValuesSql", "Refusal")]
    [Fact(DisplayName = "OK a coluna e a descrição da tabela, que não são binárias, passam")]
    public void Refusal_ShouldBeNull_ForColumnsOfTheTable()
    {
        //Act
        var withoutDescription = ColumnValuesSql.Refusal(Pedido, EDatabaseEngine.PostgreSql, "id", null);
        var withDescription = ColumnValuesSql.Refusal(Pedido, EDatabaseEngine.PostgreSql, "id", "nome");

        //Assert
        Assert.Null(withoutDescription);
        Assert.Null(withDescription);
    }

    [Trait("ColumnValuesSql", "Refusal")]
    [Fact(DisplayName = "Erro sem coluna nenhuma no catálogo é a tabela que não existe")]
    public void Refusal_WithoutColumns_ShouldBeTableNotFound()
    {
        //Act
        var refusal = ColumnValuesSql.Refusal([], EDatabaseEngine.PostgreSql, "id", null);

        //Assert
        Assert.Equal(EDatabaseFailure.ValuesTableNotFound, refusal!.Kind);
    }

    /// <summary>O nome é conferido como o catálogo o guarda: `ID` não é a coluna `id`.</summary>
    [Trait("ColumnValuesSql", "Refusal")]
    [Theory(DisplayName = "Erro a coluna ou a descrição que não serve é VALUES_INVALID no campo dela")]
    [InlineData(EDatabaseEngine.PostgreSql, "ID", null, "column", "A coluna não é da tabela.")]
    [InlineData(EDatabaseEngine.PostgreSql, "foto", null, "column", "A coluna é binária ou de objeto grande, e os valores dela não se listam.")]
    [InlineData(EDatabaseEngine.PostgreSql, "id", "id", "description", "A descrição é outra coluna da tabela, e não a própria coluna dos valores.")]
    [InlineData(EDatabaseEngine.PostgreSql, "id", "outra", "description", "A coluna da descrição não é da tabela.")]
    [InlineData(EDatabaseEngine.PostgreSql, "id", "foto", "description", "A coluna da descrição é binária ou de objeto grande.")]
    public void Refusal_ShouldBeValuesInvalidOnTheField(EDatabaseEngine engine, string column, string? description, string field, string message)
    {
        //Act
        var refusal = ColumnValuesSql.Refusal(Pedido, engine, column, description);

        //Assert
        Assert.Equal((EDatabaseFailure.ValuesInvalid, field, message), (refusal!.Kind, refusal.Field, refusal.Message));
    }

    [Trait("ColumnValuesSql", "Refusal")]
    [Theory(DisplayName = "Erro os tipos binários e de objeto grande de cada banco são recusados")]
    [InlineData(EDatabaseEngine.Db2, "BLOB(1048576)")]
    [InlineData(EDatabaseEngine.Db2, "CLOB")]
    [InlineData(EDatabaseEngine.Db2, "DBCLOB(100)")]
    [InlineData(EDatabaseEngine.Db2, "VARBINARY(16)")]
    [InlineData(EDatabaseEngine.Informix, "BYTE")]
    [InlineData(EDatabaseEngine.Informix, "TEXT")]
    [InlineData(EDatabaseEngine.Informix, "BLOB")]
    [InlineData(EDatabaseEngine.Informix, "CLOB")]
    public void Refusal_ShouldRefuseTheBinaryAndLargeTypes(EDatabaseEngine engine, string type)
    {
        //Act
        var refusal = ColumnValuesSql.Refusal([Column(type)], engine, "c", null);

        //Assert
        Assert.Equal((EDatabaseFailure.ValuesInvalid, "column"), (refusal!.Kind, refusal.Field));
    }

    [Trait("ColumnValuesSql", "Refusal")]
    [Fact(DisplayName = "OK o TEXT do PostgreSQL é texto, e não objeto grande")]
    public void Refusal_PostgreSqlText_ShouldPass()
    {
        //Act
        var refusal = ColumnValuesSql.Refusal([Column("text")], EDatabaseEngine.PostgreSql, "c", null);

        //Assert
        Assert.Null(refusal);
    }

    [Trait("ColumnValuesSql", "Page")]
    [Fact(DisplayName = "OK a página tira a linha a mais para o hasMore, corta o valor em 10.000 e a descrição em 200, e leva o kind da coluna")]
    public void Page_ShouldCutAndTellIfThereIsMore()
    {
        //Arrange
        var emoji = new string('a', 199) + "\U0001F600";
        var rows = new FullRows([new("c", "text", "text"), new("d", "text", "text")], [[new string('x', 10_050), new string('d', 250)], ["b", emoji], ["c", null]], 3);

        //Act
        var page = ColumnValuesSql.Page(rows, 2, 7);

        //Assert
        Assert.Equal("text", page.Kind);
        Assert.True(page.HasMore);
        Assert.Equal(7, page.Total);
        Assert.Equal(2, page.Values.Count);
        Assert.Equal((10_000, true), (page.Values[0].Value.Length, page.Values[0].Truncated));
        Assert.Equal(200, page.Values[0].Description!.Length);
        Assert.Equal(("b", false), (page.Values[1].Value, page.Values[1].Truncated));
        Assert.Equal(new string('a', 199), page.Values[1].Description);
    }

    [Trait("ColumnValuesSql", "Page")]
    [Fact(DisplayName = "OK sem a linha a mais não há mais, e sem descrição ela é nula")]
    public void Page_WithoutTheExtraRow_ShouldHaveNoMore()
    {
        //Arrange
        var rows = new FullRows([new("id", "integer", "number")], [["1"], ["2"]], 1);

        //Act
        var page = ColumnValuesSql.Page(rows, 2, null);

        //Assert
        Assert.Equal("number", page.Kind);
        Assert.False(page.HasMore);
        Assert.Null(page.Total);
        Assert.Equal(["1", "2"], page.Values.Select(value => value.Value));
        Assert.All(page.Values, value => Assert.Null(value.Description));
    }

    [Trait("ColumnValuesSql", "Check")]
    [Fact(DisplayName = "OK a conferência vai com um parâmetro por valor diferente, no tipo da coluna, e o que não converte nem vai ao banco")]
    public void Check_ShouldSendEachConvertibleValueOnce()
    {
        //Act
        var postgres = ColumnValuesSql.Check(EDatabaseEngine.PostgreSql, "loja", "pedido", Pedido[0], Values("7", "7.0", "x", null, "8"))!;
        var informix = ColumnValuesSql.Check(EDatabaseEngine.Informix, "loja", "pedido", Pedido[0], Values("7", "8"))!;

        //Assert
        Assert.Equal("SELECT DISTINCT \"id\" FROM \"loja\".\"pedido\" WHERE \"id\" IN ($1, $2)", postgres.Sql);
        Assert.Equal([new QueryParameter(EQueryParameterType.Number, "7"), new QueryParameter(EQueryParameterType.Number, "8")], postgres.Parameters);
        Assert.Equal("SELECT DISTINCT \"id\" FROM \"loja\".\"pedido\" WHERE \"id\" IN (?, ?)", informix.Sql);
    }

    [Trait("ColumnValuesSql", "Check")]
    [Fact(DisplayName = "OK nenhum valor que converte: nada vai ao banco, e todos faltam")]
    public void Check_WithoutAnyConvertibleValue_ShouldSendNothing()
    {
        //Act
        var check = ColumnValuesSql.Check(EDatabaseEngine.PostgreSql, "s", "t", Column("smallint"), Values("40000", "abc", "1.5"))!;

        //Assert
        Assert.Null(check.Sql);
        Assert.Empty(check.Parameters);
        Assert.Equal([0, 1, 2], ColumnValuesSql.Missing(check, []));
    }

    /// <summary>A comparação pelo valor: os valores pedidos contra os que o banco devolveu, no texto da grade de cada banco.</summary>
    [Trait("ColumnValuesSql", "Missing")]
    [Fact(DisplayName = "OK compara pelo valor no tipo da coluna: o número, o CHAR sem os espaços, a data pelo dia, o instante pelo instante")]
    public void Missing_ShouldCompareByTheValueOfTheColumnType()
    {
        //Act & Assert
        Assert.Equal([2, 3], MissingOf(EDatabaseEngine.PostgreSql, "integer", ["7", "7.0", "7.5", "99999999999"], "7"));
        Assert.Equal([2], MissingOf(EDatabaseEngine.PostgreSql, "numeric(12,2)", ["12.50", "1e2", "12.51"], "12.50", "100.00"));
        Assert.Equal([1], MissingOf(EDatabaseEngine.Db2, "DECIMAL(31,0)", ["5", "1" + new string('0', 31)], "5"));
        Assert.Equal([1], MissingOf(EDatabaseEngine.Informix, "MONEY(16,2)", ["3.5", "4"], "3.50"));
        Assert.Empty(MissingOf(EDatabaseEngine.PostgreSql, "double precision", ["0.1", "1e-1", "-0"], "0.1", "0"));
        Assert.Equal([1], MissingOf(EDatabaseEngine.Db2, "CHARACTER(10)", ["abc   ", "abd"], "abc       "));
        Assert.Equal([1], MissingOf(EDatabaseEngine.PostgreSql, "character varying(10)", ["abc", "abc  "], "abc"));
        Assert.Equal([2], MissingOf(EDatabaseEngine.Informix, "DATE", ["2026-10-20", "2026-10-20 13:00", "2026-10-21"], "2026-10-20"));
        Assert.Equal([1, 2], MissingOf(EDatabaseEngine.Db2, "TIMESTAMP(6)", ["2026-10-20 10:30", "2026-10-20 10:30:00-03", "2026-10-20 10:30:00.0000001"], "2026-10-20 10:30:00.000000"));
        Assert.Equal([2], MissingOf(EDatabaseEngine.PostgreSql, "timestamp with time zone", ["2026-10-20 10:30:00-03", "2026-10-20 13:30", "2026-10-20 13:30:00+01"], "2026-10-20 13:30:00+00"));
        Assert.Equal([2], MissingOf(EDatabaseEngine.PostgreSql, "boolean", ["t", "TRUE", "talvez"], "true"));
    }

    [Trait("ColumnValuesSql", "ClassOf")]
    [Theory(DisplayName = "OK a classe de comparação vem do tipo do catálogo, sem o tamanho")]
    [InlineData("numeric(12,2)", EDatabaseEngine.PostgreSql, "Decimal")]
    [InlineData("timestamp(3) with time zone", EDatabaseEngine.PostgreSql, "TimestampWithZone")]
    [InlineData("timestamp without time zone", EDatabaseEngine.PostgreSql, "Timestamp")]
    [InlineData("character(10)", EDatabaseEngine.PostgreSql, "FixedText")]
    [InlineData("character varying(20)", EDatabaseEngine.PostgreSql, "Text")]
    [InlineData("money", EDatabaseEngine.PostgreSql, "Text")]
    [InlineData("uuid", EDatabaseEngine.PostgreSql, "Text")]
    [InlineData("SERIAL8", EDatabaseEngine.Informix, "BigInteger")]
    [InlineData("DATETIME YEAR TO FRACTION(3)", EDatabaseEngine.Informix, "Timestamp")]
    [InlineData("DATETIME YEAR TO DAY", EDatabaseEngine.Informix, "Date")]
    [InlineData("SMALLFLOAT", EDatabaseEngine.Informix, "Float")]
    [InlineData("DECFLOAT(34)", EDatabaseEngine.Db2, "Decimal")]
    [InlineData("GRAPHIC(4)", EDatabaseEngine.Db2, "FixedText")]
    public void ClassOf_ShouldComeFromTheCatalogType(string type, EDatabaseEngine engine, string expected)
    {
        //Act
        var kind = ColumnValuesSql.ClassOf(type, engine);

        //Assert
        Assert.Equal(expected, kind.ToString());
    }

    [Trait("ColumnValuesSql", "ToString")]
    [Fact(DisplayName = "OK os tipos com valores, busca e linhas escrevem só o nome no ToString")]
    public void ToString_ShouldNotWriteTheValues()
    {
        //Arrange
        var check = ColumnValuesSql.Check(EDatabaseEngine.PostgreSql, "s", "t", Column("text"), Values("segredo"))!;
        object[] records =
        [
            check,
            Request(search: "segredo"),
            new ColumnValue("segredo", "segredo", false),
            new ColumnValuesPage("text", [new ColumnValue("segredo", null, false)], false, null),
            new FullRows([new("c", "text", "text")], [["segredo"]], 1)
        ];

        //Act
        var written = records.Select(record => record.ToString()!);

        //Assert
        Assert.All(written, text => Assert.DoesNotContain("segredo", text, StringComparison.Ordinal));
        Assert.Equal(["ColumnValuesCheck", "ColumnValuesRequest", "ColumnValue", "ColumnValuesPage", "FullRows"], written);
    }
}
