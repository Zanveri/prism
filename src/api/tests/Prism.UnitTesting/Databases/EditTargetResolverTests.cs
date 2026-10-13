using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EDIT-002 e 003: o que se edita num resultado de uma tabela só, a partir da leitura do comando, das colunas que o banco devolveu e
/// do catálogo. No PostgreSQL a origem de cada coluna vem do próprio banco (a tabela e o número da coluna); no Db2 e no Informix, da
/// lista do `SELECT`, que tem de bater com as colunas devolvidas.
/// </summary>
public sealed class EditTargetResolverTests
{
    private const long TableID = 16384;

    private static readonly EditTableName Pedido = new("loja", "pedido", "\"loja\".\"pedido\"");

    private static readonly ColumnInfo[] Columns =
    [
        new("id", "integer", false, true, 1, null, null),
        new("status", "text", true, false, 2, null, null),
        new("total", "numeric(12,2)", false, false, 3, null, ColumnGeneration.Always),
        new("anexo", "bytea", true, false, 4, null, null),
        new("codigo", "integer", false, false, 5, null, ColumnGeneration.ByDefault)
    ];

    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK no PostgreSQL cada coluna é da tabela pelo número que o banco informa, e a calculada fica só leitura")]
    public void Resolve_ShouldMapThePostgresColumnsByTheOriginTheDatabaseGives()
    {
        //Arrange
        var result = new[] { Origin("id", 1), Origin("status", 2), Origin("total", 3), new QueryColumn("anexo", "bytea", "binary", new ColumnOrigin(TableID, 4)), Origin("codigo", 5), new QueryColumn("dobro", "integer", "number", new ColumnOrigin(0, 0)) };

        //Act
        var target = Resolve(ESqlDialect.PostgreSql, Source(new SelectItem.All()), result, Table("table"));

        //Assert
        var table = Assert.Single(target.Tables);
        Assert.Equal(("loja", "pedido", true, null), (table.Schema, table.Name, table.Editable, table.Reason));
        Assert.Equal([0], table.Key);
        Assert.Equal([(true, null), (true, null), (false, "gerada pelo banco"), (false, "coluna binária"), (true, null), (false, "coluna calculada")], target.Columns.Select(column => (column.Editable, column.Reason)));
        Assert.Equal(["id", "status", "total", "anexo", "codigo", null], target.Columns.Select(column => column.BaseColumn));
        Assert.Equal([0, 0, 0, 0, 0, null], target.Columns.Select(column => column.Table));
        Assert.Equal([false, true, false, true, false, true], target.Columns.Select(column => column.Nullable));
        Assert.Equal([null, null, ColumnGeneration.Always, null, ColumnGeneration.ByDefault, null], target.Columns.Select(column => column.Generated));
        Assert.True(target.RowOperations);
        Assert.False(target.OneAtATime);
    }

