using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.DatabaseSessions.Models.Dtos;

/// <summary>A sessão aberta (RN-SESSAO-001). O `Engine` vai como número (1, 2 ou 3), que é o que a tela valida.</summary>
public sealed record DatabaseSessionDto
{
    public Guid ID { get; init; }
    public Guid ConnectionID { get; init; }
    public EDatabaseEngine Engine { get; init; }
    public string Database { get; init; } = string.Empty;
    public string ServerVersion { get; init; } = string.Empty;
}
