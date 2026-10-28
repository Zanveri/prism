namespace Prism.Application.Plugins.Models.Dtos;

public sealed record PluginItemDto(string ID, string Name, string Version, string? Description, string? Author, string SourceKind, string Source, bool Enabled, DateTimeOffset InstalledAt, DateTimeOffset UpdatedAt, bool Available, string? ErrorMessage)
{
    public override string ToString() => nameof(PluginItemDto);
}
