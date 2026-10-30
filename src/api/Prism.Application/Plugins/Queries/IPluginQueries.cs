using CSharpFunctionalExtensions;
using Prism.Application.Plugins.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Plugins.Queries;

internal interface IPluginQueries
{
    Result<PluginsStateDto, ApiErrorDto> GetState();

    Result<IReadOnlyList<PluginBundleDto>, ApiErrorDto> GetActiveBundles();

    Result<(long Generation, VaultPluginsRecord Plugins), ApiErrorDto> ReadSnapshot();

    PluginItemDto DescribeItem(VaultPluginItemRecord item);
}
