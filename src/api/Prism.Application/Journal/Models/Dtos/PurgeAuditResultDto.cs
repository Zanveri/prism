namespace Prism.Application.Journal.Models.Dtos;

public sealed record PurgeAuditResultDto
{
    public long Deleted { get; init; }

    public override string ToString() => nameof(PurgeAuditResultDto);
}
