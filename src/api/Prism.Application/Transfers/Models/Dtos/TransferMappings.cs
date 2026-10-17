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
            Bytes = source.Bytes,
            Size = source.Size,
            Uncertain = source.Uncertain,
            Summary = source.Summary is { } summary ? new TransferSummaryDto(summary.Rows, summary.Bytes, summary.Sheets, summary.CutValues, summary.RemovedCharacters, summary.SkippedRows) : null,
            Error = source.Error is { } error ? new TransferErrorDto(ErrorCode(error.Code), error.Message, error.SqlState) : null,
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
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    private static string ReasonText(ETransferCancelReason reason)
        => reason switch
        {
            ETransferCancelReason.Person => "person",
            ETransferCancelReason.ConnectionDeleted => "connectionDeleted",
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };
}
