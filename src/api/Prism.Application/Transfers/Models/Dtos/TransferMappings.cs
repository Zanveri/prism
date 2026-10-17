using Prism.Infrastructure.Transfers.Models;

namespace Prism.Application.Transfers.Models.Dtos;

/// <summary>Onde os estados e os códigos dos trabalhos viram o texto da rota: a Infrastructure fala em enums.</summary>
internal static class TransferMappings
{
    public static TransferDto ToDto(this TransferInfo source)
        => new()
        {
            ID = source.ID,
            Kind = KindText(source.Kind),
            ConnectionID = source.ConnectionID,
            TargetConnectionID = source.TargetConnectionID,
            WindowID = source.WindowID,
            State = StateText(source.State),
            Phase = PhaseText(source.Phase),
            Rows = source.Rows,
            Committed = source.Committed,
            Total = source.Total,
            Bytes = source.Kind == ETransferKind.Copy ? null : source.Bytes,
            Size = source.Size,
            Uncertain = source.Uncertain,
            Summary = source.Summary is { } summary ? new TransferSummaryDto(summary.Rows, summary.Bytes, summary.Sheets, summary.CutValues, summary.RemovedCharacters, summary.SkippedRows, summary.Committed, summary.Emptied, summary.ShortRows, summary.SkippedLines, summary.Unguarded, summary.FormulasWithoutValue) : null,
            Error = source.Error is { } error ? new TransferErrorDto(ErrorCode(error.Code), error.Message, error.SqlState, error.Line, error.Column, error.Side is { } side ? SideText(side) : null, error.Committed, error.Uncertain) : null,
            Reason = source.Reason is { } reason ? ReasonText(reason) : null,
            StartedAt = source.StartedAt.UtcDateTime,
            FinishedAt = source.FinishedAt?.UtcDateTime
        };

    public static string ErrorCode(ETransferError error)
        => error switch
        {
            ETransferError.DatabaseConnectionFailed => "DATABASE_CONNECTION_FAILED",
            ETransferError.SqlExecutionFailed => "SQL_EXECUTION_FAILED",
            ETransferError.ColumnsChanged => "EXPORT_COLUMNS_CHANGED",
            ETransferError.ValueTooLarge => "EXPORT_VALUE_TOO_LARGE",
            ETransferError.Stalled => "EXPORT_STALLED",
            ETransferError.ClipboardTooLarge => "EXPORT_CLIPBOARD_TOO_LARGE",
            ETransferError.WriteFailed => "EXPORT_WRITE_FAILED",
            ETransferError.ImportValueInvalid => "IMPORT_VALUE_INVALID",
            ETransferError.ImportValueTooLarge => "IMPORT_VALUE_TOO_LARGE",
            ETransferError.ImportFileUnreadable => "IMPORT_FILE_UNREADABLE",
            ETransferError.ImportTableNotFound => "IMPORT_TABLE_NOT_FOUND",
            ETransferError.ImportTargetNotTable => "IMPORT_TARGET_NOT_TABLE",
            ETransferError.ImportTableChanged => "IMPORT_TABLE_CHANGED",
            ETransferError.ImportMappingInvalid => "IMPORT_MAPPING_INVALID",
            ETransferError.ImportStalled => "IMPORT_STALLED",
            ETransferError.ImportSourceGrowing => "IMPORT_SOURCE_GROWING",
            ETransferError.Unexpected => "INTERNAL_SERVER_ERROR",
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    private static string KindText(ETransferKind kind)
        => kind switch
        {
            ETransferKind.Export => "export",
            ETransferKind.Import => "import",
            ETransferKind.Copy => "copy",
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    private static string StateText(ETransferState state)
        => state switch
        {
            ETransferState.Running => "running",
            ETransferState.Done => "done",
            ETransferState.Failed => "failed",
            ETransferState.Canceled => "canceled",
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    private static string PhaseText(ETransferPhase phase)
        => phase switch
        {
            ETransferPhase.Connecting => "connecting",
            ETransferPhase.Counting => "counting",
            ETransferPhase.Reading => "reading",
            ETransferPhase.Finishing => "finishing",
            ETransferPhase.Checking => "checking",
            ETransferPhase.Emptying => "emptying",
            ETransferPhase.Loading => "loading",
            ETransferPhase.Committing => "committing",
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    private static string SideText(ETransferSide side)
        => side switch
        {
            ETransferSide.Source => "source",
            ETransferSide.Target => "target",
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    private static string ReasonText(ETransferCancelReason reason)
        => reason switch
        {
            ETransferCancelReason.Person => "person",
            ETransferCancelReason.ConnectionDeleted => "connectionDeleted",
            ETransferCancelReason.ReadOnly => "readOnly",
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };
}
