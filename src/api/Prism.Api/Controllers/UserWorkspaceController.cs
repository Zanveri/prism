using Microsoft.AspNetCore.Mvc;
using Prism.Application.Workspaces.Features.GetWorkspace;
using Prism.Application.Workspaces.Features.SaveWorkspace;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// As abas que voltam na próxima entrada (seção 24 da especificação, RN-ABAS-006), cifradas no cofre do usuário (`api/user/...`: só respondem com o cofre aberto,
/// e a barreira do `VaultGateMiddleware` fecha o prefixo inteiro). Uma área de trabalho por usuário: o `PUT` troca a gravada inteira.
/// </summary>
[ApiController]
[Route("api/user/workspace")]
public sealed class UserWorkspaceController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetWorkspace(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetWorkspaceCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>O corpo é `{ tabs, activeIndex }`, a lista inteira das abas de todas as janelas, na ordem; 204 sem corpo.</summary>
    [HttpPut]
    public async Task<IActionResult> SaveWorkspace([FromBody] SaveWorkspaceCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }
}
