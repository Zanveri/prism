using Prism.Application.Common.Protections;

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

    /// <summary>RN-PROT-001: a confirmação própria da pasta, `irreversible` ou `all`; nula é "Não".</summary>
    public string? ConfirmCommands { get; init; }

    /// <summary>RN-PROT-002: o somente leitura próprio da pasta. O que vale, com o das pastas acima, está em `Protections`.</summary>
    public bool ReadOnly { get; init; }

    /// <summary>RN-PROT-004: as proteções que valem para a pasta (a própria e as das pastas acima) e de onde cada uma vem.</summary>
    public ProtectionsDto Protections { get; init; } = new();
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}
