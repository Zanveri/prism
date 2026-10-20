namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// As abas abertas de todas as janelas como ficam gravadas dentro do cofre (RN-ABAS-006), cifradas como os scripts (RN-SCRIPT-002): a lista na ordem em que
/// estavam e o índice da que estava ativa (nulo sem abas). É gravada inteira a cada vez: fechar uma aba a tira do que volta. Entrou no formato 3: um cofre de
/// formato anterior não a tem, e ganha a vazia ao ser migrado (RN-VERSAO-005, `VaultMigration`).
/// </summary>
public sealed record VaultWorkspaceRecord(IReadOnlyList<VaultWorkspaceTabRecord> Tabs, int? ActiveIndex)
{
    /// <summary>Nada gravado: a lista vazia e nenhuma aba ativa.</summary>
    public static VaultWorkspaceRecord Empty { get; } = new([], null);

    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria as abas, com o texto do SQL.</summary>
    public override string ToString()
        => nameof(VaultWorkspaceRecord);
}

/// <summary>
/// Uma aba gravada (RN-ABAS-006). `Kind` diz qual: `query`, a aba de consulta, com o texto do editor, a conexão (nula na aba sem conexão, RN-SCRIPT-003), o
/// banco, o script de onde veio e se tinha mudança não salva, e `SqlTooLarge` quando o texto passava de 1 MB e não foi gravado (a aba volta vazia, com o aviso);
/// ou `table`, a aba de uma tabela, com a conexão, o banco, o esquema, a tabela e a vista (`data`, `structure`, `diagram`). Os campos do outro tipo ficam nulos.
/// `Database` nulo é o banco da própria conexão. O resultado, o cursor e as alterações não salvas da grade não são gravados.
///
/// `ResultPlace` (RN-ABAS-016: `panel`, `tab` ou `window`, só na aba de consulta) entrou na 0.5.0 sem subir o formato, no FIM do registro e com padrão nulo,
/// como o ambiente da pasta: o cofre gravado antes não o tem, a leitura entrega nulo e a aba volta no painel; e a 0.4.0, que lê o documento com as opções
/// padrão do `JsonSerializer` (o membro que ela não conhece é ignorado), abre o cofre gravado por esta versão e só não vê o campo.
/// </summary>
public sealed record VaultWorkspaceTabRecord(string Kind, Guid? ConnectionID, string? Database, string? Sql, Guid? ScriptID, bool Dirty, bool SqlTooLarge, string? Schema, string? Table, string? View, string? ResultPlace = null)
{
    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria o texto do SQL e os nomes onde quer que o record fosse parar.</summary>
    public override string ToString()
        => nameof(VaultWorkspaceTabRecord);
}
