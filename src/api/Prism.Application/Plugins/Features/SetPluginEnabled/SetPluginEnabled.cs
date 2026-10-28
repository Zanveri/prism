using CSharpFunctionalExtensions;
using Prism.Application.Plugins.Models.Dtos;
using Prism.Application.Plugins.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using System.Text.Json.Serialization;

namespace Prism.Application.Plugins.Features.SetPluginEnabled;

public sealed record SetPluginEnabledCommand : IRequest<Result<PluginItemDto, ApiErrorDto>>
{
    [JsonIgnore]
    public string ID { get; init; } = string.Empty;

    public bool Enabled { get; init; }

    public override string ToString() => nameof(SetPluginEnabledCommand);
}

internal sealed class SetPluginEnabledHandler(IPluginRepository pluginRepository) : IRequestHandler<SetPluginEnabledCommand, Result<PluginItemDto, ApiErrorDto>>
{
    public Task<Result<PluginItemDto, ApiErrorDto>> Handle(SetPluginEnabledCommand request, CancellationToken cancellationToken)
        => pluginRepository.SetEnabled(request.ID, request.Enabled, cancellationToken);
}
