using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Plugins.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Plugins.Clients;
using Prism.Infrastructure.Plugins.Models;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Plugins.Queries;

internal sealed class PluginQueries(IVaultService vaultService, IPluginSourceClient pluginSourceClient, PluginSettings pluginSettings) : IPluginQueries
{
    public Result<PluginsStateDto, ApiErrorDto> GetState()
    {
        var read = vaultService.Read();
        if (read.IsFailure)
            return VaultErrors.From(read.Error);

        var plugins = read.Value.Plugins;
        var items = (plugins?.Items ?? []).Select(DescribeItem).ToArray();

        return new PluginsStateDto(plugins?.ConsentedAt is not null, plugins?.ConsentedAt, items);
    }

    public Result<IReadOnlyList<PluginBundleDto>, ApiErrorDto> GetActiveBundles()
    {
        var read = vaultService.Read();
        if (read.IsFailure)
            return VaultErrors.From(read.Error);

        var plugins = read.Value.Plugins;
        if (plugins?.ConsentedAt is null)
            return Array.Empty<PluginBundleDto>();

        var bundles = new List<PluginBundleDto>();
        foreach (var item in (plugins.Items ?? []).Where(candidate => candidate.Enabled))
        {
            var inspected = InspectItemManifest(item);
            var bundle = pluginSourceClient.ReadBundle(item.ID, item.SourceKind, item.Source);
            if (inspected.IsSuccess && bundle.IsSuccess)
                bundles.Add(new PluginBundleDto(item.ID, inspected.Value.Name, inspected.Value.Version, inspected.Value.Engines, bundle.Value));
        }

        return bundles;
    }

    public Result<(long Generation, VaultPluginsRecord Plugins), ApiErrorDto> ReadSnapshot()
    {
        var generation = vaultService.Generation;
        var read = vaultService.Read();
        if (read.IsFailure)
            return VaultErrors.From(read.Error);

        return (generation, read.Value.Plugins ?? new VaultPluginsRecord());
    }

    public PluginItemDto DescribeItem(VaultPluginItemRecord item)
    {
        var inspected = InspectItemManifest(item);
        if (inspected.IsSuccess)
            return new PluginItemDto(item.ID, inspected.Value.Name, inspected.Value.Version, inspected.Value.Description, inspected.Value.Author, item.SourceKind, item.Source, item.Enabled, item.InstalledAt, item.UpdatedAt, true, null);

        return new PluginItemDto(item.ID, item.Name, item.Version, item.Description, item.Author, item.SourceKind, item.Source, item.Enabled, item.InstalledAt, item.UpdatedAt, false, inspected.Error.Message);
    }

    private Result<PluginManifest, PluginFailure> InspectItemManifest(VaultPluginItemRecord item)
    {
        var directory = string.Equals(item.SourceKind, "local", StringComparison.Ordinal) ? item.Source : Path.Combine(pluginSettings.Directory, item.ID);
        return pluginSourceClient.InspectLocal(directory);
    }
}
