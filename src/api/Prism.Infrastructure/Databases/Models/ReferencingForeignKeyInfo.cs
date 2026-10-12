namespace Prism.Infrastructure.Databases.Models;

/// <summary>
/// RN-CAT-004: uma chave estrangeira que aponta para a tabela pedida, vista dela. Os campos que também existem em <see cref="ForeignKeyInfo"/>
/// têm o mesmo nome e o mesmo sentido: `Columns` são as colunas da chave (na tabela de origem), e `ReferencedColumns`, as desta tabela.
/// </summary>
/// <param name="ReferencingSchema">O esquema da tabela que tem a chave (no Informix, o dono).</param>
/// <param name="ReferencingTable">A tabela que tem a chave. É a própria tabela pedida quando a chave aponta para ela mesma.</param>
public sealed record ReferencingForeignKeyInfo(string Name, string ReferencingSchema, string ReferencingTable, IReadOnlyList<string> Columns, IReadOnlyList<string> ReferencedColumns, string? OnDelete, string? OnUpdate);
