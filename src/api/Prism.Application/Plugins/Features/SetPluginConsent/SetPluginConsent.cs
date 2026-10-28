using CSharpFunctionalExtensions;
using Prism.Application.Plugins.Models.Dtos;
using Prism.Application.Plugins.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;

namespace Prism.Application.Plugins.Features.SetPluginConsent;

public sealed record SetPluginConsentCommand(bool Consented) : IRequest<Result<PluginsStateDto, ApiErrorDto>>;

internal sealed class SetPluginConsentHandler(IPluginRepository pluginRepository, TimeProvider timeProvider) : IRequestHandler<SetPluginConsentCommand, Result<PluginsStateDto, ApiErrorDto>>
{
    public Task<Result<PluginsStateDto, ApiErrorDto>> Handle(SetPluginConsentCommand request, CancellationToken cancellationToken)
        => pluginRepository.SetConsent(request.Consented, timeProvider.GetUtcNow(), cancellationToken);
}
