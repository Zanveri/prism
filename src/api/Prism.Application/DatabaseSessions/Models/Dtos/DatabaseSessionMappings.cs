using Prism.Core.Mappers;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.DatabaseSessions.Models.Dtos;

internal static class DatabaseSessionMappings
{
    public static DatabaseSessionDto ToDto(this DatabaseSessionInfo source)
        => DomainDto.ToDto<DatabaseSessionInfo, DatabaseSessionDto>(source);

    /// <summary>Um comando que devolve linhas traz a página; o que não devolve, as linhas afetadas. O tempo é o do comando.</summary>
    public static QueryResultDto ToDto(this QueryOutcome source)
        => source.Page is { } page ? page.ToDto() with { ElapsedMs = source.ElapsedMs } : new QueryResultDto { RowsAffected = source.RowsAffected, ElapsedMs = source.ElapsedMs };

    public static QueryResultDto ToDto(this QueryPage source)
        => new() { Columns = [.. source.Columns.Select(column => new QueryColumnDto(column.Name, column.Type, column.Kind))], Rows = source.Rows, HasMore = source.HasMore, ElapsedMs = source.ElapsedMs, TruncatedCells = source.TruncatedCells, TotalRows = source.TotalRows };
}
