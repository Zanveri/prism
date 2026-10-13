using Prism.Infrastructure.Databases.Clients;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EDIT-002 e 003: a leitura do texto do comando, sem consultar o banco. Diz quando o resultado inteiro é só leitura, e com que
/// motivo, e, quando ele lê uma tabela só, qual é ela e de onde vem cada coluna da lista do `SELECT`. Nesta leitura a junção ainda é só
/// leitura: a edição entra pelos Registros, que leem uma tabela só.
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
    [InlineData("SELECT * FROM loja.pedido JOIN loja.cliente ON cliente.id = pedido.cliente_id", "junção de tabelas")]
    [InlineData("SELECT * FROM loja.pedido, loja.cliente", "junção de tabelas")]
    [InlineData("SELECT * FROM loja.pedido p LEFT OUTER JOIN loja.cliente c USING (id)", "junção de tabelas")]
    [InlineData("SELECT 1", "o comando não lê uma tabela")]
    [InlineData("VALUES (1)", "o comando não é um SELECT")]
    [InlineData("SHOW search_path", "o comando não é um SELECT")]
    [InlineData("UPDATE loja.pedido SET status = 'x' RETURNING *", "o comando não é um SELECT")]
    [InlineData("SELECT * INTO nova FROM loja.pedido", "o comando não é um SELECT")]
    [InlineData("(SELECT * FROM loja.pedido)", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM ONLY loja.pedido", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM generate_series(1, 3)", "o Prism não conseguiu saber de onde vêm as colunas")]
    [InlineData("SELECT * FROM banco.loja.pedido", "o Prism não conseguiu saber de onde vêm as colunas")]
    public void Read_ShouldGiveTheReasonOfAReadOnlyResult(string sql, string reason)
    {
        //Act
        var source = EditableSql.Read(sql, ESqlDialect.PostgreSql);

        //Assert
        Assert.Equal(reason, source.Reason);
        Assert.Null(source.Table);
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
        Assert.Equal(("loja", "pedido", "\"loja\".\"pedido\""), (source.Table!.Schema, source.Table.Name, source.Table.Written));
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
        Assert.Equal("pedido", source.Table!.Name);
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
        Assert.Equal(("loja", "Pedido", "p", "\"loja\".\"Pedido\""), (postgres.Table!.Schema, postgres.Table.Name, postgres.Alias, postgres.Table.Written));
        Assert.Equal(("LOJA", "Pedido", "P"), (db2.Table!.Schema, db2.Table.Name, db2.Alias));
        Assert.Equal(("loja", "Pedido", "p"), (informix.Table!.Schema, informix.Table.Name, informix.Alias));
    }

    [Trait("EditableSql", "Read")]
    [Fact(DisplayName = "OK a tabela sem esquema fica com o esquema nulo")]
    public void Read_ShouldLeaveTheSchemaEmptyWhenTheCommandHasNone()
    {
        //Act
        var source = EditableSql.Read("SELECT * FROM PEDIDO WITH UR", ESqlDialect.Db2);

        //Assert
        Assert.Null(source.Reason);
        Assert.Equal((null, "PEDIDO", "\"PEDIDO\""), (source.Table!.Schema, source.Table.Name, source.Table.Written));
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
    [InlineData("SELECT * FROM pedido, OUTER cliente", "junção de tabelas")]
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
            Assert.Equal("pedido", source.Table!.Name);
            Assert.IsType<SelectItem.All>(Assert.Single(source.Items));
        }
    }

    private static (string Qualifier, string Name, string Output) Parts(SelectItem item)
    {
        var column = Assert.IsType<SelectItem.Column>(item);

        return (string.Join('.', column.Qualifier), column.Name, column.OutputName);
    }
}
