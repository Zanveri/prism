namespace Prism.Infrastructure.Journal.Models;

/// <summary>RN-HIST-002 a 006 e RN-AUDIT-011 a 012: filtros e paginação para consultar o diário.</summary>
public sealed record JournalQuery(DateTimeOffset? From, DateTimeOffset? To, IReadOnlyList<Guid> ConnectionIds, IReadOnlyList<string?> Environments, IReadOnlyList<EJournalLevel> Levels, IReadOnlyList<EJournalKind> Kinds, IReadOnlyList<EJournalOutcome> Outcomes, string? Text, bool HistoryOnly, long? Before, int Limit, Guid? ScriptRunId = null)
{
    /// <summary>RN-DIARIO-009: filtros e textos de busca nunca saem em logs.</summary>
    public override string ToString() => nameof(JournalQuery);
}

/// <summary>Página de registros do diário, com cursor para a próxima página e total do filtro.</summary>
public sealed record JournalPage(IReadOnlyList<JournalEntry> Items, long? NextBefore, long Total);

/// <summary>RN-AUDIT-011: conexão que aparece nos registros do diário.</summary>
public sealed record JournalConnectionFacet(Guid ConnectionId, string Name, string? Engine, string? EnvironmentName, string? EnvironmentColor);

/// <summary>RN-AUDIT-011: ambiente que aparece nos registros do diário (`Name` nulo representa "Sem ambiente").</summary>
public sealed record JournalEnvironmentFacet(string? Name, string? Color);

/// <summary>RN-AUDIT-010, 011 e 015: conexões, ambientes e números gerais do diário para a tela de Auditoria.</summary>
public sealed record JournalFacets(IReadOnlyList<JournalConnectionFacet> Connections, IReadOnlyList<JournalEnvironmentFacet> Environments, long TotalEntries, DateTimeOffset? OldestEntryAt, long FileSizeBytes, int? RetentionDays);
