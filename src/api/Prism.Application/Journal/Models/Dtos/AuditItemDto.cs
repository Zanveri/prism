using Prism.Infrastructure.Journal.Models;

namespace Prism.Application.Journal.Models.Dtos;

public sealed record AuditItemDto
{
    public long Id { get; init; }
    public DateTimeOffset StartedAt { get; init; }
    public string Level { get; init; } = string.Empty;
    public string Kind { get; init; } = string.Empty;
    public string Action { get; init; } = string.Empty;
    public string Summary { get; init; } = string.Empty;
    public Guid? ConnectionId { get; init; }
    public string? ConnectionName { get; init; }
    public string? Database { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }
    public string Outcome { get; init; } = string.Empty;
    public long? DurationMs { get; init; }
    public long? Rows { get; init; }
    public Guid? ScriptRunId { get; init; }

    /// <summary>RN-DIARIO-009 e RN-LOG-001: não expõe SQL nem nome de conexão no log em texto.</summary>
    public override string ToString() => nameof(AuditItemDto);

    internal static AuditItemDto FromEntry(JournalEntry entry)
        => new()
        {
            Id = entry.Id,
            StartedAt = entry.StartedAt,
            Level = JournalFormat.ToCode(entry.Level),
            Kind = JournalFormat.ToCode(entry.Kind),
            Action = entry.Action,
            Summary = JournalFormat.BuildAuditSummary(entry),
            ConnectionId = entry.Connection.ConnectionId,
            ConnectionName = entry.Connection.Name,
            Database = entry.Connection.Database,
            EnvironmentName = entry.Connection.EnvironmentName,
            EnvironmentColor = entry.Connection.EnvironmentColor,
            Outcome = JournalFormat.ToCode(entry.Outcome),
            DurationMs = entry.DurationMs,
            Rows = entry.RowCount,
            ScriptRunId = entry.ScriptRunId
        };
}
