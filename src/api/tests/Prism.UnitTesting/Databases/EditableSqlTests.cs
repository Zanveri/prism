using Prism.Infrastructure.Databases.Clients;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EDIT-002 e 003: a leitura do texto do comando, sem consultar o banco. Diz quando o resultado inteiro é só leitura, e com que
/// motivo, e, quando não é, cada tabela do `FROM` (com o apelido, na ordem em que aparece, também numa junção) e de onde vem cada item
/// da lista do `SELECT`.
/// </summary>
public sealed class EditableSqlTests
{
    [Trait("EditableSql", "Read")]
    [Theory(DisplayName = "OK o que deixa o resultado inteiro só leitura tem o motivo da regra")]
    [InlineData("SELECT id FROM loja.pedido UNION SELECT id FROM loja.cliente", "união de consultas")]
    [InlineData("SELECT id FROM loja.pedido EXCEPT SELECT 1", "união de consultas")]
    [InlineData("SELECT DISTINCT status FROM loja.pedido", "DISTINCT")]
    [InlineData("SELECT DISTINCT ON (status) * FROM loja.pedido", "DISTINCT")]
    [InlineData("SELECT status, COUNT(*) FROM loja.pedido GROUP BY status", "agrupamento")]
    [InlineData("SELECT COUNT(*) FROM loja.pedido HAVING COUNT(*) > 1", "agrupamento")]
    [InlineData("SELECT * FROM loja.pedido FOR UPDATE", "SELECT ... FOR UPDATE")]
    [InlineData("SELECT * FROM loja.pedido FOR NO KEY UPDATE", "SELECT ... FOR UPDATE")]
    [InlineData("WITH x AS (SELECT * FROM loja.pedido) SELECT * FROM x", "subconsulta ou WITH no FROM")]
    [InlineData("SELECT * FROM (SELECT * FROM loja.pedido) AS x", "subconsulta ou WITH no FROM")]
    [InlineData("SELECT * FROM loja.pedido p JOIN (SELECT * FROM loja.cliente) c ON c.id = p.cliente_id", "subconsulta ou WITH no FROM")]
    [InlineData("SELECT 1", "o comando não lê uma tabela")]
    [InlineData("VALUES (1)", "o comando não é um SELECT")]
    [InlineData("SHOW search_path", "o comando não é um SELECT")]
    [InlineData("UPDATE loja.pedido SET status = 'x' RETURNING *", "o comando não é um SELECT")]
    [InlineData("SELECT * INTO nova FROM loja.pedido", "o comando não é um SELECT")]
    [InlineData("(SELECT * FROM loja.pedido)", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM ONLY loja.pedido", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM generate_series(1, 3)", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM banco.loja.pedido", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM loja.pedido p, LATERAL (SELECT 1) x", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM (loja.pedido p JOIN loja.cliente c ON c.id = p.cliente_id)", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM loja.pedido p JOIN loja.cliente c", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM loja.pedido AS p (a, b)", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM loja.pedido p, generate_series(1, 3) g", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM loja.pedido p JOIN", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM loja.pedido,", "o Prism não conseguiu saber de onde vêm as colunas")]
    public void Read_ShouldGiveTheReasonOfAReadOnlyResult(string sql, string reason)
    {
        //Act
        var source = EditableSql.Read(sql, ESqlDialect.PostgreSql);

        //Assert
        Assert.Equal(reason, source.Reason);
        Assert.Empty(source.Tables);
    }

