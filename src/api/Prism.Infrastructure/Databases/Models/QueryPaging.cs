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

    /// <summary>RN-SQL-017: o que a API guarda, por sessão, do valor completo das células que cortou: 256 MB (ver `FullCellValue.Bytes`).</summary>
    public const long MaxFullValueBytes = 256L * 1024 * 1024;

    /// <summary>RN-SQL-017: as células que um pedido de valores completos leva, no máximo.</summary>
    public const int MaxCellsPerRequest = 10000;

    /// <summary>RN-SQL-007: o cursor fecha depois deste tempo sem leitura.</summary>
    public static readonly TimeSpan CursorIdleTimeout = TimeSpan.FromMinutes(5);
}
