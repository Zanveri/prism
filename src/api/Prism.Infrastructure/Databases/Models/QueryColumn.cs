namespace Prism.Infrastructure.Databases.Models;

/// <param name="Type">O nome do tipo no banco, como o driver o informa.</param>
/// <param name="Kind">`text`, `number`, `datetime`, `boolean` ou `binary`: serve para a tela alinhar a coluna.</param>
/// <param name="Origin">RN-EDIT-003: de que tabela e coluna ela vem, quando o banco diz isso na resposta (PostgreSQL); nulo nos outros. Não vai para a tela.</param>
public sealed record QueryColumn(string Name, string Type, string Kind, ColumnOrigin? Origin = null);
