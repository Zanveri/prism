namespace Prism.Application.Transfers.Models.Dtos;

/// <summary>
/// RN-EXPORT-016 e seção 6: o item de `GET api/user/transfers/{id}` e de cada linha de `GET api/user/transfers`. Toda chave vem sempre, nula quando não se
/// aplica. `Kind` é `export`, `import` ou `copy` (seção 36); `State`, `running`, `done`, `failed` ou `canceled`; `Phase`, a fase pela qual o trabalho passou
/// por último (`connecting`, `counting`, `reading` ou `finishing` na exportação; `connecting`, `counting`, `checking`, `emptying`, `loading` ou
/// `committing` na importação e na cópia); `Reason`, no `canceled`, `person`, `connectionDeleted` ou `readOnly`. `ConnectionID` é a da origem na
/// exportação e na cópia, e a do destino na importação; `TargetConnectionID`, a do destino (nula na exportação; igual a `ConnectionID` na importação).
/// `Committed` e `Size` vêm nulos na exportação, e `Size` também na cópia, em que `Bytes` vem nulo; `Uncertain` vem falso na exportação (verdadeiro só
/// na importação ou na cópia que parou sem se saber o que a última confirmação deixou). As datas estão em UTC.
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
    public long? Bytes { get; init; }
    public long? Size { get; init; }
    public bool Uncertain { get; init; }
    public TransferSummaryDto? Summary { get; init; }
    public TransferErrorDto? Error { get; init; }
    public string? Reason { get; init; }
    public DateTime StartedAt { get; init; }
    public DateTime? FinishedAt { get; init; }
}

/// <summary>
/// RN-EXPORT-022: o resumo da exportação que terminou. `Sheets` só no XLSX; as contagens, zero quando nada aconteceu. RN-IMPORT-020: o da importação e da
/// cópia, também `Committed`, `Emptied`, `ShortRows`, `SkippedLines`, `Unguarded` e `FormulasWithoutValue` (zero, ou falso, quando não se aplicam).
/// </summary>
public sealed record TransferSummaryDto(long Rows, long Bytes, int? Sheets, long CutValues, long RemovedCharacters, long SkippedRows, long Committed, bool Emptied, long ShortRows, long SkippedLines, long Unguarded, long FormulasWithoutValue);

/// <summary>
/// RN-EXPORT-017: a falha do trabalho. `Code` é `DATABASE_CONNECTION_FAILED`, `SQL_EXECUTION_FAILED`, `EXPORT_COLUMNS_CHANGED`, `EXPORT_VALUE_TOO_LARGE`,
/// `EXPORT_STALLED`, `EXPORT_CLIPBOARD_TOO_LARGE` ou `EXPORT_WRITE_FAILED` e, na importação e na cópia (seção 36), também `IMPORT_VALUE_INVALID`,
/// `IMPORT_VALUE_TOO_LARGE`, `IMPORT_FILE_UNREADABLE`, `IMPORT_TABLE_NOT_FOUND`, `IMPORT_TARGET_NOT_TABLE`, `IMPORT_TABLE_CHANGED`,
/// `IMPORT_MAPPING_INVALID`, `IMPORT_STALLED` e `IMPORT_SOURCE_GROWING`, e `INTERNAL_SERVER_ERROR` (seção 6) quando um defeito do Prism lança dentro do
/// trabalho; `Message`, a do banco como veio ou a frase do Prism, sem a linha, que a tela compõe;
/// `SqlState`, quando o banco o deu. RN-IMPORT-016: `Line` (a linha do arquivo, ou da leitura da origem), `Column` (a do arquivo, ou da origem), `Side`
/// (`source` ou `target`), `Committed` e `Uncertain`, todos sempre presentes, nulos quando não se aplicam (na exportação, todos).
/// </summary>
public sealed record TransferErrorDto(string Code, string Message, string? SqlState, long? Line, string? Column, string? Side, long? Committed, bool? Uncertain)
{
    public override string ToString()
        => nameof(TransferErrorDto);
}
