namespace Prism.Infrastructure.Databases.Models;

/// <param name="DefaultValue">
/// RN-CAT-001: a expressão padrão como o banco a descreve, em texto (`'abc'`, `42`, `CURRENT TIMESTAMP`), ou nulo. Na coluna calculada,
/// a expressão que o banco calcula, quando ele a guarda.
/// </param>
/// <param name="Generated">RN-CAT-001: <see cref="ColumnGeneration.Always"/>, <see cref="ColumnGeneration.ByDefault"/> ou nulo.</param>
public sealed record ColumnInfo(string Name, string Type, bool IsNullable, bool IsPrimaryKey, int Position, string? DefaultValue, string? Generated);