    [Trait("EditTargetResolver", "Resolve")]
    [Theory(DisplayName = "OK a visão, a tabela estrangeira e o que não é tabela ficam só leitura, com o motivo em cada coluna")]
    [InlineData("view", "pedido é uma visão")]
    [InlineData("materializedView", "pedido é uma visão materializada")]
    [InlineData("foreign", "pedido é uma tabela estrangeira")]
    [InlineData("other", "pedido não é uma tabela")]
    public void Resolve_ShouldKeepWhatIsNotATableReadOnly(string kind, string reason)
    {
        //Act
        var target = Resolve(ESqlDialect.PostgreSql, Source(new SelectItem.All()), [Origin("id", 1), Origin("status", 2)], Table(kind));

        //Assert
        Assert.Equal((false, reason), (target.Tables[0].Editable, target.Tables[0].Reason));
        Assert.Empty(target.Tables[0].Key);
        Assert.All(target.Columns, column => Assert.Equal((false, reason), (column.Editable, column.Reason)));
        Assert.False(target.RowOperations);
    }

    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK a tabela que o catálogo não acha (sinônimo, apelido de tabela) não é uma tabela")]
    public void Resolve_ShouldTellATableTheCatalogDoesNotFindIsNotATable()
    {
        //Act
        var target = Resolve(ESqlDialect.Db2, Source(new SelectItem.All()), [new QueryColumn("ID", "INTEGER", "number")], null);

        //Assert
        Assert.Equal(("pedido", "pedido não é uma tabela"), (target.Tables[0].Name, target.Tables[0].Reason));
        Assert.False(target.Columns[0].Editable);
    }

    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK sem chave primária vale a chave única de colunas não nulas; com coluna que aceita nulo, não")]
    public void Resolve_ShouldUseAUniqueKeyOfNotNullColumnsWhenThereIsNoPrimaryKey()
    {
        //Arrange
        ColumnInfo[] columns = [new("id", "integer", true, false, 1, null, null), new("codigo", "integer", false, false, 2, null, null), new("serie", "integer", false, false, 3, null, null)];
        var result = new[] { Origin("id", 1), Origin("codigo", 2), Origin("serie", 3) };
        var withUnique = Table("table", columns, [new EditKey("uq_id", false, ["id"]), new EditKey("uq_codigo_serie", false, ["codigo", "serie"])]);
        var withoutKey = Table("table", columns, [new EditKey("uq_id", false, ["id"])]);

        //Act
        var unique = Resolve(ESqlDialect.PostgreSql, Source(new SelectItem.All()), result, withUnique);
        var none = Resolve(ESqlDialect.PostgreSql, Source(new SelectItem.All()), result, withoutKey);

        //Assert
        Assert.Equal([1, 2], unique.Tables[0].Key);
        Assert.Equal((false, "pedido não tem chave primária nem chave única de colunas não nulas"), (none.Tables[0].Editable, none.Tables[0].Reason));
    }

    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK a chave que não está inteira no resultado diz quais colunas faltam")]
    public void Resolve_ShouldTellWhichKeyColumnsAreMissing()
    {
        //Act
        var target = Resolve(ESqlDialect.PostgreSql, Source(new SelectItem.All()), [Origin("status", 2)], Table("table"));

        //Assert
        Assert.Equal((false, "a chave de pedido não está inteira no resultado: faltam id"), (target.Tables[0].Editable, target.Tables[0].Reason));
    }

    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK no Db2 e no Informix a lista do SELECT diz de onde vem cada coluna, e o nome tem de bater com o que o banco devolveu")]
    public void Resolve_ShouldMapTheIbmColumnsByTheSelectList()
    {
        //Arrange
        ColumnInfo[] columns = [new("ID", "INTEGER", false, true, 1, null, null), new("STATUS", "VARCHAR(20)", true, false, 2, null, null), new("NOTA", "CLOB(1048576)", true, false, 3, null, null)];
        SelectItem[] items = [new SelectItem.AllOf(["P"]), new SelectItem.Column(["P"], "STATUS", "SITUACAO"), new SelectItem.Computed(), new SelectItem.Column([], "AGORA", "AGORA")];
        var result = new[] { Ibm("ID"), Ibm("STATUS"), Ibm("NOTA"), Ibm("SITUACAO"), Ibm("DOBRO"), Ibm("AGORA") };

        //Act
        var target = Resolve(ESqlDialect.Db2, Source(items, alias: "P"), result, Table("table", columns, [new EditKey("PK_PEDIDO", true, ["ID"])]));

        //Assert
        Assert.Equal(["ID", "STATUS", "NOTA", "STATUS", null, null], target.Columns.Select(column => column.BaseColumn));
        Assert.Equal([(true, null), (true, null), (false, "o Prism ainda não edita este tipo neste banco"), (true, null), (false, "coluna calculada"), (false, "coluna calculada")], target.Columns.Select(column => (column.Editable, column.Reason)));
        Assert.Equal(["INTEGER", "VARCHAR(20)", "CLOB(1048576)", "VARCHAR(20)", null, null], target.Columns.Select(column => column.Type));
    }

