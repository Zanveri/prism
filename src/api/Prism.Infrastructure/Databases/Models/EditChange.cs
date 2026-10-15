namespace Prism.Infrastructure.Databases.Models;

public enum EEditKind
{
    Update,
    Delete,
    Insert
}

/// <summary>
/// RN-EDIT-004: uma alteração pendente da grade. `Table` é a posição em <see cref="EditTarget.Tables"/>; `Key`, os textos que a grade
/// leu nas colunas da chave, na ordem dela; `Values`, as colunas alteradas (`update`) ou preenchidas (`insert`), pela posição no
/// resultado. A exclusão não tem valores, e a linha nova não tem chave.
/// </summary>
public sealed record EditChange(EEditKind Kind, int Table, IReadOnlyList<string?> Key, IReadOnlyList<EditValue> Values);

/// <summary>O texto de uma célula, ou nulo para gravar NULL (RN-EDIT-006: a célula viaja como texto).</summary>
public sealed record EditValue(int Column, string? Value);
