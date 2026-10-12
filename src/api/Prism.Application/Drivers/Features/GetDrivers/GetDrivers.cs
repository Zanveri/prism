using CSharpFunctionalExtensions;
using Prism.Application.Drivers.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Drivers.Services;

namespace Prism.Application.Drivers.Features.GetDrivers;

/// <summary>RN-DRIVER-002: o catálogo inteiro, na ordem dele, com o estado de cada driver nesta máquina. A tela a consulta a cada segundo enquanto algum driver baixa.</summary>
public sealed record GetDriversCommand : IRequest<Result<IReadOnlyList<DriverDto>, ApiErrorDto>>;

internal sealed class GetDriversHandler(IDriverService driverService) : IRequestHandler<GetDriversCommand, Result<IReadOnlyList<DriverDto>, ApiErrorDto>>
{
    public Task<Result<IReadOnlyList<DriverDto>, ApiErrorDto>> Handle(GetDriversCommand request, CancellationToken cancellationToken)
        => Task.FromResult(Result.Success<IReadOnlyList<DriverDto>, ApiErrorDto>([.. driverService.List().Select(DriverMappings.ToDto)]));
}
