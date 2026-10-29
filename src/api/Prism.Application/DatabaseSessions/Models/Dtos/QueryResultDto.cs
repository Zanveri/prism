using Prism.Infrastructure.Databases.Models;

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

    /// <summary>RN-EDIT-002: o resultado a que a página pertence (muda a cada execução da sessão); nulo nas linhas afetadas.</summary>
    public Guid? ResultID { get; init; }

    /// <summary>RN-EDIT-002: `{ known: false }` enquanto só o catálogo sabe, ou `{ known: true, reason }` quando o resultado inteiro já se sabe só leitura.</summary>
    public ResultEditability? Editable { get; init; }

    /// <summary>
    /// RN-SQL-017: as células cortadas desta página cujo valor completo a API não guardou (passou dos 256 MB da sessão), como `[linha,
    /// coluna]` dentro da página; copiar e exportar levam essas cortadas. Nulo nas linhas afetadas.
    /// </summary>
    public IReadOnlyList<int[]>? CellsWithoutFullValue { get; init; }

    /// <summary>RN-GRADE-011: como o filtro do resultado entrou no comando, `merged` (junto) ou `wrapped` (por fora, só leitura); nulo sem filtro e nas linhas afetadas.</summary>
    public string? FilterApplied { get; init; }

    /// <summary>
    /// RN-EXPORT-001 e 002 (seção 6): o comando executado, com o filtro, é uma leitura pela RN-PROT-005 e não veio pelo caminho da RN-SQL-013. É o que
    /// habilita o "Exportar…" do resultado; falso nas linhas afetadas.
    /// </summary>
    public bool Read { get; init; }

    /// <summary>RN-TX-003: o estado da transação da sessão depois do comando (no "carregar mais", depois da página).</summary>
    public TransactionDto? Transaction { get; init; }

    /// <summary>RN-TX-008, 009 e 014: a transação manual que estava aberta foi desfeita sem a pessoa pedir.</summary>
    public bool TransactionUndone { get; init; }
}
