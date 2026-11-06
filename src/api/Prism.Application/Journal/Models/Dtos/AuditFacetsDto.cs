namespace Prism.Application.Journal.Models.Dtos;

public sealed record AuditConnectionFacetDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public bool Deleted { get; init; }
    public string? Engine { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }

    public override string ToString() => nameof(AuditConnectionFacetDto);
}

public sealed record AuditEnvironmentFacetDto
{
    public string Name { get; init; } = string.Empty;
    public string? Color { get; init; }

    public override string ToString() => nameof(AuditEnvironmentFacetDto);
}

public sealed record AuditFacetsDto
{
    public IReadOnlyList<AuditConnectionFacetDto> Connections { get; init; } = [];
    public IReadOnlyList<AuditEnvironmentFacetDto> Environments { get; init; } = [];
    public long Count { get; init; }
    public DateTimeOffset? Oldest { get; init; }
    public long SizeBytes { get; init; }
    public int RetentionDays { get; init; }

    public override string ToString() => nameof(AuditFacetsDto);
}
