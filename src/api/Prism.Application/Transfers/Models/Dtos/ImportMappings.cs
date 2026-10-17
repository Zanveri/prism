using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Services;
using System.Text.Json;

namespace Prism.Application.Transfers.Models.Dtos;

/// <summary>Onde as prévias da importação viram as respostas das rotas: a Infrastructure fala em enums, e a rota em texto (camelCase).</summary>
internal static class ImportMappings
{
    public static ImportReadDto ToDto(this ImportFilePreview source)
        => new(
            source.Info.Encoding is { } encoding ? new ImportEncodingDto(encoding.Name, encoding.Bom) : null,
            source.Info.Delimiter,
            source.Info.ListKey,
            source.Info.Sheets?.Select(sheet => new ImportSheetDto(sheet.Name, sheet.Hidden)).ToList(),
            source.Info.Sheet,
            source.Info.Columns,
            source.ShownColumns,
            [.. source.Rows.Select(row => new ImportReadRowDto(row.Line, row.Values, row.Short))]);

    public static ImportPreviewDto ToDto(this ImportConvertedPreview source)
        => new(
            ToDto(source.Table),
            source.Columns,
            [.. source.Mapping.Select(ToDto)],
            source.ShownColumns,
            [.. source.Rows.Select(row => new ImportPreviewRowDto(row.Line, row.Problem, row.Short, [.. row.Cells.Select(cell => new ImportPreviewCellDto(cell.Value, cell.Problem))]))]);

    public static CopyPreviewDto ToDto(this CopyPreview source)
        => new(ToDto(source.Table), [.. source.Mapping.Select(ToDto)]);

    private static ImportTableDto ToDto(ImportTargetTable table)
        => new(table.Schema, table.Name, table.OneAtATime, [.. table.Columns.Select(ToDto)], [.. table.ReferencedBy.Select(reference => new ImportReferenceDto(reference.Schema, reference.Table, reference.OnDelete))]);

    private static ImportMappingDto ToDto(ImportMappingEntry entry)
        => new() { Source = entry.Source, Target = entry.Target };

    /// <summary>RN-IMPORT-010: a classe em camelCase (`dateTime`), como a resposta a escreve.</summary>
    public static string ClassText(EImportClass importClass)
        => JsonNamingPolicy.CamelCase.ConvertName(importClass.ToString());

    private static ImportTableColumnDto ToDto(ImportTargetColumn column)
        => new(column.Name, column.Type, column.Nullable, column.DefaultValue, column.Generated, ClassText(column.Class), column.Importable, column.Reason);
}
