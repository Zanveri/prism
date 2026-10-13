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
        => new() { Columns = [.. source.Columns.Select(column => new QueryColumnDto(column.Name, column.Type, column.Kind))], Rows = source.Rows, HasMore = source.HasMore, ElapsedMs = source.ElapsedMs, TruncatedCells = source.TruncatedCells, TotalRows = source.TotalRows, ResultID = source.ResultID, Editable = source.Editable };

    /// <summary>RN-EDIT-002: o tipo de catálogo de cada coluna fica na API, que é quem converte o texto (RN-EDIT-006).</summary>
    public static EditTargetDto ToDto(this EditTarget source)
        => new([.. source.Tables.Select(table => new EditTableDto(table.Schema, table.Name, table.Key, table.Editable, table.Reason))], [.. source.Columns.Select(column => new EditColumnDto(column.Table, column.BaseColumn, column.Editable, column.Reason, column.Nullable, column.Generated))], source.RowOperations, source.OneAtATime);

    /// <summary>O validator já recusou o pedido sem alterações e o tipo que não existe: aqui cada uma vira a do registro de sessões, com o `set` da alteração ou os `values` da linha nova.</summary>
    public static IReadOnlyList<EditChange> ToChanges(this IReadOnlyList<EditChangeDto>? source)
        => [.. (source ?? []).Select(change => change.Kind switch
        {
            "update" => new EditChange(EEditKind.Update, change.Table, change.Key ?? [], ToValues(change.Set)),
            "delete" => new EditChange(EEditKind.Delete, change.Table, change.Key ?? [], []),
            _ => new EditChange(EEditKind.Insert, change.Table, [], ToValues(change.Values))
        })];

    private static IReadOnlyList<EditValue> ToValues(IReadOnlyList<EditValueDto>? values)
        => [.. (values ?? []).Select(value => new EditValue(value.Column, value.Value))];
}
