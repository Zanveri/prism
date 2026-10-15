namespace Prism.Infrastructure.Databases.Models;

/// <summary>
/// RN-EDIT-002: o que se edita num resultado, tabela por tabela e coluna por coluna, como o catálogo respondeu na primeira tentativa de
/// editar. Vale para aquele resultado (`resultID`); cada "Salvar" confere de novo, dentro da própria transação (RN-EDIT-005 e 010).
/// </summary>
/// <param name="RowOperations">"Linha nova" e "Excluir linha": só num resultado de uma tabela só que se edita.</param>
/// <param name="OneAtATime">RN-EDIT-012: o banco não tem log de transação (Informix sem log), e o "Salvar" grava uma alteração por vez.</param>
public sealed record EditTarget(IReadOnlyList<EditTable> Tables, IReadOnlyList<EditColumn> Columns, bool RowOperations, bool OneAtATime);

/// <summary>Uma tabela do `FROM`.</summary>
/// <param name="Key">As colunas da chave, pela posição delas no resultado; vazia quando a tabela não se edita.</param>
public sealed record EditTable(string Schema, string Name, IReadOnlyList<int> Key, bool Editable, string? Reason);

/// <summary>Uma coluna do resultado.</summary>
/// <param name="Table">A tabela de onde ela vem, pela posição em <see cref="EditTarget.Tables"/>; nulo na coluna calculada.</param>
/// <param name="BaseColumn">O nome da coluna na tabela, como o catálogo o guarda.</param>
/// <param name="Type">O tipo da coluna no catálogo, que diz como o Prism converte o texto digitado no Db2 e no Informix (RN-EDIT-006). Não vai para a tela.</param>
public sealed record EditColumn(int? Table, string? BaseColumn, bool Editable, string? Reason, bool Nullable, string? Generated, string? Type);
