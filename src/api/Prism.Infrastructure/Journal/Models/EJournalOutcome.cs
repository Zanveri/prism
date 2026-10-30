namespace Prism.Infrastructure.Journal.Models;

/// <summary>RN-DIARIO-006 e RN-AUDIT-001: o desfecho de um registro no diário.</summary>
public enum EJournalOutcome
{
    InProgress = 0,
    Ok = 1,
    Error = 2,
    Refused = 3,
    Cancelled = 4,
    Interrupted = 5
}
