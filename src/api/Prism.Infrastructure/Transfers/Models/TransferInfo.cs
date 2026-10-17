namespace Prism.Infrastructure.Transfers.Models;

/// <summary>
/// RN-EXPORT-016: a falha de um trabalho: o código, a mensagem (a do banco como veio, decisão 4 da seção 8, ou a frase do Prism) e o SQLSTATE quando o
/// banco o deu. A mensagem vai para a tela e nunca para o log (RN-LOG-001).
/// </summary>
public sealed record TransferFailure(ETransferError Code, string Message, string? SqlState = null)
{
    public override string ToString()
        => nameof(TransferFailure);
}

/// <summary>RN-EXPORT-022: o resumo da exportação que terminou: as linhas, o tamanho do arquivo e o que do dado não saiu inteiro (`ExportCounts`).</summary>
public sealed record TransferSummary(long Rows, long Bytes, int? Sheets, long CutValues, long RemovedCharacters, long SkippedRows);

/// <summary>
/// RN-EXPORT-016 e seção 6: como um trabalho está, no instante da consulta. `Phase` é a última fase pela qual ele passou; `Total`, o que a contagem deu
/// (nulo sem ela); `Bytes`, o tamanho do arquivo temporário até ali. `Summary`, `Error` e `Reason` só no fim, e cada um no estado dele. Os campos da
/// importação e da cópia (seção 36): `TargetConnectionID`, `Committed` e `Size` são nulos na exportação, e `Uncertain` é falso nela (a exportação não
/// grava no banco, então nunca há o que a última confirmação deixou sem se saber).
/// </summary>
public sealed record TransferInfo(
    Guid ID,
    ETransferKind Kind,
    Guid ConnectionID,
    Guid? TargetConnectionID,
    long WindowID,
    ETransferState State,
    ETransferPhase Phase,
    long Rows,
    long? Committed,
    long? Total,
    long Bytes,
    long? Size,
    bool Uncertain,
    TransferSummary? Summary,
    TransferFailure? Error,
    ETransferCancelReason? Reason,
    DateTimeOffset StartedAt,
    DateTimeOffset? FinishedAt);
