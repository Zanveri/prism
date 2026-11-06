using Microsoft.AspNetCore.Mvc;
using Prism.Application.Journal.Features.GetAuditEntries;
using Prism.Application.Journal.Features.GetAuditEntry;
using Prism.Application.Journal.Features.GetAuditFacets;
using Prism.Application.Journal.Features.GetHistory;
using Prism.Application.Journal.Features.GetJournalSettings;
using Prism.Application.Journal.Features.HideConnectionHistory;
using Prism.Application.Journal.Features.HideHistoryEntry;
using Prism.Application.Journal.Features.PurgeAudit;
using Prism.Application.Journal.Features.UpdateJournalSettings;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// RN-HIST-002 a 007, RN-AUDIT-010 a 016 e RN-DIARIO-005 e 008: o Histórico de comandos do editor e a Auditoria do usuário
/// (`api/user/journal`). Protegido pelo `VaultGateMiddleware` (401 `VAULT_LOCKED` com o cofre fechado) e responde 503
/// `JOURNAL_UNAVAILABLE` quando o diário não pôde ser aberto nesta sessão.
/// </summary>
[ApiController]
[Route("api/user/journal")]
public sealed class UserJournalController(IMediator mediator) : ControllerBase
{
    [HttpGet("history")]
    public async Task<IActionResult> GetHistory(
        [FromQuery] string? connectionId,
        [FromQuery] string? q,
        [FromQuery] long? before,
        [FromQuery] int? limit,
        CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetHistoryCommand(connectionId, q, before, limit), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpDelete("history/{id:long}")]
    public async Task<IActionResult> HideHistoryEntry(long id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new HideHistoryEntryCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }

    [HttpDelete("history")]
    public async Task<IActionResult> HideConnectionHistory([FromQuery] string? connectionId, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new HideConnectionHistoryCommand(connectionId), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }

    [HttpGet("audit")]
    public async Task<IActionResult> GetAuditEntries(
        [FromQuery] string? from,
        [FromQuery] string? to,
        [FromQuery] string[]? connectionId,
        [FromQuery] string[]? environment,
        [FromQuery] string[]? level,
        [FromQuery] string[]? kind,
        [FromQuery] string[]? outcome,
        [FromQuery] string? q,
        [FromQuery] string? scriptRunId,
        [FromQuery] long? before,
        [FromQuery] int? limit,
        CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetAuditEntriesCommand(from, to, connectionId, environment, level, kind, outcome, q, scriptRunId, before, limit), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpGet("audit/facets")]
    public async Task<IActionResult> GetAuditFacets(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetAuditFacetsCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpGet("audit/{id:long}")]
    public async Task<IActionResult> GetAuditEntry(long id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetAuditEntryCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpGet("settings")]
    public async Task<IActionResult> GetSettings(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetJournalSettingsCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpPut("settings")]
    public async Task<IActionResult> UpdateSettings([FromBody] UpdateJournalSettingsCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpPost("audit/purge")]
    public async Task<IActionResult> PurgeAudit([FromBody] PurgeAuditCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }
}
