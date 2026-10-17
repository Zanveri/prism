namespace Prism.Infrastructure.Databases.Models;

/// <summary>
/// RN-EDIT-002: o que se edita num resultado, tabela por tabela e coluna por coluna, como o catálogo respondeu na primeira tentativa de
/// editar. Vale para aquele resultado (`resultID`); cada "Salvar" confere de novo, dentro da própria transação (RN-EDIT-005 e 010).
/// </summary>
/// <param name="RowOperations">"Adicionar linha", "Duplicar linha" e "Excluir linha" (RN-EDIT-002 e 016): só num resultado de uma tabela só que se edita.</param>
/// <param name="OneAtATime">RN-EDIT-012: o banco não tem log de transação (Informix sem log), e o "Salvar" grava uma alteração por vez.</param>
public sealed record EditTarget(IReadOnlyList<EditTable> Tables, IReadOnlyList<EditColumn> Columns, bool RowOperations, bool OneAtATime);

/// <summary>Uma tabela do `FROM`.</summary>
/// <param name="Key">As colunas da chave, pela posição delas no resultado; vazia quando a tabela não se edita.</param>
/// <param name="Kind">
/// RN-GRADE-020: o tipo do objeto (<see cref="EditTableKind"/>): `table`, `view`, `materializedView`, `foreign`, `other` (o que o catálogo não acha como tabela
/// nem visão, como um sinônimo) ou `elsewhere` (a tabela, escrita sem esquema, a que o nome não leva mais na sessão, RN-SQL-024).
/// </param>
/// <param name="KeyColumns">
/// RN-GRADE-020: os nomes, na tabela, das colunas de uma chave, na ordem dela: a que a edição usa (a de <paramref name="Key"/>), quando ela acha uma; senão,
/// a primeira candidata, a primária antes das outras, também a que não está inteira no resultado ou tem coluna de um tipo que a edição não converte. Vazia
/// quando a tabela não tem chave nenhuma ou não é uma tabela. É por ela, e não por <paramref name="Key"/>, que o "Gerar SQL" da tela acha a chave.
/// </param>
public sealed record EditTable(string Schema, string Name, IReadOnlyList<int> Key, bool Editable, string? Reason, string Kind, IReadOnlyList<string> KeyColumns);

/// <summary>RN-GRADE-020: o tipo de cada tabela do `FROM` no alvo da edição, como a tela o lê.</summary>
public static class EditTableKind
{
    public const string Table = "table";
    public const string View = "view";
    public const string MaterializedView = "materializedView";
    public const string Foreign = "foreign";
    public const string Other = "other";
    public const string Elsewhere = EditCatalogTable.Elsewhere;
}

/// <summary>Uma coluna do resultado.</summary>
/// <param name="Table">A tabela de onde ela vem, pela posição em <see cref="EditTarget.Tables"/>; nulo na coluna calculada.</param>
/// <param name="BaseColumn">O nome da coluna na tabela, como o catálogo o guarda.</param>
/// <param name="Generated">
/// Quem preenche o valor: o <see cref="ColumnInfo.Generated"/> do catálogo (RN-CAT-001) e, no PostgreSQL, também <see cref="ColumnGeneration.ByDefault"/>
/// na coluna cujo padrão é `nextval(...)` (o `serial`), que o "Duplicar linha" não copia (RN-EDIT-016).
/// </param>
/// <param name="Type">O tipo da coluna no catálogo, que diz como o Prism converte o texto digitado no Db2 e no Informix (RN-EDIT-006). Não vai para a tela.</param>
public sealed record EditColumn(int? Table, string? BaseColumn, bool Editable, string? Reason, bool Nullable, string? Generated, string? Type);
