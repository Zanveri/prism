using Microsoft.AspNetCore.Mvc;
using Prism.Application.Drivers.Features.CancelDriverInstall;
using Prism.Application.Drivers.Features.GetDrivers;
using Prism.Application.Drivers.Features.InstallDriver;
using Prism.Application.Drivers.Features.RemoveDriver;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// Os drivers sob demanda (seção 16 da especificação). Como toda rota `api/user/...`, só responde com o token e o cofre aberto (a
/// barreira do `VaultGateMiddleware` fecha o prefixo), embora os drivers sejam da máquina e não do cofre (RN-DRIVER-009). O `id` da
/// rota é só uma chave de busca no catálogo: nunca vira caminho de arquivo nem pedaço de endereço.
/// </summary>
[ApiController]
[Route("api/user/drivers")]
public sealed class UserDriversController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetDrivers(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetDriversCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>
    /// 202 sem corpo: o download segue na API, e a lista já mostra o driver como `installing`. O corpo é opcional para que a falta dele
    /// seja a recusa da regra (422 `DRIVER_LICENSE_NOT_ACCEPTED`), e não um 400 do MVC em outro formato.
    /// </summary>
    [HttpPost("{id}/install")]
    public async Task<IActionResult> InstallDriver(string id, [FromBody] InstallDriverCommand? command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send((command ?? new InstallDriverCommand()) with { ID = id }, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Accepted();
    }

    [HttpDelete("{id}/install")]
    public async Task<IActionResult> CancelDriverInstall(string id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new CancelDriverInstallCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> RemoveDriver(string id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new RemoveDriverCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }
}
