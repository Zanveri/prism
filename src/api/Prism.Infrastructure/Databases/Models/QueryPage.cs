namespace Prism.Infrastructure.Databases.Models;

/// <summary>Uma página de resultado (RN-SQL-004). Cada célula é texto ou nulo (RN-SQL-011).</summary>
/// <param name="HasMore">Há pelo menos mais uma linha no cursor, que continua aberto; `false` é o fim, e o cursor já fechou.</param>
/// <param name="TruncatedCells">As células que chegaram cortadas, como `[linha, coluna]` dentro desta página, contando de zero.</param>
/// <param name="TotalRows">
/// RN-SQL-013: só vem num comando que grava e devolve linhas. Ele foi executado até o fim, a página traz as primeiras linhas e este é o
/// total que o comando devolveu; não há cursor nem "carregar mais". Nas leituras paginadas é nulo: o total nunca é contado sem pedido.
/// </param>
public sealed record QueryPage(IReadOnlyList<QueryColumn> Columns, IReadOnlyList<string?[]> Rows, bool HasMore, long ElapsedMs, IReadOnlyList<int[]> TruncatedCells, long? TotalRows = null);