    /// <summary>RN-EDIT-002: as junções são permitidas; cada tabela do `FROM` vem na ordem em que aparece, com o apelido.</summary>
    [Trait("EditableSql", "Read")]
    [Theory(DisplayName = "OK cada forma de junção lê as tabelas do FROM na ordem, com o apelido")]
    [InlineData("SELECT * FROM loja.pedido JOIN loja.cliente ON cliente.id = pedido.cliente_id", "loja.pedido,loja.cliente")]
    [InlineData("SELECT * FROM loja.pedido p INNER JOIN loja.cliente AS c ON c.id = p.cliente_id", "loja.pedido p,loja.cliente c")]
    [InlineData("SELECT * FROM loja.pedido p LEFT OUTER JOIN loja.cliente c ON (c.id = p.cliente_id AND c.ativo) RIGHT JOIN item i ON i.pedido_id = p.id", "loja.pedido p,loja.cliente c,item i")]
    [InlineData("SELECT * FROM loja.pedido p FULL JOIN loja.cliente c ON c.id = p.cliente_id LEFT JOIN item ON left(item.codigo, 2) = c.full AND p.left = 1", "loja.pedido p,loja.cliente c,item")]
    [InlineData("SELECT * FROM loja.pedido p CROSS JOIN loja.cliente c", "loja.pedido p,loja.cliente c")]
    [InlineData("SELECT * FROM loja.pedido p, loja.cliente c WHERE c.id = p.cliente_id", "loja.pedido p,loja.cliente c")]
    [InlineData("SELECT * FROM loja.pedido p JOIN loja.cliente c USING (id) NATURAL JOIN item", "loja.pedido p,loja.cliente c,item")]
    [InlineData("SELECT * FROM loja.pedido p JOIN loja.cliente c ON c.id IN (SELECT id FROM loja.cliente x JOIN y ON y.a = x.a) ORDER BY 1", "loja.pedido p,loja.cliente c")]
    [InlineData("SELECT * FROM pedido p JOIN pedido q ON q.pai = p.id", "pedido p,pedido q")]
    public void Read_ShouldReadEachTableOfAJoin(string sql, string tables)
    {
        //Act
        var source = EditableSql.Read(sql, ESqlDialect.PostgreSql);

        //Assert
        Assert.Null(source.Reason);
        Assert.Equal(tables.Split(','), source.Tables.Select(Written));
    }

    /// <summary>
    /// RN-EDIT-003: no Db2 e no Informix, `NATURAL JOIN` e `JOIN ... USING` com `*` deixam o resultado inteiro só leitura (a coluna da
    /// junção aparece uma vez só, e a leitura não sabe de que tabela). Com `tabela.*` ou as colunas escritas, não. No PostgreSQL quem diz
    /// de onde vem cada coluna é o banco, e a junção vale com `*`.
    /// </summary>
    [Trait("EditableSql", "Read")]
    [Theory(DisplayName = "OK NATURAL JOIN e USING com * são só leitura no Db2 e no Informix, e não no PostgreSQL")]
    [InlineData("SELECT * FROM pedido p JOIN cliente c USING (id)", "Db2", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM pedido NATURAL JOIN cliente", "Informix", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT p.*, c.nome FROM pedido p JOIN cliente c USING (id)", "Informix", null)]
    [InlineData("SELECT * FROM pedido p JOIN cliente c USING (id)", "PostgreSql", null)]
    [InlineData("SELECT * FROM pedido NATURAL LEFT JOIN cliente", "PostgreSql", null)]
    public void Read_ShouldKeepAStarOverAMergedJoinReadOnlyInDb2AndInformix(string sql, string dialect, string? reason)
    {
        //Act
        var source = EditableSql.Read(sql, Enum.Parse<ESqlDialect>(dialect));

        //Assert
        Assert.Equal(reason, source.Reason);
        Assert.Equal(reason is null ? 2 : 0, source.Tables.Count);
    }

    /// <summary>O comando do dono (2026-10-14), no Informix: as colunas de uma tabela, numa junção de três, sem apelido.</summary>
    [Trait("EditableSql", "Read")]
    [Fact(DisplayName = "OK o SELECT com junção do dono lê as três tabelas e as colunas de uma delas")]
    public void Read_ShouldReadTheOwnersJoin()
    {
        //Arrange
        const string sql = """
            select pallets_items.*
              from pallets
             inner join pallets_items on pallets_items.pallet_id = pallets.id
             inner join items on pallets_items.item_id = items.id
             where pallets.is_integrated = 1 and pallets.location_id = 6 and items.code = '66903015';
            """;

        //Act
        var source = EditableSql.Read(sql, ESqlDialect.Informix);

        //Assert
        Assert.Null(source.Reason);
        Assert.Equal(["pallets", "pallets_items", "items"], source.Tables.Select(Written));
        Assert.Equal(["pallets_items"], Assert.IsType<SelectItem.AllOf>(Assert.Single(source.Items)).Qualifier);
    }

