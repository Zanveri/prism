using Microsoft.AspNetCore.Mvc;
using Prism.Application.Plugins.Features.GetPluginBundles;
using Prism.Application.Plugins.Features.GetPlugins;
using Prism.Application.Plugins.Features.InstallPlugin;
using Prism.Application.Plugins.Features.RemovePlugin;
using Prism.Application.Plugins.Features.SetPluginConsent;
using Prism.Application.Plugins.Features.SetPluginEnabled;
using Prism.Application.Plugins.Features.UpdatePlugin;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// Os plugins de terceiros do usuário (`api/user/plugins`: só respondem com o cofre aberto). O estado do consentimento explícito (modo restrito) e a lista
/// de plugins instalados ou vinculados ficam no cofre; os pacotes baixados via Git ficam em `&lt;PRISM_DATA_DIR&gt;/plugins`. Sem `[Authorize]` de propósito:
/// quem autentica é o `LaunchTokenMiddleware` e quem exige o cofre aberto é o `VaultGateMiddleware`.
/// </summary>
[ApiController]
[Route("api/user/plugins")]
public sealed class UserPluginsController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetPlugins(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetPluginsCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpGet("bundles")]
    public async Task<IActionResult> GetPluginBundles(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetPluginBundlesCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpPut("consent")]
    public async Task<IActionResult> SetPluginConsent([FromBody] SetPluginConsentCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpPost("install")]
    public async Task<IActionResult> InstallPlugin([FromBody] InstallPluginCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Created($"/api/user/plugins/{result.Value.ID}", result.Value);
    }

    [HttpPost("{id}/update")]
    public async Task<IActionResult> UpdatePlugin(string id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new UpdatePluginCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpPut("{id}/enabled")]
    public async Task<IActionResult> SetPluginEnabled(string id, [FromBody] SetPluginEnabledCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command with { ID = id }, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> RemovePlugin(string id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new RemovePluginCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }
}
