using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.EndTransaction;

/// <summary>
/// RN-TX-002, 009 e 014 (`transaction/commit` e `transaction/rollback`): o "Commit" e o "Rollback" da barra do editor. Responde o estado depois deles e
/// quantos comandos a transação tinha, para o aviso ("Transação confirmada: N comandos").
/// </summary>
public sealed record EndTransactionCommand(Guid SessionID, bool Commit) : IRequest<Result<TransactionEndedDto, ApiErrorDto>>;

internal sealed class EndTransactionHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<EndTransactionCommand, Result<TransactionEndedDto, ApiErrorDto>>
{
    public async Task<Result<TransactionEndedDto, ApiErrorDto>> Handle(EndTransactionCommand request, CancellationToken cancellationToken)
    {
        var ended = request.Commit ? await databaseSessionService.CommitAsync(request.SessionID, cancellationToken) : await databaseSessionService.RollbackAsync(request.SessionID, cancellationToken);
        if (ended.IsFailure)
            return Result.Failure<TransactionEndedDto, ApiErrorDto>(DatabaseSessionErrors.From(ended.Error));

        // A sessão que caiu logo depois do fim já não tem estado: sem transação, como ela ficou.
        var transaction = databaseSessionService.TransactionOf(request.SessionID)?.ToDto() ?? new TransactionDto("manual", "default", false, false, 0, null);

        return Result.Success<TransactionEndedDto, ApiErrorDto>(new TransactionEndedDto(transaction, ended.Value));
    }
}
