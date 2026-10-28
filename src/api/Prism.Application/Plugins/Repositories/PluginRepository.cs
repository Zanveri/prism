using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Plugins.Models;
using Prism.Application.Plugins.Models.Dtos;
using Prism.Application.Plugins.Queries;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Plugins.Models;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Plugins.Repositories;

internal sealed class PluginRepository(IVaultService vaultService, IPluginQueries pluginQueries) : IPluginRepository
{
    public async Task<Result<PluginsStateDto, ApiErrorDto>> SetConsent(bool accepted, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var saved = await vaultService.SaveOrRefuse(document =>
        {
            var current = document.Plugins ?? new VaultPluginsRecord();
            var currentItems = current.Items ?? [];

            if (accepted)
            {
                if (current.ConsentedAt is not null)
                    return document;

                return document with { Plugins = new VaultPluginsRecord(now, currentItems) };
            }

            if (current.ConsentedAt is null && currentItems.All(item => !item.Enabled))
                return document;

            var disabledItems = currentItems.Select(item => item with { Enabled = false }).ToArray();
            return document with { Plugins = new VaultPluginsRecord(null, disabledItems) };
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        return pluginQueries.GetState();
    }

    public async Task<Result<PluginItemDto, ApiErrorDto>> Insert(PluginManifest manifest, string sourceKind, string source, long generation, DateTimeOffset now, CancellationToken cancellationToken)
    {
        VaultPluginItemRecord? inserted = null;

        var saved = await vaultService.SaveOrRefuse(document =>
        {
            if (vaultService.Generation != generation)
                return VaultErrors.From(EVaultError.Locked);

            var current = document.Plugins;
            if (current?.ConsentedAt is null)
                return PluginErrors.ConsentRequired();

            var items = current.Items ?? [];
            if (items.Any(item => string.Equals(item.ID, manifest.ID, StringComparison.Ordinal)))
                return PluginErrors.AlreadyInstalled(manifest.ID);

            inserted = new VaultPluginItemRecord(manifest.ID, manifest.Name, manifest.Version, manifest.Description, manifest.Author, sourceKind, source, true, now, now);
            return document with { Plugins = current with { Items = [.. items, inserted] } };
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        return pluginQueries.DescribeItem(inserted!);
    }

    public async Task<Result<PluginItemDto, ApiErrorDto>> UpdateManifest(string id, PluginManifest manifest, long generation, DateTimeOffset now, CancellationToken cancellationToken)
    {
        VaultPluginItemRecord? updated = null;

        var saved = await vaultService.SaveOrRefuse(document =>
        {
            if (vaultService.Generation != generation)
                return VaultErrors.From(EVaultError.Locked);

            var current = document.Plugins;
            if (current?.ConsentedAt is null)
                return PluginErrors.ConsentRequired();

            var items = current.Items ?? [];
            var existing = items.FirstOrDefault(item => string.Equals(item.ID, id, StringComparison.Ordinal));
            if (existing is null)
                return PluginErrors.NotFound(id);

            updated = existing with { Name = manifest.Name, Version = manifest.Version, Description = manifest.Description, Author = manifest.Author, UpdatedAt = now };
            return document with { Plugins = current with { Items = [.. items.Select(item => string.Equals(item.ID, id, StringComparison.Ordinal) ? updated : item)] } };
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        return pluginQueries.DescribeItem(updated!);
    }

    public async Task<Result<PluginItemDto, ApiErrorDto>> SetEnabled(string id, bool enabled, CancellationToken cancellationToken)
    {
        VaultPluginItemRecord? target = null;

        var saved = await vaultService.SaveOrRefuse(document =>
        {
            var current = document.Plugins;
            if (enabled && current?.ConsentedAt is null)
                return PluginErrors.ConsentRequired();

            var items = current?.Items ?? [];
            var existing = items.FirstOrDefault(item => string.Equals(item.ID, id, StringComparison.Ordinal));
            if (existing is null)
                return PluginErrors.NotFound(id);

            target = existing with { Enabled = enabled };
            if (existing.Enabled == enabled)
                return document;

            return document with { Plugins = (current ?? new VaultPluginsRecord()) with { Items = [.. items.Select(item => string.Equals(item.ID, id, StringComparison.Ordinal) ? target : item)] } };
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        return pluginQueries.DescribeItem(target!);
    }

    public async Task<Result<VaultPluginItemRecord, ApiErrorDto>> Remove(string id, CancellationToken cancellationToken)
    {
        VaultPluginItemRecord? removed = null;

        var saved = await vaultService.SaveOrRefuse(document =>
        {
            var current = document.Plugins;
            var items = current?.Items ?? [];
            var existing = items.FirstOrDefault(item => string.Equals(item.ID, id, StringComparison.Ordinal));
            if (existing is null)
                return PluginErrors.NotFound(id);

            removed = existing;
            return document with { Plugins = current! with { Items = [.. items.Where(item => !string.Equals(item.ID, id, StringComparison.Ordinal))] } };
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        return removed!;
    }
}
