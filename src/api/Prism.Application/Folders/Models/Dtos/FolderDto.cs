namespace Prism.Application.Folders.Models.Dtos;

public sealed record FolderDto
{
    public Guid ID { get; init; }

    /// <summary>`null` é a raiz.</summary>
    public Guid? ParentID { get; init; }
    public string Name { get; init; } = string.Empty;

    /// <summary>RN-PASTA-005: o ambiente da pasta, que as conexões dela sem ambiente próprio herdam. Os dois são nulos na pasta sem ambiente.</summary>
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }

    /// <summary>RN-PASTA-007: a cor do ícone da pasta na árvore, independente do ambiente; nula na pasta sem cor.</summary>
    public string? Color { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}
