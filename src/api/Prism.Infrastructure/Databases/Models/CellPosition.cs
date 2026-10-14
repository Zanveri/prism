namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-SQL-017: uma célula de um resultado, pela linha no resultado inteiro (contando o "carregar mais") e pela coluna, contando de zero.</summary>
public readonly record struct CellPosition(int Row, int Column);
