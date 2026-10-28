namespace Prism.Infrastructure.Plugins.Models;

/// <summary>
/// Os metadados lidos e validados do `manifest.json` de um plugin de terceiro.
/// </summary>
public sealed record PluginManifest(string ID, string Name, string Version, string? Description, string? Author, string Main, IReadOnlyList<string> Engines)
{
    /// <summary>RN-LOG-001: evita expor metadados de terceiros caso o record seja interpolado por engano.</summary>
    public override string ToString() => nameof(PluginManifest);
}