    [Trait("EditTargetResolver", "Resolve")]
    [Theory(DisplayName = "OK no Db2 e no Informix a lista que não bate com o resultado deixa o resultado inteiro só leitura")]
    [InlineData("ID")]
    [InlineData("ID,STATUS,EXTRA")]
    [InlineData("ID,OUTRA")]
    public void Resolve_ShouldRefuseAnIbmResultThatDoesNotMatchTheSelectList(string names)
    {
        //Arrange
        ColumnInfo[] columns = [new("ID", "INTEGER", false, true, 1, null, null), new("STATUS", "VARCHAR(20)", true, false, 2, null, null)];
        var result = names.Split(',').Select(Ibm).ToArray();

        //Act
        var resolved = EditTargetResolver.Resolve(ESqlDialect.Db2, Source(new SelectItem.All()), result, Table("table", columns));

        //Assert
        Assert.True(resolved.IsFailure);
        Assert.Equal((EDatabaseFailure.ResultNotEditable, EditableSql.UnknownOrigin), (resolved.Error.Kind, resolved.Error.Reason));
    }

    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK o todas-de-uma-tabela de outra tabela deixa o resultado só leitura")]
    public void Resolve_ShouldRefuseAStarOfAnotherTable()
    {
        //Act
        var resolved = EditTargetResolver.Resolve(ESqlDialect.Informix, Source(new SelectItem.AllOf(["cliente"])), [Ibm("id")], Table("table", [new("id", "INTEGER", false, true, 1, null, null)]));

        //Assert
        Assert.Equal(EditableSql.UnknownOrigin, resolved.Error.Reason);
    }

    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK o Informix sem log grava uma alteração por vez")]
    public void Resolve_ShouldCarryTheOneAtATimeOfTheCatalog()
    {
        //Arrange
        var catalog = Table("table", [new("id", "INTEGER", false, true, 1, null, null)]) with { OneAtATime = true };

        //Act
        var target = Resolve(ESqlDialect.Informix, Source(new SelectItem.All()), [Ibm("id")], catalog);

        //Assert
        Assert.True(target.OneAtATime);
    }

    [Trait("EditTargetResolver", "Same")]
    [Fact(DisplayName = "OK o alvo de antes e o de agora são o mesmo quando a tabela, a chave e as colunas não mudaram")]
    public void Same_ShouldCompareTheTargetsByValue()
    {
        //Arrange
        var result = new[] { Origin("id", 1), Origin("status", 2) };
        var before = Resolve(ESqlDialect.PostgreSql, Source(new SelectItem.All()), result, Table("table"));
        var again = Resolve(ESqlDialect.PostgreSql, Source(new SelectItem.All()), result, Table("table"));
        var view = Resolve(ESqlDialect.PostgreSql, Source(new SelectItem.All()), result, Table("view"));

        //Assert
        Assert.True(EditTargetResolver.Same(before, again));
        Assert.False(EditTargetResolver.Same(before, view));
    }

    private static EditTarget Resolve(ESqlDialect dialect, ResultSource source, IReadOnlyList<QueryColumn> result, EditCatalogTable? catalog)
    {
        var resolved = EditTargetResolver.Resolve(dialect, source, result, catalog);
        Assert.True(resolved.IsSuccess, resolved.IsFailure ? resolved.Error.Message : null);

        return resolved.Value;
    }

    private static ResultSource Source(SelectItem item)
        => Source([item]);

    private static ResultSource Source(IReadOnlyList<SelectItem> items, string? alias = null)
        => new(null, Pedido, alias, items);

    private static EditCatalogTable Table(string kind, IReadOnlyList<ColumnInfo>? columns = null, IReadOnlyList<EditKey>? keys = null)
        => new("loja", "pedido", kind, TableID, false, columns ?? Columns, keys ?? [new EditKey("pedido_pkey", true, ["id"])]);

    private static QueryColumn Origin(string name, int column)
        => new(name, "text", "text", new ColumnOrigin(TableID, column));

    private static QueryColumn Ibm(string name)
        => new(name, "VARCHAR", "text");
}
