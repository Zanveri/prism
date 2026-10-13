namespace Prism.Application.Workspaces.Domain;

/// <summary>
/// RN-ABAS-006: as abas abertas de todas as janelas, que voltam na próxima entrada do usuário, na ordem em que estavam, e qual estava ativa. É o que a tela
/// manda inteiro a cada vez (fechar uma aba a tira do que volta); a forma de cada aba e o índice dentro da lista são regras do validator.
/// </summary>
internal sealed class Workspace
{
    public IReadOnlyList<WorkspaceTab> Tabs { get; }
    public int? ActiveIndex { get; }

    private Workspace(IReadOnlyList<WorkspaceTab> tabs, int? activeIndex)
    {
        Tabs = tabs;
        ActiveIndex = activeIndex;
    }

    /// <summary>Sem abas não há aba ativa.</summary>
    public static Workspace Create(IReadOnlyList<WorkspaceTab> tabs, int? activeIndex)
        => new(tabs, tabs.Count == 0 ? null : activeIndex);

    /// <summary>RN-LOG-001: as abas levam o SQL do usuário.</summary>
    public override string ToString()
        => nameof(Workspace);
}

/// <summary>
/// Uma aba da área de trabalho (RN-ABAS-006). A de consulta guarda o texto do editor como veio, a conexão (nula na aba sem conexão, RN-SCRIPT-003), o banco, o
/// script de onde veio e se tinha mudança não salva; `SqlTooLarge` diz que o texto passava de 1 MB e não foi gravado (a aba volta vazia, com o aviso). A de uma
/// tabela guarda a conexão, o banco, o esquema, a tabela e a vista. O resultado, o cursor e as alterações não salvas da grade não fazem parte de aba nenhuma.
/// </summary>
internal sealed class WorkspaceTab
{
    public const string QueryKind = "query";
    public const string TableKind = "table";

    public string Kind { get; }
    public Guid? ConnectionID { get; }
    public string? Database { get; }
    public string? Sql { get; }
    public Guid? ScriptID { get; }
    public bool Dirty { get; }
    public bool SqlTooLarge { get; }
    public string? Schema { get; }
    public string? Table { get; }
    public string? View { get; }

    private WorkspaceTab(string kind, Guid? connectionID, string? database, string? sql, Guid? scriptID, bool dirty, bool sqlTooLarge, string? schema, string? table, string? view)
    {
        Kind = kind;
        ConnectionID = connectionID;
        Database = database;
        Sql = sql;
        ScriptID = scriptID;
        Dirty = dirty;
        SqlTooLarge = sqlTooLarge;
        Schema = schema;
        Table = table;
        View = view;
    }

    /// <summary>
    /// O texto fica como veio, com os espaços e as quebras de linha. Como no script (RN-SCRIPT-003), o banco só existe com a conexão e o vazio é o da própria
    /// conexão; e só a aba de um script tem mudança não salva (RN-SCRIPT-001).
    /// </summary>
    public static WorkspaceTab CreateQuery(Guid? connectionID, string? database, string sql, Guid? scriptID, bool dirty, bool sqlTooLarge)
        => new(QueryKind, connectionID, connectionID is null ? null : DatabaseOf(database), sql, scriptID, scriptID is not null && dirty, sqlTooLarge, null, null, null);

    /// <summary>A aba de uma tabela sempre tem a conexão dela (RN-TABELA-001); a vista é a dos Registros, da Estrutura ou do Diagrama.</summary>
    public static WorkspaceTab CreateTable(Guid connectionID, string? database, string schema, string table, string view)
        => new(TableKind, connectionID, DatabaseOf(database), null, null, false, false, schema, table, view);

    /// <summary>RN-LOG-001: a aba leva o SQL do usuário e os nomes do banco.</summary>
    public override string ToString()
        => nameof(WorkspaceTab);

    private static string? DatabaseOf(string? database)
        => string.IsNullOrEmpty(database) ? null : database;
}
