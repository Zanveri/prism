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
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}
