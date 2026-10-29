namespace Prism.Application.DatabaseSessions.Models.Dtos;

/// <summary>
/// RN-TX-003 e seção 22 da especificação ("Rotas e respostas"): o estado da transação da sessão depois da operação. `Mode` é `autoCommit` ou `manual`;
/// `IsolationLevel` é `default` (o seletor de nível ainda não existe); `Commands` e `OpenedAt` só valem com `Open`.
/// </summary>
public sealed record TransactionDto(string Mode, string IsolationLevel, bool Open, bool Failed, int Commands, DateTimeOffset? OpenedAt);

/// <summary>RN-TX-002 e 014: a resposta do Commit e do Rollback: o estado depois deles e quantos comandos a transação tinha.</summary>
public sealed record TransactionEndedDto(TransactionDto Transaction, int Commands);
