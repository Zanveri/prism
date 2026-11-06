using Prism.Infrastructure.Journal.Models;

namespace Prism.Application.Journal.Models.Dtos;

public sealed record HistoryItemDto
{
    public long Id { get; init; }
    public DateTimeOffset StartedAt { get; init; }
    public long? DurationMs { get; init; }
    public string Outcome { get; init; } = string.Empty;
    public long? Rows { get; init; }
    public Guid? ConnectionId { get; init; }
    public string? ConnectionName { get; init; }
    public string? Database { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }
    public string Text { get; init; } = string.Empty;
    public string? ErrorMessage { get; init; }
    public int Repeat { get; init; } = 1;
    public DateTimeOffset LastAt { get; init; }

    /// <summary>RN-DIARIO-009 e RN-LOG-001: não expõe SQL nem nome de conexão no log em texto.</summary>
    public override string ToString() => nameof(HistoryItemDto);

    internal static HistoryItemDto FromEntry(JournalEntry entry, int repeat = 1)
    {
        var text = !string.IsNullOrWhiteSpace(entry.HistoryText)
            ? entry.HistoryText
            : entry.SqlText ?? entry.Action;

        return new HistoryItemDto
        {
            Id = entry.Id,
            StartedAt = entry.StartedAt,
            DurationMs = entry.DurationMs,
            Outcome = JournalFormat.ToCode(entry.Outcome),
            Rows = entry.RowCount,
            ConnectionId = entry.Connection.ConnectionId,
            ConnectionName = entry.Connection.Name,
            Database = entry.Connection.Database,
            EnvironmentName = entry.Connection.EnvironmentName,
            EnvironmentColor = entry.Connection.EnvironmentColor,
            Text = text,
            ErrorMessage = entry.ErrorMessage,
            Repeat = repeat,
            LastAt = entry.StartedAt
        };
    }
}
