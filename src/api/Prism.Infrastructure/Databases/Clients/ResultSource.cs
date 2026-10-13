using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// RN-EDIT-002 e 003: o que o texto do comando diz sobre a edição do resultado, sem consultar o banco. Ou o resultado inteiro é só
/// leitura (`Reason`), ou ele lê uma tabela só (`Table`, com o apelido do `FROM`), e cada item da lista do `SELECT` diz de onde vem.
/// </summary>
internal sealed record ResultSource(string? Reason, EditTableName? Table, string? Alias, IReadOnlyList<SelectItem> Items)
{
    public static ResultSource ReadOnly(string reason)
        => new(reason, null, null, []);
}

/// <summary>Um item da lista do `SELECT`, com os nomes como o banco os guarda.</summary>
internal abstract record SelectItem
{
    /// <summary>`*`: as colunas da tabela, na ordem do catálogo.</summary>
    public sealed record All : SelectItem;

    /// <summary>`tabela.*` ou `apelido.*`.</summary>
    public sealed record AllOf(IReadOnlyList<string> Qualifier) : SelectItem;

    /// <summary>`[tabela.]coluna [[AS] nome]`: `OutputName` é o nome com que o banco devolve a coluna.</summary>
    public sealed record Column(IReadOnlyList<string> Qualifier, string Name, string OutputName) : SelectItem;

    /// <summary>Qualquer outra coisa: expressão, função, constante.</summary>
    public sealed record Computed : SelectItem;
}
