using Prism.Application.Common.Protections;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.Connections.Models.Dtos;

/// <summary>RN-CONN-001: não existe propriedade de senha aqui. A listagem e o detalhe dizem só se há uma, em `HasPassword`.</summary>
public sealed record ConnectionDto
{
    public Guid ID { get; init; }

    /// <summary>`null` é a raiz.</summary>
    public Guid? FolderID { get; init; }
    public string Name { get; init; } = string.Empty;
    public EDatabaseEngine Engine { get; init; }
    public string Host { get; init; } = string.Empty;
    public int Port { get; init; }
    public string Database { get; init; } = string.Empty;
    public string UserName { get; init; } = string.Empty;
    public bool HasPassword { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }

    /// <summary>RN-PROT-001: a confirmação própria da conexão, `irreversible` ou `all`; nula é "Não".</summary>
    public string? ConfirmCommands { get; init; }

    /// <summary>RN-PROT-002: o somente leitura próprio da conexão. O que vale, com o das pastas acima, está em `Protections`.</summary>
    public bool ReadOnly { get; init; }

    /// <summary>RN-VERIF-001: a verificação periódica, ligada por padrão, a cada `VerificationInterval` segundos (30 por padrão).</summary>
    public bool VerificationEnabled { get; init; }
    public int VerificationInterval { get; init; }

    /// <summary>RN-VERIF-001: a consulta de verificação própria; nula é a do banco (RN-CONN-013).</summary>
    public string? VerificationQuery { get; init; }

    public bool? UseInternalDescriptions { get; init; }

    /// <summary>RN-PROT-004: as proteções que valem, a própria e as das pastas acima, e de onde cada uma vem.</summary>
    public ProtectionsDto Protections { get; init; } = new();
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}
