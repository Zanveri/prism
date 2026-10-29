namespace Prism.Infrastructure.Databases.Clients;

/// <summary>RN-TX-004: o que um comando de controle de transação digitado é (<see cref="SqlText.TransactionControlOf"/>).</summary>
internal enum ETransactionControl
{
    /// <summary>Não é controle de transação.</summary>
    None,

    /// <summary>`BEGIN`, `BEGIN WORK`, `START TRANSACTION`: recusado nos dois modos.</summary>
    Begin,

    /// <summary>`COMMIT`, `COMMIT WORK`, `END`: no Commit manual, o botão "Commit".</summary>
    Commit,

    /// <summary>`ROLLBACK`, `ROLLBACK WORK`, `ABORT`: no Commit manual, o botão "Rollback".</summary>
    Rollback,

    /// <summary>`SAVEPOINT` e `RELEASE [SAVEPOINT]`: no Commit manual, vai ao banco, dentro da transação.</summary>
    Savepoint,

    /// <summary>`ROLLBACK [WORK] TO [SAVEPOINT]`: no Commit manual, vai ao banco; no PostgreSQL tira a transação do estado de erro.</summary>
    RollbackToSavepoint,

    /// <summary>`PREPARE TRANSACTION`, `COMMIT PREPARED`, `... AND CHAIN` e o que vier depois de uma forma conhecida: recusado nos dois modos.</summary>
    Never
}
