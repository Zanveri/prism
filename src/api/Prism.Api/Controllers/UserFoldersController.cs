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

    /// <summary>
    /// Renomear, mover e editar são a mesma rota: o corpo leva a pasta por inteiro, `id`, `name`, `parentID` (nulo é a raiz), o ambiente
    /// (`environmentName` e `environmentColor`, RN-PASTA-005), a cor (`color`, RN-PASTA-007) e as proteções (`confirmCommands` e `readOnly`,
    /// RN-PROT-001 e 002), mais `userPassword`, a senha do usuário que a mudança do somente leitura pede (RN-PROT-003: 422 `USER_PASSWORD_REQUIRED` ou
    /// `INVALID_PASSWORD`, e 401 `VAULT_LOCKED` no quinto erro seguido).
    /// </summary>
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
