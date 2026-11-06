using Prism.Infrastructure.Journal.Models;

namespace Prism.Application.Journal.Models;

internal static class JournalFormat
{
    public static readonly int[] AllowedRetentionDays = [0, 30, 90, 180, 365];

    public static string ToCode(EJournalLevel level)
        => level switch
        {
            EJournalLevel.Info => "info",
            EJournalLevel.Warning => "warning",
            EJournalLevel.High => "high",
            EJournalLevel.Critical => "critical",
            _ => "info"
        };

    public static bool TryParseLevel(string? value, out EJournalLevel level)
    {
        switch (value?.Trim())
        {
            case "info":
                level = EJournalLevel.Info;
                return true;
            case "warning":
                level = EJournalLevel.Warning;
                return true;
            case "high":
                level = EJournalLevel.High;
                return true;
            case "critical":
                level = EJournalLevel.Critical;
                return true;
            default:
                level = default;
                return false;
        }
    }

    public static string ToCode(EJournalKind kind)
        => kind switch
        {
            EJournalKind.Sql => "sql",
            EJournalKind.Edit => "edits",
            EJournalKind.Transaction => "transaction",
            EJournalKind.Data => "transfer",
            EJournalKind.Security => "security",
            EJournalKind.Connections => "connection",
            _ => "sql"
        };

    public static bool TryParseKind(string? value, out EJournalKind kind)
    {
        switch (value?.Trim())
        {
            case "sql":
                kind = EJournalKind.Sql;
                return true;
            case "edits":
            case "edit":
                kind = EJournalKind.Edit;
                return true;
            case "transaction":
                kind = EJournalKind.Transaction;
                return true;
            case "transfer":
            case "data":
                kind = EJournalKind.Data;
                return true;
            case "security":
                kind = EJournalKind.Security;
                return true;
            case "connection":
            case "connections":
                kind = EJournalKind.Connections;
                return true;
            default:
                kind = default;
                return false;
        }
    }

    public static string ToCode(EJournalOutcome outcome)
        => outcome switch
        {
            EJournalOutcome.InProgress => "inProgress",
            EJournalOutcome.Ok => "ok",
            EJournalOutcome.Error => "error",
            EJournalOutcome.Refused => "refused",
            EJournalOutcome.Cancelled => "cancelled",
            EJournalOutcome.Interrupted => "interrupted",
            _ => "ok"
        };

    public static bool TryParseOutcome(string? value, out EJournalOutcome outcome)
    {
        switch (value?.Trim())
        {
            case "inProgress":
                outcome = EJournalOutcome.InProgress;
                return true;
            case "ok":
                outcome = EJournalOutcome.Ok;
                return true;
            case "error":
                outcome = EJournalOutcome.Error;
                return true;
            case "refused":
                outcome = EJournalOutcome.Refused;
                return true;
            case "cancelled":
                outcome = EJournalOutcome.Cancelled;
                return true;
            case "interrupted":
                outcome = EJournalOutcome.Interrupted;
                return true;
            default:
                outcome = default;
                return false;
        }
    }

    public static string BuildAuditSummary(JournalEntry entry)
    {
        if (!string.IsNullOrWhiteSpace(entry.SqlText))
        {
            var trimmed = entry.SqlText.Trim();
            var newlineIndex = trimmed.IndexOfAny(['\r', '\n']);
            var firstLine = (newlineIndex >= 0 ? trimmed[..newlineIndex] : trimmed).Trim();
            if (firstLine.Length > 120)
                return string.Concat(firstLine.AsSpan(0, 119), "…");

            return newlineIndex >= 0 ? string.Concat(firstLine, "…") : firstLine;
        }

        return entry.Reason;
    }

    public static string FormatRetentionLabel(int? days)
        => days switch
        {
            null or 0 => "Sempre",
            365 => "1 ano",
            _ => $"{days.Value} dias"
        };
}
