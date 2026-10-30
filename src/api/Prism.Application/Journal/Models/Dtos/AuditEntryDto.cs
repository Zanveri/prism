using Prism.Infrastructure.Journal.Models;

namespace Prism.Application.Journal.Models.Dtos;

public sealed record AuditEntryDto
{
    public long Id { get; init; }
    public DateTimeOffset StartedAt { get; init; }
    public DateTimeOffset? EndedAt { get; init; }
    public long? DurationMs { get; init; }
    public string Kind { get; init; } = string.Empty;
    public string Action { get; init; } = string.Empty;
    public string Level { get; init; } = string.Empty;
    public string Reason { get; init; } = string.Empty;
    public string Summary { get; init; } = string.Empty;
    public string Outcome { get; init; } = string.Empty;
    public string? Origin { get; init; }
    public Guid? ConnectionId { get; init; }
    public string? ConnectionName { get; init; }
    public string? Engine { get; init; }
    public string? FolderPath { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }
    public string? Database { get; init; }
    public Guid? SessionId { get; init; }
    public Guid? ScriptRunId { get; init; }
    public string? Sql { get; init; }
    public string? HistoryText { get; init; }
    public long? Rows { get; init; }
    public string? ErrorCode { get; init; }
    public string? SqlState { get; init; }
    public string? ErrorMessage { get; init; }
    public bool Confirmed { get; init; }
    public string? Protections { get; init; }

    /// <summary>RN-DIARIO-009 e RN-LOG-001: não expõe SQL nem nome de conexão no log em texto.</summary>
    public override string ToString() => nameof(AuditEntryDto);

    internal static AuditEntryDto FromEntry(JournalEntry entry)
        => new()
        {
            Id = entry.Id,
            StartedAt = entry.StartedAt,
            EndedAt = entry.EndedAt,
            DurationMs = entry.DurationMs,
            Kind = JournalFormat.ToCode(entry.Kind),
            Action = entry.Action,
            Level = JournalFormat.ToCode(entry.Level),
            Reason = entry.Reason,
            Summary = JournalFormat.BuildAuditSummary(entry),
            Outcome = JournalFormat.ToCode(entry.Outcome),
            Origin = entry.Origin,
            ConnectionId = entry.Connection.ConnectionId,
            ConnectionName = entry.Connection.Name,
            Engine = entry.Connection.Engine,
            FolderPath = entry.Connection.FolderPath,
            EnvironmentName = entry.Connection.EnvironmentName,
            EnvironmentColor = entry.Connection.EnvironmentColor,
            Database = entry.Connection.Database,
            SessionId = entry.SessionId,
            ScriptRunId = entry.ScriptRunId,
            Sql = entry.SqlText,
            HistoryText = entry.HistoryText,
            Rows = entry.RowCount,
            ErrorCode = entry.ErrorCode,
            SqlState = entry.SqlState,
            ErrorMessage = entry.ErrorMessage,
            Confirmed = entry.Confirmed,
            Protections = entry.Protections
        };
}
