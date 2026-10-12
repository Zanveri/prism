namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-CAT-008: as tabelas do esquema (as visões não entram) e as chaves estrangeiras que saem delas, lidas por consultas de catálogo do esquema inteiro.</summary>
/// <param name="Tables">Pelo nome.</param>
/// <param name="ForeignKeys">Pelo nome, e depois pela tabela que tem a chave.</param>
public sealed record SchemaDiagramInfo(IReadOnlyList<DiagramTableInfo> Tables, IReadOnlyList<DiagramForeignKeyInfo> ForeignKeys);

/// <param name="Columns">Na ordem da tabela.</param>
public sealed record DiagramTableInfo(string Name, IReadOnlyList<DiagramColumnInfo> Columns);

public sealed record DiagramColumnInfo(string Name, string Type, bool IsNullable, bool IsPrimaryKey);

/// <summary>Uma chave estrangeira de uma tabela do esquema. O que ela referencia pode ser de outro esquema.</summary>
/// <param name="ReferencingTable">A tabela do esquema que tem a chave.</param>
public sealed record DiagramForeignKeyInfo(string Name, string ReferencingTable, IReadOnlyList<string> Columns, string ReferencedSchema, string ReferencedTable, IReadOnlyList<string> ReferencedColumns, string? OnDelete, string? OnUpdate);
