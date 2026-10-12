using Microsoft.AspNetCore.Mvc;
using Prism.Application.Folders.Features.CreateFolder;
using Prism.Application.Folders.Features.DeleteFolder;
using Prism.Application.Folders.Features.GetFolders;
using Prism.Application.Folders.Features.UpdateFolder;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// As pastas do usuário (`api/user/...`: só respondem com o cofre aberto). A barreira do
/// `VaultGateMiddleware` fecha o prefixo inteiro, então o controller não confere o cofre; os handlers
/// também recusam com `VAULT_LOCKED` se ele fechar no meio da operação. Sem `[Authorize]` de propósito:
/// não há autenticação do ASP.NET (decisão 1 da seção 8 da especificação).
/// </summary>
[ApiController]
[Route("api/user/folders")]
public sealed class UserFoldersController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetFolders(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetFoldersCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>Não há rota para uma pasta só: o `Location` aponta para a lista, onde ela passa a aparecer.</summary>
    [HttpPost]
    public async Task<IActionResult> CreateFolder([FromBody] CreateFolderCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Created("/api/user/folders", result.Value);
    }

    /// <summary>Renomear e mover são a mesma rota: o corpo leva `id`, `name` e `parentID` (nulo é a raiz).</summary>
    [HttpPatch]
    public async Task<IActionResult> UpdateFolder([FromBody] UpdateFolderCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteFolder(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new DeleteFolderCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }
}
