using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-GRADE-011: o filtro do resultado junto ao comando, sem ir ao banco. A condição entra no `WHERE` por `AND`, a ordem troca o
/// `ORDER BY` ou entra antes dos limites de cada banco, e o comando que a leitura não reconhece como um `SELECT` só vai por fora, como
/// tabela derivada. O filtro que não se junta com segurança é recusado, com o motivo.
/// </summary>
public sealed class SqlFilterTests
{
    [Trait("SqlFilter", "Apply")]
    [Theory(DisplayName = "OK a condição entra no WHERE e a ordem no lugar do ORDER BY, no PostgreSQL")]
    [InlineData("SELECT * FROM loja.pedido", "status = 'aberto'", "SELECT * FROM loja.pedido WHERE (status = 'aberto')")]
    [InlineData("SELECT * FROM loja.pedido WHERE numero > 10", "status = 'aberto' OR total > 5", "SELECT * FROM loja.pedido WHERE (numero > 10) AND (status = 'aberto' OR total > 5)")]
    [InlineData("SELECT * FROM loja.pedido ORDER BY numero", "ORDER BY total DESC", "SELECT * FROM loja.pedido ORDER BY total DESC")]
    [InlineData("SELECT * FROM loja.pedido WHERE numero > 10 ORDER BY numero LIMIT 5", "status = 'aberto' ORDER BY total DESC", "SELECT * FROM loja.pedido WHERE (numero > 10) AND (status = 'aberto') ORDER BY total DESC LIMIT 5")]
    [InlineData("SELECT * FROM loja.pedido LIMIT 5 OFFSET 10", "ORDER BY numero", "SELECT * FROM loja.pedido ORDER BY numero LIMIT 5 OFFSET 10")]
    [InlineData("SELECT * FROM loja.pedido OFFSET 2 ROWS FETCH FIRST 5 ROWS ONLY", "a = 1 ORDER BY b", "SELECT * FROM loja.pedido WHERE (a = 1) ORDER BY b OFFSET 2 ROWS FETCH FIRST 5 ROWS ONLY")]
    [InlineData("SELECT * FROM loja.pedido WHERE numero > 1 FOR UPDATE", "a = 1", "SELECT * FROM loja.pedido WHERE (numero > 1) AND (a = 1) FOR UPDATE")]
    [InlineData("SELECT * FROM loja.pedido FOR NO KEY UPDATE SKIP LOCKED", "ORDER BY b", "SELECT * FROM loja.pedido ORDER BY b FOR NO KEY UPDATE SKIP LOCKED")]
    [InlineData("SELECT DISTINCT status FROM loja.pedido", "status <> 'x' ORDER BY status", "SELECT DISTINCT status FROM loja.pedido WHERE (status <> 'x') ORDER BY status")]
    [InlineData("SELECT p.* FROM loja.pedido p JOIN loja.cliente c ON c.id = p.cliente_id WHERE c.ativo", "p.total > 100", "SELECT p.* FROM loja.pedido p JOIN loja.cliente c ON c.id = p.cliente_id WHERE (c.ativo) AND (p.total > 100)")]
    [InlineData("SELECT * FROM loja.pedido WHERE id IN (SELECT id FROM loja.item ORDER BY id LIMIT 3)", "ORDER BY id", "SELECT * FROM loja.pedido WHERE id IN (SELECT id FROM loja.item ORDER BY id LIMIT 3) ORDER BY id")]
    [InlineData("SELECT x, n FROM unnest(ARRAY[1, 2]) WITH ORDINALITY AS u(x, n)", "x = 1", "SELECT x, n FROM unnest(ARRAY[1, 2]) WITH ORDINALITY AS u(x, n) WHERE (x = 1)")]
    [InlineData("SELECT * FROM (SELECT * FROM loja.pedido) x", "x.id = 1", "SELECT * FROM (SELECT * FROM loja.pedido) x WHERE (x.id = 1)")]
    [InlineData("SELECT * FROM loja.pedido", "  /* o primeiro */ ORDER BY numero  ", "SELECT * FROM loja.pedido ORDER BY numero")]
    [InlineData("SELECT * FROM loja.pedido", "a = 1 /* no meio */ AND b = ';'", "SELECT * FROM loja.pedido WHERE (a = 1 /* no meio */ AND b = ';')")]
    [InlineData("SELECT * FROM loja.pedido", "row_number() OVER (ORDER BY id) > 1", "SELECT * FROM loja.pedido WHERE (row_number() OVER (ORDER BY id) > 1)")]
    public void Apply_ShouldMerge_OnPostgreSql(string sql, string filter, string merged)
        => AssertMerged(sql, filter, ESqlDialect.PostgreSql, merged);

