using CSharpFunctionalExtensions;
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

namespace Prism.Application.DatabaseSessions.Features.EndTransaction;

/// <summary>
/// RN-TX-002, 009 e 014 (`transaction/commit` e `transaction/rollback`): o "Commit" e o "Rollback" da barra do editor. Responde o estado depois deles e
/// quantos comandos a transação tinha, para o aviso ("Transação confirmada: N comandos").
/// </summary>
public sealed record EndTransactionCommand(Guid SessionID, bool Commit) : IRequest<Result<TransactionEndedDto, ApiErrorDto>>;

internal sealed class EndTransactionHandler(IDatabaseSessionService databaseSessionService, IVaultService? vaultService = null, IJournalRecorder? journalRecorder = null) : IRequestHandler<EndTransactionCommand, Result<TransactionEndedDto, ApiErrorDto>>
{
    public async Task<Result<TransactionEndedDto, ApiErrorDto>> Handle(EndTransactionCommand request, CancellationToken cancellationToken)
    {
        var entryId = -1L;
        if (journalRecorder is not null)
        {
            var sessionInfo = databaseSessionService.InfoOf(request.SessionID);
            var (snapshot, protections) = JournalSnapshots.FromVault(vaultService, sessionInfo?.ConnectionID, sessionInfo);

            entryId = journalRecorder.Begin(new JournalEntryStart(
                Kind: EJournalKind.Transaction,
                Action: request.Commit ? "COMMIT" : "ROLLBACK",
                Level: EJournalLevel.Warning,
                Reason: request.Commit ? "Confirmação manual da transação." : "Desfazimento manual da transação.",
                Origin: "other",
                Sql: request.Commit ? "COMMIT" : "ROLLBACK",
                SessionId: request.SessionID,
                Connection: snapshot,
                Protections: protections));
        }

        var ended = request.Commit ? await databaseSessionService.CommitAsync(request.SessionID, cancellationToken) : await databaseSessionService.RollbackAsync(request.SessionID, cancellationToken);
        if (ended.IsFailure)
        {
            var errorDto = DatabaseSessionErrors.From(ended.Error);
            if (entryId > 0)
            {
                var outcome = ended.Error.Kind is EDatabaseFailure.NoOpenTransaction or EDatabaseFailure.TransactionFailed ? EJournalOutcome.Refused : EJournalOutcome.Error;
                journalRecorder!.Complete(entryId, new JournalEntryEnd(outcome, null, errorDto.Type, ended.Error.SqlState, errorDto.Detail));
            }

            return Result.Failure<TransactionEndedDto, ApiErrorDto>(errorDto);
        }

        if (entryId > 0)
            journalRecorder!.Complete(entryId, new JournalEntryEnd(EJournalOutcome.Ok, ended.Value));

        // A sessão que caiu logo depois do fim já não tem estado: sem transação, como ela ficou.
        var transaction = databaseSessionService.TransactionOf(request.SessionID)?.ToDto() ?? new TransactionDto("manual", "default", false, false, 0, null);

        return Result.Success<TransactionEndedDto, ApiErrorDto>(new TransactionEndedDto(transaction, ended.Value));
    }
}
