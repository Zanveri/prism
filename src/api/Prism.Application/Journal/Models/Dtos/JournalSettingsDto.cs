namespace Prism.Application.Journal.Models.Dtos;

public sealed record JournalSettingsDto
{
    public int RetentionDays { get; init; }

    public override string ToString() => nameof(JournalSettingsDto);
}
