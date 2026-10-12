namespace Prism.Infrastructure.Databases.Models;

/// <param name="Type">O nome do tipo no banco, como o driver o informa.</param>
/// <param name="Kind">`text`, `number`, `datetime`, `boolean` ou `binary`: serve para a tela alinhar a coluna.</param>
public sealed record QueryColumn(string Name, string Type, string Kind);
