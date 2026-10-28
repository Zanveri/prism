namespace Prism.Application.Plugins.Models.Dtos;

public sealed record PluginBundleDto(string ID, string Name, string Version, IReadOnlyList<string> Engines, string Code)
{
    public override string ToString() => nameof(PluginBundleDto);
}
