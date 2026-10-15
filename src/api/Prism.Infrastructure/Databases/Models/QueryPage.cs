namespace Prism.Infrastructure.Databases.Models;

/// <summary>Uma página de resultado (RN-SQL-004). Cada célula é texto ou nulo (RN-SQL-011).</summary>
/// <param name="HasMore">Há pelo menos mais uma linha no cursor, que continua aberto; `false` é o fim, e o cursor já fechou.</param>
/// <param name="TruncatedCells">As células que chegaram cortadas, como `[linha, coluna]` dentro desta página, contando de zero.</param>
/// <param name="TotalRows">
/// RN-SQL-013: só vem num comando que grava e devolve linhas. Ele foi executado até o fim, a página traz as primeiras linhas e este é o
/// total que o comando devolveu; não há cursor nem "carregar mais". Nas leituras paginadas é nulo: o total nunca é contado sem pedido.
/// </param>
/// <param name="ResultID">RN-EDIT-002: o resultado a que a página pertence; muda a cada execução da sessão. Quem o põe é o registro de sessões.</param>
/// <param name="Editable">RN-EDIT-002: o que se sabe da edição dele sem consultar o banco. Quem o põe é o registro de sessões.</param>
/// <param name="FullValues">
/// RN-SQL-017: o valor completo de cada célula de `TruncatedCells`, na mesma ordem. Quem lê o banco o põe; o registro de sessões o guarda
/// e o tira da página, que nunca o leva para a tela.
/// </param>
/// <param name="CellsWithoutFullValue">
/// RN-SQL-017: as células de `TruncatedCells` cujo valor completo a API não guardou (passou do teto da sessão), como `[linha, coluna]`
/// dentro desta página. Quem o põe é o registro de sessões.
/// </param>
/// <param name="FilterApplied">RN-GRADE-011: como o filtro do resultado entrou no comando; nulo sem filtro. Quem o põe é o registro de sessões.</param>
public sealed record QueryPage(IReadOnlyList<QueryColumn> Columns, IReadOnlyList<string?[]> Rows, bool HasMore, long ElapsedMs, IReadOnlyList<int[]> TruncatedCells, long? TotalRows = null, Guid? ResultID = null, ResultEditability? Editable = null, IReadOnlyList<FullCellValue>? FullValues = null, IReadOnlyList<int[]>? CellsWithoutFullValue = null, EFilterApplied? FilterApplied = null);
