using Microsoft.AspNetCore.Mvc;
using Prism.Application.Transfers.Features.DeleteTransfer;
using Prism.Application.Transfers.Features.GetTransfer;
using Prism.Application.Transfers.Features.GetTransfers;
using Prism.Application.Transfers.Features.PreviewImport;
using Prism.Application.Transfers.Features.ReadImportFile;
using Prism.Application.Transfers.Features.StartExport;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// As transferências em segundo plano (seção 35, RN-EXPORT-016): começar uma exportação de dados, acompanhar e cancelar ou esquecer cada trabalho; e as
/// prévias da importação de dados (seção 36, RN-IMPORT-007 a 011), que leem o arquivo que o processo principal copiou pelo identificador dele. Como toda
/// rota `api/user/...`, só responde com o token e o cofre aberto. O `id` da rota e o `fileID` do corpo são só chaves: nunca viram caminho de arquivo.
/// </summary>
[ApiController]
[Route("api/user/transfers")]
public sealed class UserTransfersController(IMediator mediator) : ControllerBase
{
    /// <summary>RN-EXPORT-015 e as notas da seção 6: o corpo vai até 8 MiB, por causa do comando (1 MB) e dos nomes das colunas. As rotas da importação (seção 36) têm o mesmo teto.</summary>
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

    /// <summary>RN-IMPORT-007: a prévia do arquivo, com o que a leitura achou. As notas da seção 36: o corpo vai até 8 MiB, como o da exportação.</summary>
    [HttpPost("imports/read")]
    [RequestSizeLimit(MaxExportRequestBytes)]
    public async Task<IActionResult> ReadImportFile([FromBody] ReadImportFileCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>RN-IMPORT-009 a 011: a tabela, o mapeamento e a prévia convertida, com o catálogo lido numa conexão à parte.</summary>
    [HttpPost("imports/preview")]
    [RequestSizeLimit(MaxExportRequestBytes)]
    public async Task<IActionResult> PreviewImport([FromBody] PreviewImportCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
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
