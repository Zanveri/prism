using Microsoft.AspNetCore.Mvc;
using Prism.Application.Users.Features.ChangePassword;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// A senha do usuário (`api/user/...`: só responde com o cofre aberto). A barreira do `VaultGateMiddleware` fecha o prefixo inteiro, então o
/// controller não confere o cofre; o serviço também recusa com `VAULT_LOCKED` se ele fechar no meio da operação. Sem `[Authorize]` de propósito:
/// não há autenticação do ASP.NET (decisão 1 da seção 8 da especificação). O corpo tem um teto de 16 KiB: leva duas senhas de até 128 caracteres, e uma
/// requisição que o passa é recusada antes de qualquer derivação (cada derivação custa 64 MiB de memória e algumas centenas de milissegundos).
/// </summary>
[ApiController]
[Route("api/user/password")]
[RequestSizeLimit(16 * 1024)]
public sealed class UserPasswordController(IMediator mediator) : ControllerBase
{
    /// <summary>
    /// RN-COFRE-013: `{ currentPassword, newPassword }`, 204 sem corpo. A senha atual errada é 422 `INVALID_PASSWORD` no campo `currentPassword`, o mesmo
    /// código da revelação de senha (e não 401, que a tela renovaria e repetiria), e conta como uma das cinco tentativas dela: o quinto erro seguido fecha o
    /// cofre e responde 401 `VAULT_LOCKED`. A senha nova inválida é 422 `PASSWORD_INVALID` no campo `newPassword`, como na criação de conta; igual à atual,
    /// 422 `PASSWORD_UNCHANGED`. A troca recifra o cofre com uma chave nova (RN-COFRE-003).
    /// </summary>
    [HttpPut]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }
}
