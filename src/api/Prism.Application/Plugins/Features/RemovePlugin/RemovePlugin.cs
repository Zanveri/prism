using CSharpFunctionalExtensions;
using Prism.Application.Plugins.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Plugins.Clients;

namespace Prism.Application.Plugins.Features.RemovePlugin;

public sealed record RemovePluginCommand(string ID) : IRequest<UnitResult<ApiErrorDto>>
{
    public override string ToString() => nameof(RemovePluginCommand);
}

internal sealed class RemovePluginHandler(IPluginRepository pluginRepository, IPluginSourceClient pluginSourceClient) : IRequestHandler<RemovePluginCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(RemovePluginCommand request, CancellationToken cancellationToken)
    {
        var removed = await pluginRepository.Remove(request.ID, cancellationToken);
        if (removed.IsFailure)
            return UnitResult.Failure(removed.Error);

        if (string.Equals(removed.Value.SourceKind, "git", StringComparison.Ordinal))
            pluginSourceClient.DeleteInstalledDirectory(removed.Value.ID);

        return UnitResult.Success<ApiErrorDto>();
    }
}