    [Trait("EditableSql", "Read")]
    [Fact(DisplayName = "OK o comando dos Registros, com a condição e a ordem, lê uma tabela só")]
    public void Read_ShouldReadTheRecordsCommandAsOneTable()
    {
        //Arrange
        const string sql = "SELECT * FROM \"loja\".\"pedido\"\nWHERE status = 'aberta' -- union\nORDER BY \"quantidade\" DESC";

        //Act
        var source = EditableSql.Read(sql, ESqlDialect.PostgreSql);

        //Assert
        Assert.Null(source.Reason);
        var table = Assert.Single(source.Tables);
        Assert.Equal(("loja", "pedido", "\"loja\".\"pedido\"", (string?)null), (table.Name.Schema, table.Name.Name, table.Name.Written, table.Alias));
        Assert.IsType<SelectItem.All>(Assert.Single(source.Items));
    }

    /// <summary>A palavra que deixaria o resultado só leitura não conta dentro de texto, de comentário, de identificador entre aspas nem de uma subconsulta do `WHERE`.</summary>
    [Trait("EditableSql", "Read")]
    [Theory(DisplayName = "OK as palavras dentro de texto, comentário, aspas e subconsulta do WHERE não contam")]
    [InlineData("SELECT * FROM loja.pedido WHERE nota = 'UNION GROUP BY' /* DISTINCT */")]
    [InlineData("SELECT * FROM loja.pedido WHERE \"group\" = 1")]
    [InlineData("SELECT * FROM loja.pedido WHERE cliente_id IN (SELECT id FROM loja.cliente GROUP BY id UNION SELECT 1)")]
    [InlineData("SELECT * FROM loja.pedido WHERE nota = $$ JOIN $$ AND nome = E'it\\'s, JOIN'")]
    [InlineData("SELECT * FROM loja.pedido ORDER BY id LIMIT 10 OFFSET 5")]
    [InlineData("SELECT * FROM loja.pedido FETCH FIRST 3 ROWS ONLY")]
    [InlineData(";  SELECT * FROM loja.pedido;")]
    public void Read_ShouldIgnoreWordsOutsideTheTopLevel(string sql)
    {
        //Act
        var source = EditableSql.Read(sql, ESqlDialect.PostgreSql);

        //Assert
        Assert.Null(source.Reason);
        Assert.Equal("pedido", Assert.Single(source.Tables).Name.Name);
    }

    [Trait("EditableSql", "Read")]
    [Fact(DisplayName = "OK o nome sem aspas vai para as minúsculas no PostgreSQL e no Informix, e para as maiúsculas no Db2")]
    public void Read_ShouldFoldUnquotedNamesAsEachDatabase()
    {
        //Arrange
        const string sql = "select * from Loja.\"Pedido\" AS P";

        //Act
        var postgres = EditableSql.Read(sql, ESqlDialect.PostgreSql);
        var db2 = EditableSql.Read(sql, ESqlDialect.Db2);
        var informix = EditableSql.Read(sql, ESqlDialect.Informix);

        //Assert
        Assert.Equal(("loja", "Pedido", "p", "\"loja\".\"Pedido\""), (postgres.Tables[0].Name.Schema, postgres.Tables[0].Name.Name, postgres.Tables[0].Alias, postgres.Tables[0].Name.Written));
        Assert.Equal(("LOJA", "Pedido", "P"), (db2.Tables[0].Name.Schema, db2.Tables[0].Name.Name, db2.Tables[0].Alias));
        Assert.Equal(("loja", "Pedido", "p"), (informix.Tables[0].Name.Schema, informix.Tables[0].Name.Name, informix.Tables[0].Alias));
    }

    [Trait("EditableSql", "Read")]
    [Fact(DisplayName = "OK a tabela sem esquema fica com o esquema nulo")]
    public void Read_ShouldLeaveTheSchemaEmptyWhenTheCommandHasNone()
    {
        //Act
        var source = EditableSql.Read("SELECT * FROM PEDIDO WITH UR", ESqlDialect.Db2);

        //Assert
        Assert.Null(source.Reason);
        Assert.Equal((null, "PEDIDO", "\"PEDIDO\""), (source.Tables[0].Name.Schema, source.Tables[0].Name.Name, source.Tables[0].Name.Written));
    }

