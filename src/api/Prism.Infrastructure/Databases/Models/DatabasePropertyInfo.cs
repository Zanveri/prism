namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-CAT-010: uma propriedade do banco conectado.</summary>
/// <param name="Name">Um identificador estável em inglês (`encoding`, `loggingMode`, `codePage`): quem escreve o rótulo é a tela.</param>
/// <param name="Value">O valor como o servidor o informa, em texto.</param>
public sealed record DatabasePropertyInfo(string Name, string Value);
