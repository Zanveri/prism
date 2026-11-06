namespace Prism.Infrastructure.Journal.Models;

/// <summary>RN-AUDIT-001: retrato imutável da conexão, da pasta e do ambiente no momento em que o registro foi gravado.</summary>
public sealed record JournalConnectionSnapshot(Guid? ConnectionId, string? Name, string? Engine, string? FolderPath, string? EnvironmentName, string? EnvironmentColor, string? Database)
{
    public static readonly JournalConnectionSnapshot None = new(null, null, null, null, null, null, null);

    /// <summary>RN-DIARIO-009 e RN-LOG-001: nomes de conexão, pastas e bancos nunca aparecem em logs.</summary>
    public override string ToString() => nameof(JournalConnectionSnapshot);
}
