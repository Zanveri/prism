using Microsoft.AspNetCore.Mvc;
using Prism.Application.Transfers.Features.DeleteTransfer;
using Prism.Application.Transfers.Features.GetTransfer;
using Prism.Application.Transfers.Features.GetTransfers;
using Prism.Application.Transfers.Features.StartExport;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// As transferências em segundo plano (seção 35, RN-EXPORT-016): começar uma exportação de dados, acompanhar e cancelar ou esquecer cada trabalho. Como
/// toda rota `api/user/...`, só responde com o token e o cofre aberto. O `id` da rota é só uma chave de busca no registro: nunca vira caminho de arquivo.
/// </summary>
[ApiController]
[Route("api/user/transfers")]
public sealed class UserTransfersController(IMediator mediator) : ControllerBase
{
    /// <summary>RN-EXPORT-015 e as notas da seção 6: o corpo vai até 8 MiB, por causa do comando (1 MB) e dos nomes das colunas.</summary>
    private const long MaxExportRequestBytes = 8L * 1024 * 1024;

    /// <summary>202 com o `id` do trabalho, antes de falar com o banco: conectar, contar e ler acontecem nele.</summary>
    [HttpPost("exports")]
    [RequestSizeLimit(MaxExportRequestBytes)]
    public async Task<IActionResult> StartExport([FromBody] StartExportCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Accepted(result.Value);
    }

    [HttpGet]
    public async Task<IActionResult> GetTransfers(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetTransfersCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetTransfer(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetTransferCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteTransfer(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new DeleteTransferCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }
}
