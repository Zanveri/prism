using CSharpFunctionalExtensions;
using Prism.Application.Plugins.Models;
using Prism.Application.Plugins.Models.Dtos;
using Prism.Application.Plugins.Queries;
using Prism.Application.Plugins.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Plugins.Clients;
using Prism.Infrastructure.Plugins.Models;

namespace Prism.Application.Plugins.Features.UpdatePlugin;

public sealed record UpdatePluginCommand(string ID) : IRequest<Result<PluginItemDto, ApiErrorDto>>
{
    public override string ToString() => nameof(UpdatePluginCommand);
}

internal sealed class UpdatePluginHandler(IPluginQueries pluginQueries, IPluginRepository pluginRepository, IPluginSourceClient pluginSourceClient, TimeProvider timeProvider) : IRequestHandler<UpdatePluginCommand, Result<PluginItemDto, ApiErrorDto>>
{
    public async Task<Result<PluginItemDto, ApiErrorDto>> Handle(UpdatePluginCommand request, CancellationToken cancellationToken)
    {
        var snapshot = pluginQueries.ReadSnapshot();
        if (snapshot.IsFailure)
            return snapshot.Error;

        var (generation, current) = snapshot.Value;
        if (current.ConsentedAt is null)
            return PluginErrors.ConsentRequired();

        var existing = (current.Items ?? []).FirstOrDefault(item => string.Equals(item.ID, request.ID, StringComparison.Ordinal));
        if (existing is null)
            return PluginErrors.NotFound(request.ID);

        Result<PluginManifest, PluginFailure> updatedManifest;
        if (string.Equals(existing.SourceKind, "local", StringComparison.Ordinal))
            updatedManifest = pluginSourceClient.InspectLocal(existing.Source);
        else
            updatedManifest = await pluginSourceClient.PullGitAsync(existing.ID, cancellationToken);

        if (updatedManifest.IsFailure)
            return PluginErrors.From(updatedManifest.Error);

        return await pluginRepository.UpdateManifest(existing.ID, updatedManifest.Value, generation, timeProvider.GetUtcNow(), cancellationToken);
    }
}
