using Microsoft.AspNetCore.Mvc;
using Prism.Application.DbeaverImports.Features.GetDbeaverState;
using Prism.Application.DbeaverImports.Features.InviteToDbeaver;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// Importar do DBeaver (seção 40 da especificação: RN-DBEAVER-001 a 018). O processo principal copia os arquivos do DBeaver para a pasta `transfers` e a tela só
/// recebe o `sourceId` da cópia; quem lê e decifra é a API, e a tela nunca recebe um caminho nem uma senha (RN-CONN-001). As rotas são de `api/user/connections/dbeaver`
/// (literais, não colidem com `{id:guid}`), e a barreira do `VaultGateMiddleware` as cobre.
/// </summary>
[ApiController]
[Route("api/user/connections/dbeaver")]
public sealed class UserDbeaverImportsController(IMediator mediator) : ControllerBase
{
    /// <summary>RN-DBEAVER-018: 200 `{ invitedAt, lastImportAt }`, as duas em UTC e nulas até acontecerem.</summary>
    [HttpGet]
    public async Task<IActionResult> GetDbeaverState(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetDbeaverStateCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>RN-DBEAVER-018: o convite como feito, com a hora da API. 204 sem corpo; o que já tem data fica com ela.</summary>
    [HttpPut("invite")]
    public async Task<IActionResult> InviteToDbeaver(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new InviteToDbeaverCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }
}
