using CSharpFunctionalExtensions;
using Prism.Application.Plugins.Models.Dtos;
using Prism.Application.Plugins.Queries;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;

namespace Prism.Application.Plugins.Features.GetPlugins;

public sealed record GetPluginsCommand : IRequest<Result<PluginsStateDto, ApiErrorDto>>;

internal sealed class GetPluginsHandler(IPluginQueries pluginQueries) : IRequestHandler<GetPluginsCommand, Result<PluginsStateDto, ApiErrorDto>>
{
    public Task<Result<PluginsStateDto, ApiErrorDto>> Handle(GetPluginsCommand request, CancellationToken cancellationToken)
        => Task.FromResult(pluginQueries.GetState());
}
