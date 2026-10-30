using CSharpFunctionalExtensions;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Application.Journal;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Services;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Prism.Application.DatabaseSessions.Features.ApplyEdits;

/// <summary>
/// RN-EDIT-005, 011 e 012: o "Salvar" das pendências, na sessão da aba, numa transação própria (nos Registros a aba é sempre
/// Auto-commit, RN-TX-001), ou, no Commit manual, na transação da aba, num ponto de salvamento só dele; no Informix sem log, uma alteração por vez.
/// Responde `{ applied, transaction }`.
/// </summary>
public sealed record ApplyEditsCommand : IRequest<Result<EditsAppliedDto, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid SessionID { get; init; }
    public Guid ResultID { get; init; }
    public IReadOnlyList<EditChangeDto>? Changes { get; init; }

    /// <summary>RN-LOG-001: os valores das células são dados do usuário.</summary>
    public override string ToString() => nameof(ApplyEditsCommand);
}

internal sealed class ApplyEditsHandler(IConnectionQueries connectionQueries, IDatabaseSessionService databaseSessionService, IVaultService? vaultService = null, IJournalRecorder? journalRecorder = null) : IRequestHandler<ApplyEditsCommand, Result<EditsAppliedDto, ApiErrorDto>>
{
    public async Task<Result<EditsAppliedDto, ApiErrorDto>> Handle(ApplyEditsCommand request, CancellationToken cancellationToken)
    {
        // RN-PROT-002: a edição de registros não existe numa conexão somente leitura (a dela ou a de uma pasta acima, no cofre agora).
        var readOnly = await connectionQueries.IsReadOnly(databaseSessionService, request.SessionID, cancellationToken);
        if (readOnly.IsFailure)
            return Result.Failure<EditsAppliedDto, ApiErrorDto>(readOnly.Error);

        var wholeColumnChange = request.Changes?.FirstOrDefault(change => change.Kind is "updateAll" or "column");
        long? wholeColumnRows = wholeColumnChange?.Rows is { ValueKind: JsonValueKind.Number } rowsElement && rowsElement.TryGetInt64(out var parsedRows) ? parsedRows : null;
        var isWholeColumn = wholeColumnChange is not null;

        var entryId = -1L;
        if (journalRecorder is not null)
        {
            var sessionInfo = databaseSessionService.InfoOf(request.SessionID);
            var (snapshot, protections) = JournalSnapshots.FromVault(vaultService, sessionInfo?.ConnectionID, sessionInfo, readOnly.Value);

            entryId = journalRecorder.Begin(new JournalEntryStart(
                Kind: EJournalKind.Edit,
                Action: isWholeColumn ? "Salvar da coluna inteira" : "Salvar edições",
                Level: isWholeColumn ? EJournalLevel.High : EJournalLevel.Warning,
                Reason: isWholeColumn ? $"Coluna inteira: {wholeColumnRows ?? 0} linhas." : "Edição pela grade.",
                Origin: "other",
                Sql: isWholeColumn ? "UPDATE (coluna inteira)" : "Salvar edições da grade",
                Confirmed: isWholeColumn,
                SessionId: request.SessionID,
                Connection: snapshot,
                Protections: protections));
        }

        if (readOnly.Value)
        {
            var refusal = SessionProtections.EditsRefusal();
            if (entryId > 0)
                journalRecorder!.Complete(entryId, new JournalEntryEnd(EJournalOutcome.Refused, null, refusal.Type, null, refusal.Detail));

            return Result.Failure<EditsAppliedDto, ApiErrorDto>(refusal);
        }

        var applied = await databaseSessionService.ApplyEditsAsync(request.SessionID, request.ResultID, request.Changes.ToChanges(), cancellationToken);
        if (entryId > 0)
        {
            if (applied.IsSuccess)
            {
                journalRecorder!.Complete(entryId, new JournalEntryEnd(EJournalOutcome.Ok, wholeColumnRows ?? applied.Value));
            }
            else
            {
                var errorDto = DatabaseSessionErrors.From(applied.Error);
                var journalOutcome = applied.Error.Outcome == ECancelOutcome.Canceled
                    ? EJournalOutcome.Cancelled
                    : applied.Error.Kind is EDatabaseFailure.ConnectionReadOnly or EDatabaseFailure.EditInvalid or EDatabaseFailure.TransactionFailed
                        ? EJournalOutcome.Refused
                        : EJournalOutcome.Error;
                var sqlState = journalOutcome == EJournalOutcome.Error ? applied.Error.SqlState : null;
                journalRecorder!.Complete(entryId, new JournalEntryEnd(journalOutcome, null, errorDto.Type, sqlState, errorDto.Detail));
            }
        }

        return applied.Map(count => new EditsAppliedDto(count, databaseSessionService.TransactionOf(request.SessionID)?.ToDto())).MapError(DatabaseSessionErrors.From);
    }
}
