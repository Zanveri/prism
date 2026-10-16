using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EDIT-002 e 003: o que se edita num resultado, tabela por tabela do `FROM` e coluna por coluna, a partir da leitura do comando, das
/// colunas que o banco devolveu e do catálogo. No PostgreSQL a origem de cada coluna vem do próprio banco (a tabela e o número da
/// coluna); no Db2 e no Informix, da lista do `SELECT`, que tem de bater com as colunas devolvidas.
/// </summary>
public sealed class EditTargetResolverTests
{
    private const long TableID = 16384;

    private const long ClienteID = 16390;

    private static readonly EditTableName Pedido = new("loja", "pedido", "\"loja\".\"pedido\"");

    private static readonly EditTableName Cliente = new("loja", "cliente", "\"loja\".\"cliente\"");

    private static readonly EditCatalogTable ClienteTable = new("loja", "cliente", "table", ClienteID, false, [new("id", "integer", false, true, 1, null, null), new("nome", "text", true, false, 2, null, null), new("criado", "date", true, false, 3, null, null)], [new EditKey("cliente_pkey", true, ["id"])]);

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

    /// <summary>
    /// RN-EDIT-016: no PostgreSQL o `serial` e o `bigserial` são só um padrão (`nextval(...)`), e o catálogo não os diz gerados (RN-CAT-001); o alvo
    /// da edição os diz "por padrão", como a identidade "por padrão", para o "Duplicar linha" deixar o banco gerar o valor da linha nova.
    /// </summary>
    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK no PostgreSQL a coluna cujo padrão é nextval(...) é gerada por padrão, e continua editável")]
    public void Resolve_ShouldTellAPostgresColumnWhoseDefaultIsNextvalIsGeneratedByDefault()
    {
        //Arrange
        ColumnInfo[] columns =
        [
            new("id", "integer", false, true, 1, "nextval('loja.pedido_id_seq'::regclass)", null),
            new("numero", "bigint", false, false, 2, "  NEXTVAL('pedido_numero_seq'::regclass) ", null),
            new("status", "text", true, false, 3, "'nextval(x)'::text", null),
            new("quantidade", "integer", false, false, 4, "0", null),
            new("codigo", "integer", false, false, 5, null, ColumnGeneration.ByDefault),
            new("total", "numeric(12,2)", false, false, 6, "(quantidade * 2)", ColumnGeneration.Always)
        ];
        var result = new[] { Origin("id", 1), Origin("numero", 2), Origin("status", 3), Origin("quantidade", 4), Origin("codigo", 5), Origin("total", 6) };

        //Act
        var target = Resolve(ESqlDialect.PostgreSql, Source(new SelectItem.All()), result, Table("table", columns));

        //Assert
        Assert.Equal([ColumnGeneration.ByDefault, ColumnGeneration.ByDefault, null, null, ColumnGeneration.ByDefault, ColumnGeneration.Always], target.Columns.Select(column => column.Generated));
        Assert.Equal([true, true, true, true, true, false], target.Columns.Select(column => column.Editable));
        Assert.True(target.RowOperations);
    }

    /// <summary>RN-EDIT-016: só o PostgreSQL tem o padrão `nextval`; no Db2 e no Informix vale o que o catálogo diz (o `SERIAL` do Informix já é "por padrão").</summary>
    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK no Db2 e no Informix o padrão não muda o que o catálogo diz da geração")]
    public void Resolve_ShouldKeepTheGenerationTheCatalogGivesOutsidePostgres()
    {
        //Arrange
        var table = new EditCatalogTable("LOJA", "PEDIDO", "table", null, false, [new("ID", "INTEGER", false, true, 1, "nextval('x')", null), new("STATUS", "VARCHAR(20)", true, false, 2, null, null)], [new EditKey("PK_PEDIDO", true, ["ID"])]);
        var source = new ResultSource(null, [new FromTable(new EditTableName("LOJA", "PEDIDO", "\"LOJA\".\"PEDIDO\""), null)], [new SelectItem.All()]);

        //Act
        var target = Resolve(ESqlDialect.Db2, source, [Ibm("ID"), Ibm("STATUS")], table);

        //Assert
        Assert.Equal([null, null], target.Columns.Select(column => column.Generated));
    }

