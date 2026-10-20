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
/// o arquivo indo para o disco). RN-IMPORT-014 e 027: as da importação e da cópia: conectando (e lendo o catálogo), contando (a cópia), conferindo o
/// arquivo inteiro (a importação), esvaziando a tabela, lendo e gravando, e a confirmação final.
/// </summary>
public enum ETransferPhase
{
    Connecting,
    Counting,
    Reading,
    Finishing,
    Checking,
    Emptying,
    Loading,
    Committing
}

/// <summary>
/// RN-EXPORT-016: por que o trabalho foi cancelado: a pessoa (o `DELETE`) ou a exclusão da conexão (RN-CONN-014). RN-IMPORT-014: na importação e na cópia,
/// também a conexão de destino que passou a ser somente leitura (RN-PROT-006).
/// </summary>
public enum ETransferCancelReason
{
    Person,
    ConnectionDeleted,
    ReadOnly
}

/// <summary>RN-IMPORT-016 e 027: de que lado foi a falha de uma importação ou de uma cópia: a leitura da origem (só na cópia) ou a gravação no destino.</summary>
public enum ETransferSide
{
    Source,
    Target
}

/// <summary>
/// RN-EXPORT-017 e 018: o código da falha de um trabalho, que a tela lê no `error.code` do `GET` (a mensagem é do banco ou do Prism). As notas da seção 36:
/// os da importação e da cópia.
/// </summary>
public enum ETransferError
{
    DatabaseConnectionFailed,
    SqlExecutionFailed,
    ColumnsChanged,
    ValueTooLarge,
    Stalled,
    ClipboardTooLarge,
    WriteFailed,

    /// <summary>RN-IMPORT-016: o Prism recusou a linha (o problema dela na leitura, a conversão de um valor).</summary>
    ImportValueInvalid,

    /// <summary>RN-IMPORT-008: o valor acima de 64 MiB ou a linha acima de 256 MiB do arquivo.</summary>
    ImportValueTooLarge,

    /// <summary>RN-IMPORT-016: o arquivo que parou no meio da leitura (a codificação, a aspa que não fecha, o limite do .zip).</summary>
    ImportFileUnreadable,

    /// <summary>RN-IMPORT-015: a tabela de destino não existe mais.</summary>
    ImportTableNotFound,

    /// <summary>RN-IMPORT-015: o destino deixou de ser uma tabela comum.</summary>
    ImportTargetNotTable,

    /// <summary>RN-IMPORT-015: uma coluna mapeada sumiu, passou a ser calculada pelo banco ou mudou de tipo.</summary>
    ImportTableChanged,

    /// <summary>RN-IMPORT-009: a posição do mapeamento além das colunas do arquivo.</summary>
    ImportMappingInvalid,

    /// <summary>RN-IMPORT-014 e 027: 2 horas sem progresso.</summary>
    ImportStalled,

    /// <summary>RN-IMPORT-023: a origem da cópia leu mais linhas que as contadas, além da folga.</summary>
    ImportSourceGrowing,

    /// <summary>
    /// Seção 6: a exceção não prevista dentro de uma importação ou de uma cópia (um defeito do Prism), o `INTERNAL_SERVER_ERROR` das rotas, que termina o
    /// trabalho em vez de deixá-lo rodando para sempre.
    /// </summary>
    Unexpected
}

/// <summary>RN-EXPORT-016 e RN-IMPORT-014: as recusas do registro ao começar um trabalho, todas conferidas sob a trava com que ele entra no registro.</summary>
public enum ETransferStartFailure
{
    /// <summary>409 `TRANSFER_LIMIT_REACHED`: já há 3 transferências em andamento.</summary>
    LimitReached,

    /// <summary>401 `VAULT_LOCKED`: o cofre aberto mudou depois da leitura da conexão.</summary>
    VaultChanged,

    /// <summary>409 `IMPORT_TARGET_BUSY`: já há uma importação para a mesma tabela em andamento.</summary>
    ImportBusy,

    /// <summary>409 `IMPORT_TARGET_BUSY`: já há uma cópia para a mesma tabela em andamento.</summary>
    CopyBusy,

    /// <summary>404 `IMPORT_FILE_MISSING`: o arquivo sumiu entre a conferência e a troca de nome (o processo principal o soltou).</summary>
    FileMissing
}