    /// <summary>O comentário e o `;` em volta do comando ficam onde estavam: o que se acrescenta entra depois do último pedaço de código da cláusula.</summary>
    [Trait("SqlFilter", "Apply")]
    [Theory(DisplayName = "OK com comentário no fim do comando, o filtro entra antes dele")]
    [InlineData("SELECT * FROM loja.pedido -- todos", "a = 1", "SELECT * FROM loja.pedido WHERE (a = 1) -- todos")]
    [InlineData("SELECT * FROM loja.pedido ORDER BY 1 /* fim */", "ORDER BY 2", "SELECT * FROM loja.pedido ORDER BY 2 /* fim */")]
    [InlineData("SELECT * FROM loja.pedido;", "a = 1 ORDER BY b", "SELECT * FROM loja.pedido WHERE (a = 1) ORDER BY b;")]
    [InlineData("-- a consulta\nSELECT * FROM loja.pedido\nWHERE a = 1 -- abertos\nORDER BY b\n-- fim\n", "c = 2 ORDER BY d", "-- a consulta\nSELECT * FROM loja.pedido\nWHERE (a = 1) AND (c = 2) -- abertos\nORDER BY d\n-- fim\n")]
    public void Apply_ShouldMerge_BeforeTheCommentsAtTheEnd(string sql, string filter, string merged)
        => AssertMerged(sql, filter, ESqlDialect.PostgreSql, merged);

    [Trait("SqlFilter", "Apply")]
    [Theory(DisplayName = "OK no Db2 a ordem entra antes do FETCH FIRST, do LIMIT, do FOR READ ONLY, do OPTIMIZE FOR e do WITH UR")]
    [InlineData("SELECT * FROM PEDIDO WHERE ID > 1 ORDER BY ID FETCH FIRST 10 ROWS ONLY WITH UR", "STATUS = 'A' ORDER BY TOTAL", "SELECT * FROM PEDIDO WHERE (ID > 1) AND (STATUS = 'A') ORDER BY TOTAL FETCH FIRST 10 ROWS ONLY WITH UR")]
    [InlineData("SELECT * FROM PEDIDO WITH UR", "A = 1 ORDER BY B", "SELECT * FROM PEDIDO WHERE (A = 1) ORDER BY B WITH UR")]
    [InlineData("SELECT * FROM PEDIDO OPTIMIZE FOR 5 ROWS", "ORDER BY B", "SELECT * FROM PEDIDO ORDER BY B OPTIMIZE FOR 5 ROWS")]
    [InlineData("SELECT * FROM PEDIDO FOR READ ONLY", "A = 1", "SELECT * FROM PEDIDO WHERE (A = 1) FOR READ ONLY")]
    [InlineData("SELECT * FROM PEDIDO LIMIT 5", "ORDER BY B DESC", "SELECT * FROM PEDIDO ORDER BY B DESC LIMIT 5")]
    [InlineData("SELECT * FROM PEDIDO FOR SYSTEM_TIME AS OF CURRENT TIMESTAMP P", "P.A = 1", "SELECT * FROM PEDIDO FOR SYSTEM_TIME AS OF CURRENT TIMESTAMP P WHERE (P.A = 1)")]
    [InlineData(";SELECT * FROM PEDIDO /* <OPTGUIDELINES/> */;", "A = 1", ";SELECT * FROM PEDIDO WHERE (A = 1) /* <OPTGUIDELINES/> */;")]
    public void Apply_ShouldMerge_OnDb2(string sql, string filter, string merged)
        => AssertMerged(sql, filter, ESqlDialect.Db2, merged);

    [Trait("SqlFilter", "Apply")]
    [Theory(DisplayName = "OK no Informix o SKIP e o FIRST ficam na cabeça, e o comentário entre chaves fica no fim")]
    [InlineData("SELECT FIRST 10 * FROM pedido ORDER BY id", "status = 'a' ORDER BY total DESC", "SELECT FIRST 10 * FROM pedido WHERE (status = 'a') ORDER BY total DESC")]
    [InlineData("SELECT SKIP 5 LIMIT 10 * FROM pedido", "ORDER BY id", "SELECT SKIP 5 LIMIT 10 * FROM pedido ORDER BY id")]
    [InlineData("SELECT * FROM pedido p, OUTER cliente c WHERE c.id = p.cliente_id", "p.total > 1", "SELECT * FROM pedido p, OUTER cliente c WHERE (c.id = p.cliente_id) AND (p.total > 1)")]
    [InlineData("SELECT * FROM pedido { todos }", "a = 1", "SELECT * FROM pedido WHERE (a = 1) { todos }")]
    [InlineData("SELECT * FROM pedido FOR UPDATE", "a = 1", "SELECT * FROM pedido WHERE (a = 1) FOR UPDATE")]
    public void Apply_ShouldMerge_OnInformix(string sql, string filter, string merged)
        => AssertMerged(sql, filter, ESqlDialect.Informix, merged);

