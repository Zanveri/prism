using Microsoft.AspNetCore.Mvc;
using Prism.Application.ScriptFolders.Features.CreateScriptFolder;
using Prism.Application.ScriptFolders.Features.DeleteScriptFolder;
using Prism.Application.ScriptFolders.Features.GetScriptFolders;
using Prism.Application.ScriptFolders.Features.UpdateScriptFolder;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// As pastas de scripts do usuário (seção 33 da especificação, RN-SCRIPT-007 a 009), no cofre dele (`api/user/...`: só respondem com o cofre aberto, e a
/// barreira do `VaultGateMiddleware` fecha o prefixo inteiro). São da seção Scripts, e não as pastas de conexões de `api/user/folders`.
/// </summary>
[ApiController]
[Route("api/user/script-folders")]
public sealed class UserScriptFoldersController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetScriptFolders(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetScriptFoldersCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>Não há rota para uma pasta só: o `Location` aponta para a lista, onde ela passa a aparecer, como nas pastas de conexões.</summary>
    [HttpPost]
    public async Task<IActionResult> CreateScriptFolder([FromBody] CreateScriptFolderCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Created("/api/user/script-folders", result.Value);
    }

    /// <summary>Renomear e mover são a mesma rota: o corpo leva a pasta por inteiro, `id`, `name` e `parentID` (ausente ou nulo é a raiz).</summary>
    [HttpPatch]
    public async Task<IActionResult> UpdateScriptFolder([FromBody] UpdateScriptFolderCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteScriptFolder(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new DeleteScriptFolderCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }
}
