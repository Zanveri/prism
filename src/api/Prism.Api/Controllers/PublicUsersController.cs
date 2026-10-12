using Microsoft.AspNetCore.Mvc;
using Prism.Application.Users.Features.CreateUser;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// Criação de usuário (`api/public/...`: servem antes de haver cofre aberto). Sem `[AllowAnonymous]` de
/// propósito: a API não tem autenticação do ASP.NET, nem política de fallback a contornar; quem guarda
/// a porta é o `LaunchTokenMiddleware`, que exige o token de lançamento em toda requisição
/// (decisão 1 da seção 8 da especificação).
/// </summary>
[ApiController]
[Route("api/public/users")]
public sealed class PublicUsersController(IMediator mediator) : ControllerBase
{
    /// <summary>Cria o usuário e já abre o cofre dele: o que nasce é uma sessão, então o `Location` aponta para ela.</summary>
    [HttpPost]
    public async Task<IActionResult> CreateUser([FromBody] CreateUserCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Created("/api/public/sessions", result.Value);
    }
}
