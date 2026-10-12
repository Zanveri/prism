namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-CAT-006: o texto que o banco guarda para a visão, inteiro; nulo quando ele não devolve nada (a visão não existe ou a conta não pode lê-la).</summary>
public sealed record ViewDefinitionInfo(string? Definition);
