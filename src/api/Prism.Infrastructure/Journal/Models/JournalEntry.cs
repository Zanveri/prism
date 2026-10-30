namespace Prism.Infrastructure.Journal.Models;

/// <summary>RN-AUDIT-001 e RN-DIARIO-006: dados iniciais de um registro no diário ao iniciar uma execução ou registrar um evento.</summary>
public sealed record JournalEntryStart(EJournalKind Kind, string Action, EJournalLevel Level, string Reason, string Origin = "other", string? Sql = null, string? HistoryText = null, bool Confirmed = false, Guid? SessionId = null, Guid? ScriptRunId = null, JournalConnectionSnapshot? Connection = null, string? Protections = null, DateTimeOffset StartedAt = default)
{
    public JournalEntryStart(DateTimeOffset StartedAt, EJournalKind Kind, string Action, EJournalLevel Level, string Reason, string Origin = "other", JournalConnectionSnapshot? Connection = null, Guid? SessionId = null, Guid? ScriptRunId = null, string? SqlText = null, string? HistoryText = null, bool Confirmed = false, string? Protections = null)
        : this(Kind, Action, Level, Reason, Origin, SqlText, HistoryText, Confirmed, SessionId, ScriptRunId, Connection, Protections, StartedAt)
    {
    }

    public string? SqlText => Sql;

    /// <summary>RN-DIARIO-009 e RN-LOG-001: comandos e nomes nunca saem em logs.</summary>
    public override string ToString() => nameof(JournalEntryStart);
}

/// <summary>RN-AUDIT-001 e RN-DIARIO-006: desfecho de um registro no diário ao terminar a execução.</summary>
public sealed record JournalEntryEnd(EJournalOutcome Outcome, long? RowCount = null, string? ErrorCode = null, string? SqlState = null, string? ErrorMessage = null, long? DurationMs = null, DateTimeOffset EndedAt = default)
{
    public JournalEntryEnd(DateTimeOffset EndedAt, long? DurationMs, EJournalOutcome Outcome, long? RowCount = null, string? ErrorCode = null, string? ErrorMessage = null, string? SqlState = null)
        : this(Outcome, RowCount, ErrorCode, SqlState, ErrorMessage, DurationMs, EndedAt)
    {
    }

    /// <summary>RN-DIARIO-009 e RN-LOG-001: mensagens do banco nunca saem em logs.</summary>
    public override string ToString() => nameof(JournalEntryEnd);
}

/// <summary>RN-AUDIT-001: um registro completo lido do diário cifrado.</summary>
public sealed record JournalEntry(long Id, DateTimeOffset StartedAt, DateTimeOffset? EndedAt, long? DurationMs, EJournalKind Kind, string Action, EJournalLevel Level, string Reason, EJournalOutcome Outcome, string Origin, JournalConnectionSnapshot Connection, Guid? SessionId, Guid? ScriptRunId, string? SqlText, string? HistoryText, long? RowCount, string? ErrorCode, string? ErrorMessage, bool Confirmed, string? Protections, bool HiddenInHistory, string? SqlState = null)
{
    public string? Sql => SqlText;

    /// <summary>RN-DIARIO-009 e RN-LOG-001: registros do diário nunca saem em logs.</summary>
    public override string ToString() => nameof(JournalEntry);
}