    [Trait("EditableSql", "Read")]
    [Fact(DisplayName = "OK cada item da lista do SELECT diz de onde vem: todas, todas de uma tabela, uma coluna com ou sem apelido, ou calculada")]
    public void Read_ShouldReadEachItemOfTheSelectList()
    {
        //Arrange
        const string sql = "SELECT p.*, id, p.status AS situacao, loja.p.\"Valor\" \"V\", quantidade * 2, 42, upper(nome) nome, NULL FROM loja.pedido p";

        //Act
        var items = EditableSql.Read(sql, ESqlDialect.PostgreSql).Items;

        //Assert
        Assert.Equal(["p"], Assert.IsType<SelectItem.AllOf>(items[0]).Qualifier);
        Assert.Equal(("", "id", "id"), Parts(items[1]));
        Assert.Equal(("p", "status", "situacao"), Parts(items[2]));
        Assert.Equal(("loja.p", "Valor", "V"), Parts(items[3]));
        Assert.All(items.Skip(4), item => Assert.IsType<SelectItem.Computed>(item));
        Assert.Equal(8, items.Count);
    }

    [Trait("EditableSql", "Read")]
    [Theory(DisplayName = "OK os modificadores do Informix na lista do SELECT ficam de fora, e o UNIQUE dele é o DISTINCT")]
    [InlineData("SELECT FIRST 10 * FROM pedido", null)]
    [InlineData("SELECT SKIP 5 LIMIT 10 * FROM pedido", null)]
    [InlineData("SELECT UNIQUE status FROM pedido", "DISTINCT")]

    [InlineData("SELECT * FROM banco:pedido", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM pedido {GROUP BY} WHERE 1 = 1", null)]
    [InlineData("SELECT * FROM pedido INTO TEMP copia", "o comando não é um SELECT")]
    public void Read_ShouldReadTheInformixForms(string sql, string? reason)
    {
        //Act
        var source = EditableSql.Read(sql, ESqlDialect.Informix);

        //Assert
        Assert.Equal(reason, source.Reason);
        if (reason is null)
        {
            Assert.Equal("pedido", Assert.Single(source.Tables).Name.Name);
            Assert.IsType<SelectItem.All>(Assert.Single(source.Items));
        }
    }

    /// <summary>RN-EDIT-002 e 003: a forma `, OUTER tabela` do Informix é uma junção; o `OUTER (...)` com parênteses fica só leitura.</summary>
    [Trait("EditableSql", "Read")]
    [Theory(DisplayName = "OK a junção , OUTER tabela do Informix lê as tabelas; com parênteses, não; e fora do Informix não é junção")]
    [InlineData("SELECT * FROM pedido p, OUTER cliente c WHERE c.id = p.cliente_id", "pedido p,cliente c")]
    [InlineData("SELECT * FROM pedido, OUTER cliente, OUTER item", "pedido,cliente,item")]
    [InlineData("SELECT * FROM pedido p, OUTER (cliente c, OUTER item i) WHERE c.id = p.cliente_id", null)]
    public void Read_ShouldReadTheInformixOuterJoin(string sql, string? tables)
    {
        //Act
        var source = EditableSql.Read(sql, ESqlDialect.Informix);
        var postgres = EditableSql.Read(sql, ESqlDialect.PostgreSql);

        //Assert
        Assert.Equal(tables is null ? EditableSql.UnknownOrigin : null, source.Reason);
        Assert.Equal(tables?.Split(',') ?? [], source.Tables.Select(Written));
        Assert.Equal(EditableSql.UnknownOrigin, postgres.Reason);
    }

    /// <summary>A tabela como a leitura a guardou: `[esquema.]nome [apelido]`.</summary>
    private static string Written(FromTable table)
        => $"{(table.Name.Schema is null ? string.Empty : $"{table.Name.Schema}.")}{table.Name.Name}{(table.Alias is null ? string.Empty : $" {table.Alias}")}";

    private static (string Qualifier, string Name, string Output) Parts(SelectItem item)
    {
        var column = Assert.IsType<SelectItem.Column>(item);

        return (string.Join('.', column.Qualifier), column.Name, column.OutputName);
    }
}
