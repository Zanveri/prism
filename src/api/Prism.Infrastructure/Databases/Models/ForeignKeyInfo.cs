namespace Prism.Infrastructure.Databases.Models;

/// <param name="OnDelete">RN-CAT-002: a regra ao excluir, como em <see cref="ForeignKeyRule"/>, ou nulo quando o banco não informa.</param>
/// <param name="OnUpdate">RN-CAT-002: a regra ao atualizar, como em <see cref="ForeignKeyRule"/>, ou nulo quando o banco não informa.</param>
public sealed record ForeignKeyInfo(string Name, IReadOnlyList<string> Columns, string ReferencedSchema, string ReferencedTable, IReadOnlyList<string> ReferencedColumns, string? OnDelete, string? OnUpdate);
