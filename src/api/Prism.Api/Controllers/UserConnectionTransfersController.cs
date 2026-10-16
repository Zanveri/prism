using Microsoft.AspNetCore.Mvc;
using Prism.Application.ConnectionTransfers.Features.ExportConnections;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// Exportar e importar conexões com as pastas (seção 34 da especificação: RN-TRANSF-001 a 016), num arquivo sempre cifrado com uma senha de exportação.
/// Quem monta e quem lê o arquivo é a API: a tela nunca recebe uma senha de banco (RN-CONN-001), só o arquivo cifrado, que ela entrega ao diálogo de salvar
/// do sistema, e a prévia, que diz só se cada conexão tem senha. As rotas são de `api/user/connections` (literais, não colidem com `{id:guid}`), e a barreira
/// do `VaultGateMiddleware` as cobre. O corpo tem teto (`RequestSizeLimit`): 1 MiB na exportação, que leva só IDs e senhas, e 6 MiB na importação, que leva
/// o arquivo de até 5 MiB num texto JSON. Acima do teto a resposta hoje é 500, e não 413 (o defeito conhecido de toda rota que lê corpo).
/// </summary>
[ApiController]
[Route("api/user/connections")]
public sealed class UserConnectionTransfersController(IMediator mediator) : ControllerBase
{
    /// <summary>
    /// RN-TRANSF-005 a 008: `{ folderIDs, connections: [{ id, credentials }], passphrase, userPassword? }` responde 200 `{ content, folders, connections,
    /// withUser, withPassword }`, o texto do arquivo já cifrado e as contagens. Recusas: 404 `FOLDER_NOT_FOUND` e `CONNECTION_NOT_FOUND` (o que foi marcado
    /// não existe mais); 422 `EXPORT_EMPTY`, `EXPORT_INVALID`, `EXPORT_PASSPHRASE_INVALID` (no campo `passphrase`), `EXPORT_LIMITS_EXCEEDED`,
    /// `USER_PASSWORD_REQUIRED` e `INVALID_PASSWORD` (no campo `userPassword`); 401 `VAULT_LOCKED` no quinto erro seguido de senha e quando o cofre muda durante a derivação.
    /// </summary>
    [HttpPost("export")]
    [RequestSizeLimit(TransferLimits.ExportRequestBytes)]
    public async Task<IActionResult> ExportConnections([FromBody] ExportConnectionsCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }
}
