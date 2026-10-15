namespace Prism.Infrastructure.Databases.Models;

/// <summary>
/// RN-EDIT-003: de que tabela e de que coluna dela vem uma coluna do resultado, quando o próprio banco diz isso na resposta do comando
/// (no PostgreSQL, o identificador da tabela e o número da coluna dela). `Table` zero é coluna calculada no comando.
/// </summary>
public sealed record ColumnOrigin(long Table, int Column);
