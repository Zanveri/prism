using Prism.Application.Workspaces.Domain;

namespace Prism.UnitTesting.Workspaces;

/// <summary>
/// O domínio da área de trabalho gravada (RN-ABAS-006): a aba de consulta guarda o texto como veio, a conexão, o banco (só com a conexão, e o vazio é o da
/// própria conexão), o script de onde veio e a marca de mudança não salva (só de um script); a de uma tabela guarda a conexão, o banco, o esquema, a tabela e
/// a vista. Sem abas não há aba ativa.
/// </summary>
public sealed class WorkspaceTests
{
    [Trait("WorkspaceTab", "CreateQuery")]
    [Fact(DisplayName = "OK a aba de consulta guarda o texto como veio, a conexão, o banco, o script e a marca")]
    public void Query_ShouldBeOK()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        var scriptID = Guid.CreateVersion7();
        const string sql = "  SELECT 1\n\tFROM dual  ";

        //Act
        var tab = WorkspaceTab.CreateQuery(connectionID, "vendas", sql, scriptID, dirty: true, sqlTooLarge: false);

        //Assert
        Assert.Equal(WorkspaceTab.QueryKind, tab.Kind);
        Assert.Equal((connectionID, "vendas", sql, scriptID, true, false), (tab.ConnectionID, tab.Database, tab.Sql, tab.ScriptID, tab.Dirty, tab.SqlTooLarge));
        Assert.Equal((null, null, null), (tab.Schema, tab.Table, tab.View));
    }

    [Trait("WorkspaceTab", "CreateQuery")]
    [Fact(DisplayName = "OK sem conexão, ou com o banco vazio, o banco fica nulo; sem script, não há mudança não salva")]
    public void Query_WithoutConnectionOrScript_DropsWhatOnlyExistsWithThem()
    {
        //Act
        var withoutConnection = WorkspaceTab.CreateQuery(null, "vendas", "SELECT 1", null, dirty: true, sqlTooLarge: false);
        var emptyDatabase = WorkspaceTab.CreateQuery(Guid.CreateVersion7(), "", "SELECT 1", Guid.CreateVersion7(), dirty: false, sqlTooLarge: false);

        //Assert
        Assert.Null(withoutConnection.Database);
        Assert.False(withoutConnection.Dirty);
        Assert.Null(emptyDatabase.Database);
    }

    [Trait("WorkspaceTab", "CreateTable")]
    [Fact(DisplayName = "OK a aba de uma tabela guarda a conexão, o banco, o esquema, a tabela e a vista, e nada de texto")]
    public void Table_ShouldBeOK()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();

        //Act
        var tab = WorkspaceTab.CreateTable(connectionID, "", "loja", "clientes", "structure");

        //Assert
        Assert.Equal(WorkspaceTab.TableKind, tab.Kind);
        Assert.Equal((connectionID, null, "loja", "clientes", "structure"), (tab.ConnectionID, tab.Database, tab.Schema, tab.Table, tab.View));
        Assert.Equal((null, null, false, false), (tab.Sql, tab.ScriptID, tab.Dirty, tab.SqlTooLarge));
    }

    [Trait("Workspace", "Create")]
    [Fact(DisplayName = "OK as abas ficam na ordem, e sem abas não há aba ativa")]
    public void Create_KeepsTheOrder_AndWithoutTabsHasNoActiveTab()
    {
        //Arrange
        var first = WorkspaceTab.CreateQuery(null, null, "SELECT 1", null, dirty: false, sqlTooLarge: false);
        var second = WorkspaceTab.CreateTable(Guid.CreateVersion7(), null, "loja", "pedidos", "data");

        //Act
        var workspace = Workspace.Create([first, second], 1);
        var empty = Workspace.Create([], 0);

        //Assert
        Assert.Equal([first, second], workspace.Tabs);
        Assert.Equal(1, workspace.ActiveIndex);
        Assert.Empty(empty.Tabs);
        Assert.Null(empty.ActiveIndex);
    }

    /// <summary>RN-LOG-001: a aba leva o texto do SQL do usuário, e nada do que ela imprime pode levá-lo.</summary>
    [Trait("WorkspaceTab", "ToString")]
    [Fact(DisplayName = "OK o texto da aba e os nomes não aparecem no ToString")]
    public void ToString_DoesNotPrintTheSqlNorTheNames()
    {
        //Arrange
        var query = WorkspaceTab.CreateQuery(null, null, "SELECT 'segredo'", null, dirty: false, sqlTooLarge: false);
        var table = WorkspaceTab.CreateTable(Guid.CreateVersion7(), "banco_secreto", "esquema_secreto", "tabela_secreta", "data");

        //Act
        var printed = $"{query} {table} {Workspace.Create([query, table], 0)}";

        //Assert
        Assert.DoesNotContain("segredo", printed, StringComparison.Ordinal);
        Assert.DoesNotContain("secret", printed, StringComparison.Ordinal);
    }
}
