namespace Prism.Application.Journal.Models.Dtos;

public sealed record HistoryPageDto
{
    public IReadOnlyList<HistoryItemDto> Items { get; init; } = [];
    public long? Next { get; init; }

    public override string ToString() => nameof(HistoryPageDto);
}
