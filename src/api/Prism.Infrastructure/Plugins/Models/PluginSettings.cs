namespace Prism.Infrastructure.Plugins.Models;

/// <summary>
/// Onde os plugins baixados via Git ficam armazenados na máquina (`&lt;PRISM_DATA_DIR&gt;/plugins`).
/// </summary>
public sealed record PluginSettings(string Directory)
{
    public static PluginSettings For(string dataDirectory)
        => new(Path.Combine(dataDirectory, "plugins"));

    /// <summary>RN-LOG-001: não imprime o caminho da máquina.</summary>
    public override string ToString() => nameof(PluginSettings);
}
