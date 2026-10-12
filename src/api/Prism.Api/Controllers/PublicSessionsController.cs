using Microsoft.AspNetCore.Mvc;
using Prism.Application.Sessions.Features.GetSession;
using Prism.Application.Sessions.Features.SignIn;
using Prism.Application.Sessions.Features.SignOut;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// Consulta, entrada e saída do cofre (`api/public/...`: servem com o cofre fechado). Sem
/// `[AllowAnonymous]` de propósito: a API não tem autenticação do ASP.NET, nem política de fallback a
/// contornar; quem guarda a porta é o `LaunchTokenMiddleware`, que exige o token de lançamento em toda
/// requisição (decisão 1 da seção 8 da especificação).
/// </summary>
[ApiController]
[Route("api/public/sessions")]
public sealed class PublicSessionsController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetSession(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetSessionCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpPost]
    public async Task<IActionResult> SignIn([FromBody] SignInCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>204 com o cofre aberto ou fechado: o `SignOutCommand` não tem como falhar.</summary>
    [HttpDelete]
    public async Task<IActionResult> EndSession(CancellationToken cancellationToken)
    {
        await mediator.Send(new SignOutCommand(), cancellationToken);

        return NoContent();
    }
}