    /// <summary>RN-EDIT-005: o "Salvar" confere que o alvo de dentro da transação é o mesmo; a coluna `serial` sai igual nas duas consultas.</summary>
    [Trait("EditTargetResolver", "Same")]
    [Fact(DisplayName = "OK o alvo com a coluna serial é o mesmo quando o catálogo responde igual")]
    public void Same_ShouldHoldForTheSameSerialColumn()
    {
        //Arrange
        ColumnInfo[] columns = [new("id", "integer", false, true, 1, "nextval('loja.pedido_id_seq'::regclass)", null), new("status", "text", true, false, 2, null, null)];
        var result = new[] { Origin("id", 1), Origin("status", 2) };

        //Act
        var before = Resolve(ESqlDialect.PostgreSql, Source(new SelectItem.All()), result, Table("table", columns));
        var now = Resolve(ESqlDialect.PostgreSql, Source(new SelectItem.All()), result, Table("table", columns));
        var withoutDefault = Resolve(ESqlDialect.PostgreSql, Source(new SelectItem.All()), result, Table("table", [columns[0] with { DefaultValue = null }, columns[1]]));

        //Assert
        Assert.True(EditTargetResolver.Same(before, now));
        Assert.False(EditTargetResolver.Same(before, withoutDefault));
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
        var target = Resolve(ESqlDialect.Db2, Source(new SelectItem.All()), [new QueryColumn("ID", "INTEGER", "number")], (EditCatalogTable?)null);

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
        var resolved = EditTargetResolver.Resolve(ESqlDialect.Db2, Source(new SelectItem.All()), result, [Table("table", columns)]);

        //Assert
        Assert.True(resolved.IsFailure);
        Assert.Equal((EDatabaseFailure.ResultNotEditable, EditableSql.UnknownOrigin), (resolved.Error.Kind, resolved.Error.Reason));
    }

    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK o todas-de-uma-tabela de outra tabela deixa o resultado só leitura")]
    public void Resolve_ShouldRefuseAStarOfAnotherTable()
    {
        //Act
        var resolved = EditTargetResolver.Resolve(ESqlDialect.Informix, Source(new SelectItem.AllOf(["cliente"])), [Ibm("id")], [Table("table", [new("id", "INTEGER", false, true, 1, null, null)])]);

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

    /// <summary>RN-EDIT-002: na junção, cada tabela se edita pela chave dela; a coluna da chave não se edita, e as outras sim.</summary>
    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK no PostgreSQL a junção edita cada coluna na tabela de onde ela veio, menos as da chave, e não tem linha nova nem exclusão")]
    public void Resolve_ShouldEditEachColumnOfAPostgresJoinInItsOwnTable()
    {
        //Arrange
        var result = new[] { Origin("id", 1), Origin("status", 2), Origin("id", 1, ClienteID), Origin("nome", 2, ClienteID), new QueryColumn("dobro", "integer", "number", new ColumnOrigin(0, 0)) };

        //Act
        var target = Resolve(ESqlDialect.PostgreSql, Join(new SelectItem.All()), result, Table("table"), ClienteTable);

        //Assert
        Assert.Equal([("pedido", true, null), ("cliente", true, null)], target.Tables.Select(table => (table.Name, table.Editable, table.Reason)));
        Assert.Equal([[0], [2]], target.Tables.Select(table => table.Key.ToArray()));
        Assert.Equal([0, 0, 1, 1, null], target.Columns.Select(column => column.Table));
        Assert.Equal([(false, "coluna da chave numa junção"), (true, null), (false, "coluna da chave numa junção"), (true, null), (false, "coluna calculada")], target.Columns.Select(column => (column.Editable, column.Reason)));
        Assert.False(target.RowOperations);
    }

    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK na junção a tabela sem a chave inteira no resultado fica só leitura, e a outra continua editável")]
    public void Resolve_ShouldKeepOnlyTheTableWithoutItsKeyReadOnlyInAJoin()
    {
        //Arrange
        var result = new[] { Origin("id", 1), Origin("status", 2), Origin("nome", 2, ClienteID) };

        //Act
        var target = Resolve(ESqlDialect.PostgreSql, Join(new SelectItem.All()), result, Table("table"), ClienteTable);

        //Assert
        Assert.Equal((true, null), (target.Tables[0].Editable, target.Tables[0].Reason));
        Assert.Equal((false, "a chave de cliente não está inteira no resultado: faltam id"), (target.Tables[1].Editable, target.Tables[1].Reason));
        Assert.Equal([false, true, false], target.Columns.Select(column => column.Editable));
        Assert.Equal("a chave de cliente não está inteira no resultado: faltam id", target.Columns[2].Reason);
    }

    /// <summary>RN-EDIT-002: a mesma tabela duas vezes, ou duas de mesmo nome em esquemas diferentes, ficam só leitura.</summary>
    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK a tabela que aparece mais de uma vez no FROM, mesmo noutro esquema, fica só leitura")]
    public void Resolve_ShouldKeepATableThatAppearsTwiceReadOnly()
    {
        //Arrange
        var twice = new ResultSource(null, [new FromTable(Pedido, "p"), new FromTable(Pedido, "q"), new FromTable(Cliente, null)], [new SelectItem.All()]);
        var elsewhere = new ResultSource(null, [new FromTable(Pedido, null), new FromTable(new EditTableName("arquivo", "pedido", "\"arquivo\".\"pedido\""), null)], [new SelectItem.All()]);
        var result = new[] { Origin("id", 1), Origin("status", 2), Origin("id", 1, ClienteID), Origin("nome", 2, ClienteID) };

        //Act
        var same = Resolve(ESqlDialect.PostgreSql, twice, result, Table("table"), Table("table"), ClienteTable);
        var other = Resolve(ESqlDialect.PostgreSql, elsewhere, [Origin("id", 1), Origin("id", 1, 17000)], Table("table"), Table("table") with { Schema = "arquivo", Id = 17000 });

        //Assert
        Assert.Equal([(false, "pedido aparece mais de uma vez no comando"), (false, "pedido aparece mais de uma vez no comando"), (true, null)], same.Tables.Select(table => (table.Editable, table.Reason)));
        Assert.Equal([0, 0, 2, 2], same.Columns.Select(column => column.Table));
        Assert.Equal([false, false, false, true], same.Columns.Select(column => column.Editable));
        Assert.Equal([false, false], other.Tables.Select(table => table.Editable));
        Assert.Equal([0, 1], other.Columns.Select(column => column.Table));
    }

    /// <summary>RN-EDIT-003: no Db2 e no Informix o `*` de uma junção são as colunas de cada tabela, na ordem do catálogo, tabela por tabela, na ordem do `FROM`.</summary>
    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK no Db2 o * de uma junção são as colunas de cada tabela na ordem do FROM, e cada uma se edita na sua")]
    public void Resolve_ShouldExpandTheStarOfAnIbmJoinTableByTable()
    {
        //Arrange
        var result = new[] { Ibm("ID"), Ibm("STATUS"), Ibm("ID"), Ibm("NOME") };

        //Act
        var target = Resolve(ESqlDialect.Db2, IbmJoin(new SelectItem.All()), result, IbmPedido, IbmCliente);

        //Assert
        Assert.Equal([0, 0, 1, 1], target.Columns.Select(column => column.Table));
        Assert.Equal(["ID", "STATUS", "ID", "NOME"], target.Columns.Select(column => column.BaseColumn));
        Assert.Equal([[0], [2]], target.Tables.Select(table => table.Key.ToArray()));
        Assert.Equal([false, true, false, true], target.Columns.Select(column => column.Editable));
    }

    /// <summary>
    /// RN-EDIT-003: `apelido.*`, `apelido.coluna` e `tabela.coluna` (sem apelido) dizem a tabela; a coluna sem tabela é da única tabela
    /// do `FROM` que tem uma coluna com esse nome, e a que está em mais de uma não se edita.
    /// </summary>
    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK no Informix a coluna sem tabela é da única tabela que a tem, e a que está em duas não se edita")]
    public void Resolve_ShouldTakeAnUnqualifiedIbmColumnFromTheOnlyTableThatHasIt()
    {
        //Arrange
        var source = new ResultSource(null, [new FromTable(new EditTableName("loja", "pedido", "\"loja\".\"pedido\""), null), new FromTable(new EditTableName(null, "cliente", "\"cliente\""), "c")],
        [
            new SelectItem.Column(["pedido"], "id", "id"),
            new SelectItem.Column([], "status", "status"),
            new SelectItem.Column(["c"], "id", "cid"),
            new SelectItem.Column([], "nome", "nome"),
            new SelectItem.Column([], "criado", "criado")
        ]);
        var pedido = Table("table", [new("id", "INTEGER", false, true, 1, null, null), new("status", "VARCHAR(20)", true, false, 2, null, null), new("criado", "DATE", true, false, 3, null, null)]);
        var cliente = ClienteTable with { Columns = [new("id", "INTEGER", false, true, 1, null, null), new("nome", "VARCHAR(40)", true, false, 2, null, null), new("criado", "DATE", true, false, 3, null, null)] };

        //Act
        var target = Resolve(ESqlDialect.Informix, source, [Ibm("id"), Ibm("status"), Ibm("cid"), Ibm("nome"), Ibm("criado")], pedido, cliente);

        //Assert
        Assert.Equal([0, 0, 1, 1, null], target.Columns.Select(column => column.Table));
        Assert.Equal([(false, "coluna da chave numa junção"), (true, null), (false, "coluna da chave numa junção"), (true, null), (false, "a coluna sem tabela pode ser de mais de uma tabela do comando")], target.Columns.Select(column => (column.Editable, column.Reason)));
        Assert.Equal([[0], [2]], target.Tables.Select(table => table.Key.ToArray()));
    }

    /// <summary>O comando do dono (2026-10-14), no Informix: `pallets_items.*` numa junção de três; só `pallets_items` tem a chave inteira no resultado.</summary>
    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK no SELECT com junção do dono se editam as colunas de pallets_items, menos a chave")]
    public void Resolve_ShouldEditTheItemsOfTheOwnersJoin()
    {
        //Arrange
        var source = EditableSql.Read("select pallets_items.* from pallets inner join pallets_items on pallets_items.pallet_id = pallets.id inner join items on pallets_items.item_id = items.id where items.code = '66903015'", ESqlDialect.Informix);
        EditCatalogTable Catalog(string name, params string[] columns)
            => new("informix", name, "table", null, false, [.. columns.Select((column, index) => new ColumnInfo(column, "INTEGER", index > 0, index == 0, index + 1, null, null))], [new EditKey($"pk_{name}", true, ["id"])]);

        //Act
        var target = Resolve(ESqlDialect.Informix, source, [Ibm("id"), Ibm("pallet_id"), Ibm("item_id"), Ibm("quantity")], Catalog("pallets", "id", "location_id", "is_integrated"), Catalog("pallets_items", "id", "pallet_id", "item_id", "quantity"), Catalog("items", "id", "code"));

        //Assert
        Assert.Equal([(false, "a chave de pallets não está inteira no resultado: faltam id"), (true, null), (false, "a chave de items não está inteira no resultado: faltam id")], target.Tables.Select(table => (table.Editable, table.Reason)));
        Assert.Equal([1, 1, 1, 1], target.Columns.Select(column => column.Table));
        Assert.Equal([false, true, true, true], target.Columns.Select(column => column.Editable));
        Assert.Equal([0], target.Tables[1].Key);
        Assert.False(target.RowOperations);
    }

    /// <summary>RN-EDIT-003: o sinônimo (que o catálogo não acha como tabela) deixa só leitura as colunas dele; com `*` numa junção, a leitura não sabe quantas são, e o resultado inteiro fica só leitura.</summary>
    [Trait("EditTargetResolver", "Resolve")]
    [Fact(DisplayName = "OK numa junção a tabela que o catálogo não acha deixa só leitura as colunas dela, e o * sobre ela o resultado inteiro")]
    public void Resolve_ShouldKeepTheColumnsOfATableTheCatalogDoesNotFindReadOnlyInAJoin()
    {
        //Arrange
        var columns = new SelectItem[] { new SelectItem.Column(["P"], "ID", "ID"), new SelectItem.Column(["P"], "STATUS", "STATUS"), new SelectItem.Column(["C"], "NOME", "NOME") };

        //Act
        var target = Resolve(ESqlDialect.Db2, IbmJoin(columns), [Ibm("ID"), Ibm("STATUS"), Ibm("NOME")], IbmPedido, null);
        var star = EditTargetResolver.Resolve(ESqlDialect.Db2, IbmJoin(new SelectItem.All()), [Ibm("ID"), Ibm("STATUS"), Ibm("NOME")], [IbmPedido, null]);

        //Assert
        Assert.Equal([(true, null), (false, "CLIENTE não é uma tabela")], target.Tables.Select(table => (table.Editable, table.Reason)));
        Assert.Equal([(false, "coluna da chave numa junção"), (true, null), (false, "CLIENTE não é uma tabela")], target.Columns.Select(column => (column.Editable, column.Reason)));
        Assert.Equal(EditableSql.UnknownOrigin, star.Error.Reason);
    }

    private static readonly EditCatalogTable IbmPedido = new("LOJA", "PEDIDO", "table", null, false, [new("ID", "INTEGER", false, true, 1, null, null), new("STATUS", "VARCHAR(20)", true, false, 2, null, null)], [new EditKey("PK_PEDIDO", true, ["ID"])]);

    private static readonly EditCatalogTable IbmCliente = new("LOJA", "CLIENTE", "table", null, false, [new("ID", "INTEGER", false, true, 1, null, null), new("NOME", "VARCHAR(40)", true, false, 2, null, null)], [new EditKey("PK_CLIENTE", true, ["ID"])]);

    private static EditTarget Resolve(ESqlDialect dialect, ResultSource source, IReadOnlyList<QueryColumn> result, params EditCatalogTable?[] catalogs)
    {
        var resolved = EditTargetResolver.Resolve(dialect, source, result, catalogs);
        Assert.True(resolved.IsSuccess, resolved.IsFailure ? resolved.Error.Message : null);

        return resolved.Value;
    }

    private static ResultSource Source(SelectItem item)
        => Source([item]);

    private static ResultSource Source(IReadOnlyList<SelectItem> items, string? alias = null)
        => new(null, [new FromTable(Pedido, alias)], items);

    private static ResultSource Join(params SelectItem[] items)
        => new(null, [new FromTable(Pedido, "p"), new FromTable(Cliente, "c")], items);

    private static ResultSource IbmJoin(params SelectItem[] items)
        => new(null, [new FromTable(new EditTableName("LOJA", "PEDIDO", "\"LOJA\".\"PEDIDO\""), "P"), new FromTable(new EditTableName("LOJA", "CLIENTE", "\"LOJA\".\"CLIENTE\""), "C")], items);

    private static EditCatalogTable Table(string kind, IReadOnlyList<ColumnInfo>? columns = null, IReadOnlyList<EditKey>? keys = null)
        => new("loja", "pedido", kind, TableID, false, columns ?? Columns, keys ?? [new EditKey("pedido_pkey", true, ["id"])]);

    private static QueryColumn Origin(string name, int column, long table = TableID)
        => new(name, "text", "text", new ColumnOrigin(table, column));

    private static QueryColumn Ibm(string name)
        => new(name, "VARCHAR", "text");
}
