using CSharpFunctionalExtensions;
using Prism.Application.Plugins.Models.Dtos;
using Prism.Application.Plugins.Queries;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;

namespace Prism.Application.Plugins.Features.GetPluginBundles;

public sealed record GetPluginBundlesCommand : IRequest<Result<IReadOnlyList<PluginBundleDto>, ApiErrorDto>>;

internal sealed class GetPluginBundlesHandler(IPluginQueries pluginQueries) : IRequestHandler<GetPluginBundlesCommand, Result<IReadOnlyList<PluginBundleDto>, ApiErrorDto>>
{
    public Task<Result<IReadOnlyList<PluginBundleDto>, ApiErrorDto>> Handle(GetPluginBundlesCommand request, CancellationToken cancellationToken)
        => Task.FromResult(pluginQueries.GetActiveBundles());
}
