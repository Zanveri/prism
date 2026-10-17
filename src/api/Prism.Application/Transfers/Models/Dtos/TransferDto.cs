namespace Prism.Application.Transfers.Models.Dtos;

/// <summary>
/// RN-EXPORT-016 e seção 6: o item de `GET api/user/transfers/{id}` e de cada linha de `GET api/user/transfers`. Toda chave vem sempre, nula quando não se
/// aplica. `Kind` é `export` (a importação e a cópia, seção 36, `import` e `copy`); `State`, `running`, `done`, `failed` ou `canceled`; `Phase`, a fase pela
/// qual o trabalho passou por último (`connecting`, `counting`, `reading` ou `finishing`); `Reason`, no `canceled`, `person` ou `connectionDeleted`. Os
/// campos da importação e da cópia (`TargetConnectionID`, `Committed`, `Size`) vêm nulos na exportação, e `Uncertain` vem falso nela (seção 36: verdadeiro
/// só na importação ou na cópia que parou sem se saber o que a última confirmação deixou). As datas estão em UTC.
/// </summary>
public sealed record TransferDto
{
    public Guid ID { get; init; }
    public string Kind { get; init; } = string.Empty;
    public Guid ConnectionID { get; init; }
    public Guid? TargetConnectionID { get; init; }
    public long WindowID { get; init; }
    public string State { get; init; } = string.Empty;
    public string? Phase { get; init; }
    public long Rows { get; init; }
    public long? Committed { get; init; }
    public long? Total { get; init; }
    public long Bytes { get; init; }
    public long? Size { get; init; }
    public bool Uncertain { get; init; }
    public TransferSummaryDto? Summary { get; init; }
    public TransferErrorDto? Error { get; init; }
    public string? Reason { get; init; }
    public DateTime StartedAt { get; init; }
    public DateTime? FinishedAt { get; init; }
}

/// <summary>RN-EXPORT-022: o resumo da exportação que terminou. `Sheets` só no XLSX; as contagens, zero quando nada aconteceu.</summary>
public sealed record TransferSummaryDto(long Rows, long Bytes, int? Sheets, long CutValues, long RemovedCharacters, long SkippedRows);

/// <summary>
/// RN-EXPORT-017: a falha do trabalho. `Code` é `DATABASE_CONNECTION_FAILED`, `SQL_EXECUTION_FAILED`, `EXPORT_COLUMNS_CHANGED`, `EXPORT_VALUE_TOO_LARGE`,
/// `EXPORT_STALLED`, `EXPORT_CLIPBOARD_TOO_LARGE` ou `EXPORT_WRITE_FAILED`; `Message`, a do banco como veio ou a frase do Prism; `SqlState`, quando o banco o deu.
/// </summary>
public sealed record TransferErrorDto(string Code, string Message, string? SqlState)
{
    public override string ToString()
        => nameof(TransferErrorDto);
}
