namespace Prism.Infrastructure.Transfers.Models;

/// <summary>
/// RN-EXPORT-016: a falha de um trabalho: o código, a mensagem (a do banco como veio, decisão 4 da seção 8, ou a frase do Prism) e o SQLSTATE quando o
/// banco o deu. A mensagem vai para a tela e nunca para o log (RN-LOG-001).
///
/// RN-IMPORT-016, na importação e na cópia: `Line` é a linha do arquivo (a da planilha, o item da lista; na cópia, o número da linha na leitura da
/// origem), ou nula; `Column`, o nome da coluna do arquivo (ou da origem), ou nulo; `Side`, o lado (`target` na importação; `source` na leitura da
/// cópia); `Committed`, as linhas confirmadas até a falha; `Uncertain`, que o Prism não sabe o que a última confirmação deixou. Nulos na exportação.
/// </summary>
public sealed record TransferFailure(ETransferError Code, string Message, string? SqlState = null)
{
    public long? Line { get; init; }

    /// <summary>O nome da coluna do arquivo ou da origem: dado da pessoa, que vai à tela e não ao log.</summary>
    public string? Column { get; init; }

    public ETransferSide? Side { get; init; }

    public long? Committed { get; init; }

    public bool? Uncertain { get; init; }

    public override string ToString()
        => nameof(TransferFailure);
}

/// <summary>
/// RN-EXPORT-022: o resumo da exportação que terminou: as linhas, o tamanho do arquivo e o que do dado não saiu inteiro (`ExportCounts`). RN-IMPORT-020: o
/// da importação e da cópia, também as linhas confirmadas, se a tabela foi esvaziada e o que a leitura fez no caminho (as linhas completadas com nulo, as
/// linhas vazias puladas, os valores que perderam o apóstrofo da proteção e as células com fórmula sem resultado guardado), zero quando não se aplicam.
/// </summary>
public sealed record TransferSummary(long Rows, long Bytes, int? Sheets, long CutValues, long RemovedCharacters, long SkippedRows)
{
    public long Committed { get; init; }

    public bool Emptied { get; init; }

    public long ShortRows { get; init; }

    public long SkippedLines { get; init; }

    public long Unguarded { get; init; }

    public long FormulasWithoutValue { get; init; }
}

/// <summary>
/// RN-EXPORT-016 e seção 6: como um trabalho está, no instante da consulta. `Phase` é a última fase pela qual ele passou; `Total`, o que a contagem deu
/// (nulo sem ela); `Bytes`, o tamanho do arquivo temporário até ali (na importação, o que já foi lido do arquivo). `Summary`, `Error` e `Reason` só no
/// fim, e cada um no estado dele. Os campos da importação e da cópia (seção 36): `TargetConnectionID` (o destino; igual a `ConnectionID` na importação),
/// `Committed` (as linhas confirmadas) e `Size` (o tamanho do arquivo da importação) são nulos na exportação, e `Uncertain` é falso nela (a exportação não
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
