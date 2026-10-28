using CSharpFunctionalExtensions;
using Prism.Application.Plugins.Models;
using Prism.Application.Plugins.Models.Dtos;
using Prism.Application.Plugins.Queries;
using Prism.Application.Plugins.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Plugins.Clients;
using Prism.Infrastructure.Plugins.Models;

namespace Prism.Application.Plugins.Features.InstallPlugin;

public sealed record InstallPluginCommand : IRequest<Result<PluginItemDto, ApiErrorDto>>
{
    public string SourceKind { get; init; } = string.Empty;
    public string Source { get; init; } = string.Empty;

    /// <summary>RN-LOG-001: impede que caminhos locais ou URLs privadas sejam impressos no log.</summary>
    public override string ToString() => nameof(InstallPluginCommand);
}

internal sealed class InstallPluginHandler(IPluginQueries pluginQueries, IPluginRepository pluginRepository, IPluginSourceClient pluginSourceClient, TimeProvider timeProvider) : IRequestHandler<InstallPluginCommand, Result<PluginItemDto, ApiErrorDto>>
{
    public async Task<Result<PluginItemDto, ApiErrorDto>> Handle(InstallPluginCommand request, CancellationToken cancellationToken)
    {
        var snapshot = pluginQueries.ReadSnapshot();
        if (snapshot.IsFailure)
            return snapshot.Error;

        var (generation, current) = snapshot.Value;
        if (current.ConsentedAt is null)
            return PluginErrors.ConsentRequired();

        var sourceKind = request.SourceKind.Trim().ToLowerInvariant();
        var source = request.Source.Trim();
        var existingIds = (current.Items ?? []).Select(item => item.ID).ToHashSet(StringComparer.Ordinal);

        Result<PluginManifest, PluginFailure> inspected;
        if (sourceKind == "local")
        {
            inspected = pluginSourceClient.InspectLocal(source);
            if (inspected.IsSuccess && existingIds.Contains(inspected.Value.ID))
                return PluginErrors.AlreadyInstalled(inspected.Value.ID);

            source = Path.GetFullPath(source);
        }
        else
        {
            inspected = await pluginSourceClient.CloneFromGitAsync(source, existingIds.Contains, cancellationToken);
        }

        if (inspected.IsFailure)
            return PluginErrors.From(inspected.Error);

        var inserted = await pluginRepository.Insert(inspected.Value, sourceKind, source, generation, timeProvider.GetUtcNow(), cancellationToken);
        if (inserted.IsFailure && sourceKind == "git")
            pluginSourceClient.DeleteInstalledDirectory(inspected.Value.ID);

        return inserted;
    }
}
