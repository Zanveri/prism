using System.Data;

namespace Prism.Infrastructure.Databases.Models;

/// <summary>Um comando do "Salvar" (RN-EDIT-005), pronto para ir ao banco, com os valores como parâmetros, nunca dentro do texto.</summary>
/// <param name="Change">A posição da alteração no pedido, para a recusa apontar qual falhou.</param>
public sealed record EditCommand(int Change, string Sql, IReadOnlyList<EditParameter> Parameters);

/// <param name="Value">O valor já convertido (Db2 e Informix) ou o texto (PostgreSQL, em que quem converte é o banco); nulo é NULL.</param>
/// <param name="Type">O tipo do parâmetro, quando o valor sozinho não o diz (a data, que no C# é uma data e hora).</param>
public sealed record EditParameter(object? Value, DbType? Type = null);
