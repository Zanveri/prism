namespace Prism.Infrastructure.Journal.Models;

/// <summary>RN-DIARIO-003, 005 e seções 6.4/6.5: falhas das operações de leitura e manutenção do diário.</summary>
public enum EJournalError
{
    Locked,
    Unavailable,
    NotFound
}