    /// <summary>A união, o agrupamento, o `WITH`, o `SELECT` sem tabela, o que começa por parêntese e o que não é `SELECT` vão por fora, com o `ORDER BY` e os limites dentro.</summary>
    [Trait("SqlFilter", "Apply")]
    [Theory(DisplayName = "OK o comando que não é um SELECT só que a leitura reconheça vai por fora")]
    [InlineData("SELECT status, count(*) AS n FROM loja.pedido GROUP BY status", "n > 1 ORDER BY n DESC", "SELECT * FROM (\nSELECT status, count(*) AS n FROM loja.pedido GROUP BY status\n) prism_filtro\nWHERE n > 1\nORDER BY n DESC")]
    [InlineData("SELECT count(*) AS n FROM loja.pedido HAVING count(*) > 1", "n > 2", "SELECT * FROM (\nSELECT count(*) AS n FROM loja.pedido HAVING count(*) > 1\n) prism_filtro\nWHERE n > 2")]
    [InlineData("SELECT id FROM loja.pedido UNION SELECT id FROM loja.item ORDER BY 1 LIMIT 3", "id > 1", "SELECT * FROM (\nSELECT id FROM loja.pedido UNION SELECT id FROM loja.item ORDER BY 1 LIMIT 3\n) prism_filtro\nWHERE id > 1")]
    [InlineData("SELECT id FROM loja.pedido EXCEPT SELECT id FROM loja.item", "ORDER BY id", "SELECT * FROM (\nSELECT id FROM loja.pedido EXCEPT SELECT id FROM loja.item\n) prism_filtro\nORDER BY id")]
    [InlineData("WITH x AS (SELECT * FROM loja.pedido) SELECT * FROM x", "ORDER BY a", "SELECT * FROM (\nWITH x AS (SELECT * FROM loja.pedido) SELECT * FROM x\n) prism_filtro\nORDER BY a")]
    [InlineData("SELECT status, count(*) FROM loja.pedido GROUP BY status -- por situação", "status = 'a'", "SELECT * FROM (\nSELECT status, count(*) FROM loja.pedido GROUP BY status\n) prism_filtro\nWHERE status = 'a'")]
    [InlineData("SELECT 1 AS a", "a = 1", "SELECT * FROM (\nSELECT 1 AS a\n) prism_filtro\nWHERE a = 1")]
    [InlineData("(SELECT * FROM loja.pedido)", "a = 1", "SELECT * FROM (\n(SELECT * FROM loja.pedido)\n) prism_filtro\nWHERE a = 1")]
    [InlineData("VALUES (1), (2);", "column1 > 1", "SELECT * FROM (\nVALUES (1), (2)\n) prism_filtro\nWHERE column1 > 1")]
    [InlineData("SELECT * INTO nova FROM loja.pedido", "a = 1", "SELECT * FROM (\nSELECT * INTO nova FROM loja.pedido\n) prism_filtro\nWHERE a = 1")]
    [InlineData("SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY total) AS p FROM loja.pedido GROUP BY status", "p > 1", "SELECT * FROM (\nSELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY total) AS p FROM loja.pedido GROUP BY status\n) prism_filtro\nWHERE p > 1")]
    [InlineData("SELECT * FROM loja.pedido ORDER BY a WHERE b = 1", "c = 1", "SELECT * FROM (\nSELECT * FROM loja.pedido ORDER BY a WHERE b = 1\n) prism_filtro\nWHERE c = 1")]
    [InlineData("SELECT * FROM loja.pedido WHERE", "c = 1", "SELECT * FROM (\nSELECT * FROM loja.pedido WHERE\n) prism_filtro\nWHERE c = 1")]
    public void Apply_ShouldWrap_OnPostgreSql(string sql, string filter, string wrapped)
        => AssertWrapped(sql, filter, ESqlDialect.PostgreSql, wrapped);

