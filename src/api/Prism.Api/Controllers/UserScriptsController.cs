using Microsoft.AspNetCore.Mvc;
using Prism.Application.Scripts.Features.CreateScript;
using Prism.Application.Scripts.Features.DeleteScript;
using Prism.Application.Scripts.Features.GetScript;
using Prism.Application.Scripts.Features.GetScripts;
using Prism.Application.Scripts.Features.UpdateScript;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// Os scripts salvos do usuário (seção 23 da especificação, RN-SCRIPT-001 a 004), cifrados no cofre dele (`api/user/...`: só respondem com o cofre aberto, e a
/// barreira do `VaultGateMiddleware` fecha o prefixo inteiro). Só a rota do item devolve o SQL; a lista e as respostas de criar e de alterar vêm sem ele.
/// </summary>
[ApiController]
[Route("api/user/scripts")]
public sealed class UserScriptsController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetScripts(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetScriptsCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetScript(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetScriptCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpPost]
    public async Task<IActionResult> CreateScript([FromBody] CreateScriptCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Created($"/api/user/scripts/{result.Value.ID}", result.Value);
    }

    /// <summary>
    /// O corpo leva `id` e só o que muda: `name`, `sql`, o lugar (`connectionID` com `database`), o ícone e a cor (`icon` e `color`, RN-SCRIPT-006); o ausente
    /// fica como está. `generic: true` tira o lugar (RN-SCRIPT-005).
    /// </summary>
    [HttpPatch]
    public async Task<IActionResult> UpdateScript([FromBody] UpdateScriptCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteScript(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new DeleteScriptCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }
}
