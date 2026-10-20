using Microsoft.AspNetCore.Mvc;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.DbeaverImports.Features.GetDbeaverState;
using Prism.Application.DbeaverImports.Features.ImportFromDbeaver;
using Prism.Application.DbeaverImports.Features.InviteToDbeaver;
using Prism.Application.DbeaverImports.Features.PreviewDbeaverImport;
using Prism.Application.DbeaverImports.Features.ScanDbeaver;
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

    /// <summary>
    /// RN-DBEAVER-007: `{ sourceId }` responde 200 `{ where, projects: [{ name, connections, importable, withPassword, protected, nameInvalid, credentialsUnreadable,
    /// credentialsProtected }] }`, a contagem de cada projeto da cópia, sem conferir os limites. Recusas: 404 `DBEAVER_SOURCE_MISSING`; 422 `DBEAVER_SOURCE_INVALID` e
    /// `IMPORT_INVALID` (no campo `sourceId`).
    /// </summary>
    [HttpPost("scan")]
    [RequestSizeLimit(TransferLimits.DbeaverRequestBytes)]
    public async Task<IActionResult> ScanDbeaver([FromBody] ScanDbeaverCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>
    /// RN-DBEAVER-015: `{ sourceId, project?, targetFolderID?, withPasswords?, drdaPorts? }` responde 200 `{ folders, connections, notes }`, a árvore da cópia com o que a
    /// importação faria no lugar escolhido, sem gravar nada. Recusas: 404 `DBEAVER_SOURCE_MISSING`, `DBEAVER_PROJECT_NOT_FOUND` e `FOLDER_NOT_FOUND`; 422
    /// `DBEAVER_SOURCE_INVALID`, `DBEAVER_LIMITS_EXCEEDED` e `IMPORT_INVALID` (nos campos `sourceId`, `withPasswords` e `drdaPorts`).
    /// </summary>
    [HttpPost("import/preview")]
    [RequestSizeLimit(TransferLimits.DbeaverRequestBytes)]
    public async Task<IActionResult> PreviewDbeaverImport([FromBody] PreviewDbeaverImportCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>
    /// RN-DBEAVER-016 e 017: `{ sourceId, project?, targetFolderID?, withPasswords?, drdaPorts?, items, onConflict?, overwrite? }` responde 200 `{ folderIDs, connectionIDs,
    /// updatedIDs, mergedFolders, renamed, skipped }`, numa gravação só do cofre. Recusas: as da prévia, mais 422 `IMPORT_EMPTY` e `IMPORT_INVALID` (nos campos `items`,
    /// `onConflict` e `overwrite`); 401 `VAULT_LOCKED` quando o cofre muda antes da gravação. A cópia é apagada na importação que termina com sucesso e deixada na recusa.
    /// </summary>
    [HttpPost("import")]
    [RequestSizeLimit(TransferLimits.DbeaverRequestBytes)]
    public async Task<IActionResult> ImportFromDbeaver([FromBody] ImportFromDbeaverCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
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