    /// <summary>A tabela derivada do Db2 e do Informix aceita `ORDER BY` e limites, mas não o fim do comando inteiro: ele vai por último, por fora.</summary>
    [Trait("SqlFilter", "Apply")]
    [Theory(DisplayName = "OK no Db2 e no Informix o fim do comando (FOR READ ONLY, OPTIMIZE FOR, WITH UR) sai da tabela derivada")]
    [InlineData(nameof(ESqlDialect.Db2), "SELECT GRUPO, COUNT(*) AS N FROM T GROUP BY GRUPO ORDER BY GRUPO FETCH FIRST 2 ROWS ONLY;", "N > 1", "SELECT * FROM (\nSELECT GRUPO, COUNT(*) AS N FROM T GROUP BY GRUPO ORDER BY GRUPO FETCH FIRST 2 ROWS ONLY\n) prism_filtro\nWHERE N > 1")]
    [InlineData(nameof(ESqlDialect.Db2), "SELECT GRUPO, COUNT(*) AS N FROM T GROUP BY GRUPO FOR READ ONLY WITH UR", "N > 1 ORDER BY N", "SELECT * FROM (\nSELECT GRUPO, COUNT(*) AS N FROM T GROUP BY GRUPO\n) prism_filtro\nWHERE N > 1\nORDER BY N\nFOR READ ONLY WITH UR")]
    [InlineData(nameof(ESqlDialect.Db2), "SELECT A FROM T UNION SELECT A FROM U OPTIMIZE FOR 1 ROWS", "A > 1", "SELECT * FROM (\nSELECT A FROM T UNION SELECT A FROM U\n) prism_filtro\nWHERE A > 1\nOPTIMIZE FOR 1 ROWS")]
    [InlineData(nameof(ESqlDialect.Informix), "SELECT FIRST 2 grupo, COUNT(*) AS n FROM t GROUP BY grupo ORDER BY n DESC", "n > 1", "SELECT * FROM (\nSELECT FIRST 2 grupo, COUNT(*) AS n FROM t GROUP BY grupo ORDER BY n DESC\n) prism_filtro\nWHERE n > 1")]
    [InlineData(nameof(ESqlDialect.Informix), "SELECT a FROM t UNION SELECT a FROM u FOR READ ONLY", "ORDER BY a", "SELECT * FROM (\nSELECT a FROM t UNION SELECT a FROM u\n) prism_filtro\nORDER BY a\nFOR READ ONLY")]
    [InlineData(nameof(ESqlDialect.Informix), "EXECUTE FUNCTION lista() { as linhas }", "a = 1", "SELECT * FROM (\nEXECUTE FUNCTION lista()\n) prism_filtro\nWHERE a = 1")]
    public void Apply_ShouldWrap_OnDb2AndInformix(string dialect, string sql, string filter, string wrapped)
        => AssertWrapped(sql, filter, Enum.Parse<ESqlDialect>(dialect), wrapped);

    /// <summary>RN-SQL-001: com mais de um comando no envio, não se sabe a qual o filtro iria; nada vai ao banco.</summary>
    [Trait("SqlFilter", "Apply")]
    [Fact(DisplayName = "Erro comando de mais de um envio com filtro")]
    public void Apply_ShouldRefuse_SeveralStatements()
    {
        //Act
        var result = SqlFilter.Apply("SELECT 1; SELECT 2", "a = 1", ESqlDialect.PostgreSql);

        //Assert
        Assert.Equal((EDatabaseFailure.MultipleStatementsNotSupported, SqlFilter.SeveralStatements), (result.Error.Kind, result.Error.Message));
    }

