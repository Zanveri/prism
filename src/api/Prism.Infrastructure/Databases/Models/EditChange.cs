namespace Prism.Infrastructure.Databases.Models;

public enum EEditKind
{
    Update,
    Delete,
    Insert,

    /// <summary>RN-EDIT-018 e 023: a coluna inteira, em todas as linhas que o comando do resultado devolve no momento do "Salvar".</summary>
    UpdateAll
}

/// <summary>
/// RN-EDIT-004: uma alteração pendente da grade. `Table` é a posição em <see cref="EditTarget.Tables"/>; `Key`, os textos que a grade
/// leu nas colunas da chave, na ordem dela; `Values`, as colunas alteradas (`update`) ou preenchidas (`insert`), pela posição no
/// resultado. A exclusão não tem valores, e a linha nova não tem chave.
///
/// RN-EDIT-023: a coluna inteira (`updateAll`) não tem chave; `Values` são as colunas do `set`, e `Rows` é o número de linhas que a
/// pessoa confirmou (nulo quando o pedido não o trouxe, -1 quando ele não é um inteiro): só o "Salvar" o confere.
/// </summary>
public sealed record EditChange(EEditKind Kind, int Table, IReadOnlyList<string?> Key, IReadOnlyList<EditValue> Values, long? Rows = null);

/// <summary>O texto de uma célula, ou nulo para gravar NULL (RN-EDIT-006: a célula viaja como texto).</summary>
public sealed record EditValue(int Column, string? Value);
