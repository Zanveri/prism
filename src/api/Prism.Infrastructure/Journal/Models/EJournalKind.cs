namespace Prism.Infrastructure.Journal.Models;

/// <summary>RN-AUDIT-002 e 004: a família de um registro no diário.</summary>
public enum EJournalKind
{
    Sql = 0,
    Edit = 1,
    Transaction = 2,
    Data = 3,
    Security = 4,
    Connections = 5
}
