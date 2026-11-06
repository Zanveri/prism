namespace Prism.Infrastructure.Journal.Models;

/// <summary>RN-AUDIT-005: os quatro níveis de perigo de um comando ou evento no diário.</summary>
public enum EJournalLevel
{
    Info = 0,
    Warning = 1,
    High = 2,
    Critical = 3
}
