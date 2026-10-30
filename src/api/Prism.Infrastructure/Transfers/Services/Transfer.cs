using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;

namespace Prism.Infrastructure.Transfers.Services;

/// <summary>
/// Um trabalho no registro (<see cref="TransferService"/>). Os campos mudam só com a trava do registro tomada; quem roda o trabalho os muda pelo
/// <see cref="TransferProgress"/>, que a toma. Não é um record: nada aqui se imprime.
/// </summary>
internal sealed class Transfer(Guid id, ETransferKind kind, Guid connectionID, long windowID, long vaultGeneration, DateTimeOffset startedAt, long startedTimestamp)
{
    public Guid ID => id;

    public ETransferKind Kind => kind;

    /// <summary>A conexão da origem (na exportação e na cópia) ou a do destino (na importação).</summary>
    public Guid ConnectionID => connectionID;

    public long WindowID => windowID;

    /// <summary>A geração do cofre aberto quando o trabalho começou: o cofre seguinte não o vê.</summary>
    public long VaultGeneration => vaultGeneration;

    public DateTimeOffset StartedAt => startedAt;

    public long StartedTimestamp { get; } = startedTimestamp;

    /// <summary>RN-IMPORT-014 e 027: a conexão de destino da importação (a mesma de `ConnectionID`) e da cópia; nula na exportação.</summary>
    public Guid? TargetConnectionID { get; init; }

    /// <summary>RN-IMPORT-014: a tabela de destino da importação e da cópia, pela regra da própria origem (a tabela ocupada); nula na exportação.</summary>
    public (ConnectionSettings Settings, string Schema, string Table)? Target { get; init; }

    /// <summary>RN-AUDIT-002: o identificador do registro aberto no diário quando o trabalho começou, ou -1 se não há registro pendente.</summary>
    public long JournalEntryID { get; set; } = -1;

    public ETransferState State { get; set; } = ETransferState.Running;

    public ETransferPhase Phase { get; set; } = ETransferPhase.Connecting;

    public long Rows { get; set; }

    /// <summary>RN-IMPORT-014: as linhas confirmadas (no Informix sem log, as gravadas); nulo na exportação.</summary>
    public long? Committed { get; set; }

    public long? Total { get; set; }

    public long Bytes { get; set; }

    /// <summary>RN-IMPORT-014: o tamanho do arquivo da importação (no XLSX, o descompactado da planilha); nulo na exportação e na cópia.</summary>
    public long? Size { get; set; }

    /// <summary>RN-IMPORT-014 e 016: o Prism não sabe o que a última confirmação (ou, no Informix sem log, o último comando) deixou.</summary>
    public bool Uncertain { get; set; }

    /// <summary>
    /// RN-IMPORT-014: o trabalho está numa confirmação (ou, no Informix sem log, num comando, que grava sozinho ao terminar): abandonado agora, o banco ainda
    /// pode concluí-la, e o fim leva `uncertain`.
    /// </summary>
    public bool InDoubt { get; set; }

    public TransferSummary? Summary { get; set; }

    public TransferFailure? Error { get; set; }

    public ETransferCancelReason? Reason { get; set; }

    public DateTimeOffset? FinishedAt { get; set; }

    /// <summary>O motivo do cancelamento pedido, que vale se o trabalho parar por ele.</summary>
    public ETransferCancelReason? CancelReason { get; set; }

    /// <summary>O trabalho saiu do registro (esquecido, abandonado, do cofre que fechou, a API encerrando): o arquivo dele sai também, mesmo pronto.</summary>
    public bool Removed { get; set; }

    /// <summary>O fim do trabalho fechou o arquivo dele: daqui em diante, quem tira o trabalho do registro apaga o arquivo.</summary>
    public bool Closed { get; set; }

    /// <summary>A última consulta (`GET` do trabalho), pelo relógio do registro; começa no início.</summary>
    public long LastPolled { get; set; } = startedTimestamp;

    /// <summary>O último progresso (uma fase nova, um lote escrito ou gravado, um bloco conferido), pelo relógio do registro; começa no início.</summary>
    public long LastProgress { get; set; } = startedTimestamp;

    public CancellationTokenSource Cancellation { get; } = new();

    public Task Task { get; set; } = Task.CompletedTask;
}

/// <summary>
/// RN-IMPORT-014 e 027: o que a importação e a cópia contam ao registro enquanto rodam: a fase, os bytes lidos e o tamanho, o total, as linhas gravadas e
/// confirmadas e a dúvida da confirmação em andamento. Cada mudança toma a trava do registro e só vale com o trabalho em andamento; a fase nova, um bloco
/// lido e as linhas gravadas são progresso, e adiam o fim por falta dele.
/// </summary>
internal sealed class TransferProgress(Transfer transfer, Lock gate, TimeProvider clock)
{
    /// <param name="bytes">O que já foi lido do arquivo, quando a fase nova recomeça a conta (a carga, depois da conferência), na mesma mudança.</param>
    public void Phase(ETransferPhase phase, long? bytes = null)
        => Update(running =>
        {
            running.Phase = phase;
            running.Bytes = bytes ?? running.Bytes;
        });

    public void Read(long bytes)
        => Update(running => running.Bytes = bytes);

    public void Size(long size)
        => Update(running => running.Size = size, progress: false);

    public void Total(long? total)
        => Update(running => running.Total = total, progress: false);

    public void Written(long rows)
        => Update(running => running.Rows = rows);

    public void Committed(long committed)
        => Update(running => running.Committed = committed);

    public void InDoubt(bool inDoubt)
        => Update(running => running.InDoubt = inDoubt, progress: false);

    private void Update(Action<Transfer> change, bool progress = true)
    {
        lock (gate)
        {
            if (transfer.State != ETransferState.Running)
                return;

            change(transfer);
            if (progress)
                transfer.LastProgress = clock.GetTimestamp();
        }
    }
}
