namespace Prism.Application.DatabaseSessions.Models.Dtos;

/// <summary>
/// A resposta de `queries` e de `queries/next`: a mesma forma nos dois casos, com nulo no que não se aplica (`query.schema.ts` da tela
/// decide pela presença de `Columns`). Comando que devolve linhas traz as colunas e a página (RN-SQL-004); o que não devolve traz
/// só `RowsAffected` e o tempo (RN-SQL-008). Cada célula é texto ou nulo (RN-SQL-011).
/// </summary>
/// <param name="TruncatedCells">As células cortadas, como `[linha, coluna]` dentro desta página, contando de zero.</param>
/// <param name="TotalRows">RN-SQL-013: só vem num comando que grava e devolve linhas; nas leituras paginadas é nulo, porque o total nunca é contado sem pedido.</param>
public sealed record QueryResultDto
{
    public IReadOnlyList<QueryColumnDto>? Columns { get; init; }
    public IReadOnlyList<string?[]>? Rows { get; init; }
    public bool HasMore { get; init; }
    public long ElapsedMs { get; init; }
    public IReadOnlyList<int[]>? TruncatedCells { get; init; }
    public long? RowsAffected { get; init; }
    public long? TotalRows { get; init; }
}
