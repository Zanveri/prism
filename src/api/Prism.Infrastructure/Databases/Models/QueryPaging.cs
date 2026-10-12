namespace Prism.Infrastructure.Databases.Models;

public static class QueryPaging
{
    /// <summary>RN-SQL-004, 005 e 016: as linhas de cada página quando a busca não diz quantas.</summary>
    public const int DefaultPageSize = 200;

    /// <summary>RN-SQL-016: as linhas por busca que a API aceita, de 50 a 1000.</summary>
    public const int MinPageSize = 50;

    public const int MaxPageSize = 1000;

    /// <summary>RN-SQL-011: texto acima disto chega cortado.</summary>
    public const int MaxTextLength = 10000;

    /// <summary>RN-SQL-007: o cursor fecha depois deste tempo sem leitura.</summary>
    public static readonly TimeSpan CursorIdleTimeout = TimeSpan.FromMinutes(5);
}
