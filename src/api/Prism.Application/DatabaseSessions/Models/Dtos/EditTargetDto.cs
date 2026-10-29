namespace Prism.Application.DatabaseSessions.Models.Dtos;

/// <summary>A resposta do `edit-target` (seção 22): o que se edita no resultado, sem o tipo de catálogo de cada coluna, que só a API usa.</summary>
public sealed record EditTargetDto(IReadOnlyList<EditTableDto> Tables, IReadOnlyList<EditColumnDto> Columns, bool RowOperations, bool OneAtATime);

/// <param name="Key">As colunas da chave, pela posição no resultado.</param>
/// <param name="Kind">RN-GRADE-020: `table`, `view`, `materializedView`, `foreign`, `other` ou `elsewhere`.</param>
/// <param name="KeyColumns">RN-GRADE-020: os nomes, na tabela, das colunas da chave da edição, ou da primeira candidata; vazia sem chave ou fora de uma tabela.</param>
public sealed record EditTableDto(string Schema, string Name, IReadOnlyList<int> Key, bool Editable, string? Reason, string Kind, IReadOnlyList<string> KeyColumns);

/// <param name="Table">A posição da tabela em `tables`; nulo na coluna calculada.</param>
public sealed record EditColumnDto(int? Table, string? BaseColumn, bool Editable, string? Reason, bool Nullable, string? Generated);

/// <summary>A resposta do "Salvar": quantas alterações foram gravadas, e a transação da sessão depois dele (no Commit manual, ficaram pendentes nela).</summary>
public sealed record EditsAppliedDto(int Applied, TransactionDto? Transaction = null);

/// <summary>RN-EDIT-019 e 023: quantas linhas o comando do resultado devolve agora, que a pergunta da coluna inteira mostra e o "Salvar" leva em `rows`.</summary>
public sealed record WholeColumnCountDto(long Rows, TransactionDto? Transaction = null);
