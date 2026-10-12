using CSharpFunctionalExtensions;
using Prism.Application.Drivers.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Drivers.Services;

namespace Prism.Application.Drivers.Features.CancelDriverInstall;

/// <summary>RN-DRIVER-004: o download pode ser cancelado. Quando a resposta sai, a instalação já parou e o driver voltou a `available`.</summary>
public sealed record CancelDriverInstallCommand(string ID) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class CancelDriverInstallHandler(IDriverService driverService) : IRequestHandler<CancelDriverInstallCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(CancelDriverInstallCommand request, CancellationToken cancellationToken)
        => (await driverService.CancelInstallAsync(request.ID)).MapError(DriverErrors.From);
}
