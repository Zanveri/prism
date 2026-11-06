namespace Prism.Application.Journal.Models.Dtos;

public sealed record AuditPageDto
{
    public IReadOnlyList<AuditItemDto> Items { get; init; } = [];
    public long Total { get; init; }
    public long? Next { get; init; }

    public override string ToString() => nameof(AuditPageDto);
}
