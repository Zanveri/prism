namespace Prism.Application.DatabaseSessions.Models.Dtos;

/// <param name="Kind">`text`, `number`, `datetime`, `boolean` ou `binary`: serve para a tela alinhar a coluna.</param>
public sealed record QueryColumnDto(string Name, string Type, string Kind);