    [Trait("SqlFilter", "Refusal")]
    [Theory(DisplayName = "Erro filtro com ;, aspas ou comentário sem fechar, comentário no fim, parênteses sem par ou mais de um ORDER BY")]
    [InlineData("a = 1;", SqlFilter.Terminator)]
    [InlineData("a = 1; DELETE FROM loja.pedido", SqlFilter.Terminator)]
    [InlineData("a = 'x", SqlFilter.OpenQuote)]
    [InlineData("a = 'it''", SqlFilter.OpenQuote)]
    [InlineData("\"coluna = 1", SqlFilter.OpenQuote)]
    [InlineData("a = 1 /* x", SqlFilter.OpenComment)]
    [InlineData("a = 1 /* /* x */", SqlFilter.OpenComment)]
    [InlineData("a = 1 -- x", SqlFilter.EndsInComment)]
    [InlineData("a = 1 -- x\n", SqlFilter.EndsInComment)]
    [InlineData("a = 1 /* x */", SqlFilter.EndsInComment)]
    [InlineData("/* só comentário */", SqlFilter.EndsInComment)]
    [InlineData("(a = 1", SqlFilter.Parentheses)]
    [InlineData("a = 1)", SqlFilter.Parentheses)]
    [InlineData("a = 1) OR (1 = 1", SqlFilter.Parentheses)]
    [InlineData("a = 1 ORDER BY b ORDER BY c", SqlFilter.SeveralOrders)]
    [InlineData("ORDER BY b ORDER BY c", SqlFilter.SeveralOrders)]
    public void Refusal_ShouldGiveTheReason(string filter, string reason)
    {
        //Act
        var refusal = SqlFilter.Refusal(filter, ESqlDialect.PostgreSql);
        var applied = SqlFilter.Apply("SELECT * FROM loja.pedido", filter, ESqlDialect.PostgreSql);

        //Assert
        Assert.Equal(reason, refusal);
        Assert.Equal((EDatabaseFailure.FilterInvalid, reason), (applied.Error.Kind, applied.Error.Message));
    }

    /// <summary>As aspas e os comentários são os de cada banco: o `$marca$` só no PostgreSQL, a chave só no Informix, a barra que escapa só no `E'...'`.</summary>
    [Trait("SqlFilter", "Refusal")]
    [Theory(DisplayName = "OK e Erro as aspas e os comentários de cada banco")]
    [InlineData(nameof(ESqlDialect.PostgreSql), "a = $$x", SqlFilter.OpenQuote)]
    [InlineData(nameof(ESqlDialect.PostgreSql), "a = $marca$ x $marca", SqlFilter.OpenQuote)]
    [InlineData(nameof(ESqlDialect.PostgreSql), "a = E'x\\'", SqlFilter.OpenQuote)]
    [InlineData(nameof(ESqlDialect.PostgreSql), "a = $marca$;$marca$", null)]
    [InlineData(nameof(ESqlDialect.PostgreSql), "a = 'x\\'", null)]
    [InlineData(nameof(ESqlDialect.PostgreSql), "a = 1 { x", null)]
    [InlineData(nameof(ESqlDialect.Db2), "a = $x$ y", null)]
    [InlineData(nameof(ESqlDialect.Db2), "a = 1 /* /* */ */ AND b = 2", null)]
    [InlineData(nameof(ESqlDialect.Informix), "a = 1 { x", SqlFilter.OpenComment)]
    [InlineData(nameof(ESqlDialect.Informix), "a = 1 { x }", SqlFilter.EndsInComment)]
    [InlineData(nameof(ESqlDialect.Informix), "a = 1 { x } AND b = '}'", null)]
    [InlineData(nameof(ESqlDialect.Db2), "a = 1 /* /* */", SqlFilter.OpenComment)]
    [InlineData(nameof(ESqlDialect.Informix), "a = 1 /* /* */", SqlFilter.EndsInComment)]
    public void Refusal_ShouldReadTheQuotesAndCommentsOfEachDatabase(string dialect, string filter, string? reason)
        => Assert.Equal(reason, SqlFilter.Refusal(filter, Enum.Parse<ESqlDialect>(dialect)));

    [Trait("SqlFilter", "Refusal")]
    [Theory(DisplayName = "OK filtro com ; e ORDER BY dentro de aspas, de identificador e de parênteses, e a falta de filtro")]
    [InlineData("a = ';' AND \"b;c\" = 1")]
    [InlineData("x IN (SELECT y FROM loja.item ORDER BY y) ORDER BY x")]
    [InlineData("t.order = 1")]
    [InlineData("")]
    [InlineData("  \n ")]
    [InlineData(null)]
    public void Refusal_ShouldBeNull(string? filter)
        => Assert.Null(SqlFilter.Refusal(filter, ESqlDialect.PostgreSql));

    private static void AssertMerged(string sql, string filter, ESqlDialect dialect, string merged)
    {
        //Act
        var result = SqlFilter.Apply(sql, filter, dialect);

        //Assert
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        Assert.Equal((merged, EFilterApplied.Merged), (result.Value.Sql, result.Value.Applied));
    }

    private static void AssertWrapped(string sql, string filter, ESqlDialect dialect, string wrapped)
    {
        //Act
        var result = SqlFilter.Apply(sql, filter, dialect);

        //Assert
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        Assert.Equal((wrapped, EFilterApplied.Wrapped), (result.Value.Sql, result.Value.Applied));
    }
}
