namespace Prism.Application.Plugins.Models.Dtos;

public sealed record PluginsStateDto(bool Consented, DateTimeOffset? ConsentedAt, IReadOnlyList<PluginItemDto> Items)
{
    public override string ToString() => nameof(PluginsStateDto);
}
