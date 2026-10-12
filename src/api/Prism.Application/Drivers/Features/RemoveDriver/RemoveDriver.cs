using CSharpFunctionalExtensions;
using Prism.Application.Drivers.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Drivers.Models;
using Prism.Infrastructure.Drivers.Services;

namespace Prism.Application.Drivers.Features.RemoveDriver;

/// <summary>RN-DRIVER-007: a remoção vale no próximo reinício da API; até lá o driver aparece `available` com `restartRequired`.</summary>
public sealed record RemoveDriverCommand(string ID) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class RemoveDriverHandler(IDriverService driverService, IDatabaseSessionService databaseSessionService) : IRequestHandler<RemoveDriverCommand, UnitResult<ApiErrorDto>>
{
    public Task<UnitResult<ApiErrorDto>> Handle(RemoveDriverCommand request, CancellationToken cancellationToken)
    {
        // RN-DRIVER-007: com sessão aberta de um banco que o driver atende, a remoção é recusada. Só o driver instalado chega a esta
        // conferência: o que não existe e o que não está instalado (o embutido também) recebem do gerenciador a recusa deles, e uma
        // sessão do PostgreSQL não faz o driver embutido parecer "em uso". Uma sessão aberta logo depois desta conferência não estraga
        // nada: a remoção só acontece no reinício, que fecha todas.
        if (driverService.Find(request.ID) is { State: EDriverState.Installed } driver && databaseSessionService.HasOpenSession(driver.Engines))
            return Task.FromResult(UnitResult.Failure(DriverErrors.InUse()));

        return Task.FromResult(driverService.Remove(request.ID).MapError(DriverErrors.From));
    }
}
