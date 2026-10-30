using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Journal.Models;
using Prism.Application.Journal.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Services;
using System.Globalization;

namespace Prism.Application.Journal.Features.PurgeAudit;

public sealed record PurgeAuditCommand : IRequest<Result<PurgeAuditResultDto, ApiErrorDto>>
{
    public DateTimeOffset Before { get; init; }
    public string Password { get; init; } = string.Empty;

    /// <summary>RN-LOG-001: não expõe a senha do usuário no log em texto.</summary>
    public override string ToString() => nameof(PurgeAuditCommand);
}

internal sealed class PurgeAuditHandler(IVaultService vaultService, IJournalService journalService, TimeProvider? timeProvider = null) : IRequestHandler<PurgeAuditCommand, Result<PurgeAuditResultDto, ApiErrorDto>>
{
    public async Task<Result<PurgeAuditResultDto, ApiErrorDto>> Handle(PurgeAuditCommand request, CancellationToken cancellationToken)
    {
        var clock = timeProvider ?? TimeProvider.System;
        var startedAt = clock.GetUtcNow();

        var verified = await vaultService.ReadIfPasswordMatchesAsync(request.Password, cancellationToken);
        var endedAt = clock.GetUtcNow();
        var durationMs = Math.Max(0L, (long)(endedAt - startedAt).TotalMilliseconds);
        if (verified.IsFailure)
            return Result.Failure<PurgeAuditResultDto, ApiErrorDto>(VaultErrors.From(verified.Error));

        if (verified.Value is null)
        {
            journalService.Record(
                new JournalEntryStart(startedAt, EJournalKind.Security, "Apagar registros do diário", EJournalLevel.Warning, "Tentativa de apagar registros do diário com senha errada."),
                new JournalEntryEnd(endedAt, durationMs, EJournalOutcome.Error, ErrorCode: "INVALID_PASSWORD"));

            return Result.Failure<PurgeAuditResultDto, ApiErrorDto>(ConnectionErrors.InvalidPassword());
        }

        var purgeResult = await journalService.PurgeBeforeAsync(request.Before, cancellationToken);
        if (purgeResult.IsFailure)
            return Result.Failure<PurgeAuditResultDto, ApiErrorDto>(JournalErrors.From(purgeResult.Error));

        var deleted = purgeResult.Value;
        var dateLabel = request.Before.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
        var action = deleted == 1
            ? $"1 registro apagado, anterior a {dateLabel}"
            : $"{deleted} registros apagados, anteriores a {dateLabel}";

        var doneAt = clock.GetUtcNow();
        var totalDurationMs = Math.Max(0L, (long)(doneAt - startedAt).TotalMilliseconds);
        journalService.Record(
            new JournalEntryStart(startedAt, EJournalKind.Security, action, EJournalLevel.Critical, $"{action}."),
            new JournalEntryEnd(doneAt, totalDurationMs, EJournalOutcome.Ok, RowCount: deleted));

        return Result.Success<PurgeAuditResultDto, ApiErrorDto>(new PurgeAuditResultDto
        {
            Deleted = deleted
        });
    }
}
