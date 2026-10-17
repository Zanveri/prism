namespace Prism.Infrastructure.Transfers.Models;

/// <summary>RN-EXPORT-016 e seção 6: o tipo do trabalho. A importação e a cópia para outro banco (seção 36) entram no mesmo registro.</summary>
public enum ETransferKind
{
    Export,
    Import,
    Copy
}

/// <summary>RN-EXPORT-016: `running`, `done`, `failed` ou `canceled`.</summary>
public enum ETransferState
{
    Running,
    Done,
    Failed,
    Canceled
}

/// <summary>
/// RN-EXPORT-016 e 021: a fase da exportação, que a barra de status escreve: conectando, contando as linhas, lendo (e escrevendo) e terminando (o .zip,
/// o arquivo indo para o disco). As fases da importação (seção 36) entram aqui quando ela vier.
/// </summary>
public enum ETransferPhase
{
    Connecting,
    Counting,
    Reading,
    Finishing
}

/// <summary>RN-EXPORT-016: por que o trabalho foi cancelado: a pessoa (o `DELETE`) ou a exclusão da conexão (RN-CONN-014).</summary>
public enum ETransferCancelReason
{
    Person,
    ConnectionDeleted
}

/// <summary>RN-EXPORT-017 e 018: o código da falha de um trabalho, que a tela lê no `error.code` do `GET` (a mensagem é do banco ou do Prism).</summary>
public enum ETransferError
{
    DatabaseConnectionFailed,
    SqlExecutionFailed,
    ColumnsChanged,
    ValueTooLarge,
    Stalled,
    ClipboardTooLarge,
    WriteFailed
}

/// <summary>RN-EXPORT-016: as recusas do registro ao começar um trabalho, as duas conferidas sob a trava com que ele entra no registro.</summary>
public enum ETransferStartFailure
{
    /// <summary>409 `TRANSFER_LIMIT_REACHED`: já há 3 transferências em andamento.</summary>
    LimitReached,

    /// <summary>401 `VAULT_LOCKED`: o cofre aberto mudou depois da leitura da conexão.</summary>
    VaultChanged
}
