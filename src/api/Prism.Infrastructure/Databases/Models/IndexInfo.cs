namespace Prism.Infrastructure.Databases.Models;

/// <param name="Method">RN-CAT-003: o método de acesso ou o tipo do índice, na palavra que o banco usa (`btree`, `gin`, `regular`), ou nulo quando ele não informa.</param>
public sealed record IndexInfo(string Name, IReadOnlyList<string> Columns, bool IsUnique, string? Method);
