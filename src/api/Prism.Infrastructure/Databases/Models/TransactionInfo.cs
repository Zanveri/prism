namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-TX-001: o modo de transação da aba, que a sessão dela segue.</summary>
public enum ETransactionMode
{
    /// <summary>Cada comando é confirmado quando termina (RN-SESSAO-005).</summary>
    AutoCommit,

    /// <summary>O primeiro comando abre a transação, e nada é confirmado antes de a pessoa pedir (RN-TX-002).</summary>
    Manual
}

/// <summary>RN-TX-002 e 009: em que pé está a transação manual da conexão.</summary>
public enum ETransactionState
{
    /// <summary>Não há transação aberta: Auto-commit, ou Commit manual antes do primeiro comando e depois de um Commit ou Rollback.</summary>
    None,

    Open,

    /// <summary>RN-TX-009: no PostgreSQL, um erro deixou a transação inteira com erro, e o banco só aceita o Rollback.</summary>
    Failed
}

/// <summary>
/// RN-TX-003 e seção 22 da especificação ("Rotas e respostas"): o estado da transação da sessão depois de uma operação, que a tela mostra
/// na barra do editor e na de status. `Commands` são os comandos sem commit (cada execução e cada "Salvar" contam um), e `OpenedAt`, quando
/// a transação abriu; os dois só existem com ela aberta. `IsolationLevel` é o nível de isolamento escolhido na aba (RN-ISOL-001).
/// </summary>
public sealed record TransactionInfo(ETransactionMode Mode, bool Open, bool Failed, int Commands, DateTimeOffset? OpenedAt, string IsolationLevel = IsolationLevels.Default);
