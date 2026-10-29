namespace Prism.Infrastructure.Databases.Models;

/// <param name="TransactionsAvailable">RN-TX-013: o banco da sessão tem transação, e a aba pode ficar no Commit manual (o Informix sem log de transação não tem).</param>
public sealed record DatabaseSessionInfo(Guid ID, Guid ConnectionID, EDatabaseEngine Engine, string Database, string ServerVersion, bool TransactionsAvailable = true);
