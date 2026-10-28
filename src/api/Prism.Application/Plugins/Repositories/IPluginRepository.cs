using CSharpFunctionalExtensions;
using Prism.Application.Plugins.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Plugins.Models;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Plugins.Repositories;

internal interface IPluginRepository
{
    Task<Result<PluginsStateDto, ApiErrorDto>> SetConsent(bool accepted, DateTimeOffset now, CancellationToken cancellationToken);

    Task<Result<PluginItemDto, ApiErrorDto>> Insert(PluginManifest manifest, string sourceKind, string source, long generation, DateTimeOffset now, CancellationToken cancellationToken);

    Task<Result<PluginItemDto, ApiErrorDto>> UpdateManifest(string id, PluginManifest manifest, long generation, DateTimeOffset now, CancellationToken cancellationToken);

    Task<Result<PluginItemDto, ApiErrorDto>> SetEnabled(string id, bool enabled, CancellationToken cancellationToken);

    Task<Result<VaultPluginItemRecord, ApiErrorDto>> Remove(string id, CancellationToken cancellationToken);
}
