namespace Prism.Infrastructure.Databases.Models;

/// <summary>O desfecho de um comando: a primeira página, quando ele devolve linhas, ou as linhas afetadas, quando não devolve (RN-SQL-008). Um dos dois sempre vem.</summary>
/// <param name="Transaction">RN-TX-003: o estado da transação da sessão depois do comando. Quem o põe é o registro de sessões.</param>
/// <param name="TransactionUndone">RN-TX-008, 009 e 014: a transação manual que estava aberta antes do comando foi desfeita sem a pessoa pedir.</param>
public sealed record QueryOutcome(QueryPage? Page, long? RowsAffected, long ElapsedMs, TransactionInfo? Transaction = null, bool TransactionUndone = false);
