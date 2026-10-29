using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.Application.DatabaseSessions.Features.ChangeTransactionMode;

/// <summary>
/// RN-TX-001 e 005 (`PATCH api/user/database-sessions`): o modo de transação da aba, que a sessão dela segue. Sem `transactionMode`, o modo fica como
/// está, e a resposta é a sessão com o estado da transação. `isolationLevel` só aceita `default`: o seletor de nível (RN-ISOL-*) ainda não existe.
/// </summary>
public sealed record ChangeTransactionModeCommand : IRequest<Result<DatabaseSessionDto, ApiErrorDto>>
{
    public Guid ID { get; init; }
    public string? TransactionMode { get; init; }
    public string? IsolationLevel { get; init; }
}

internal sealed class ChangeTransactionModeHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<ChangeTransactionModeCommand, Result<DatabaseSessionDto, ApiErrorDto>>
{
    public async Task<Result<DatabaseSessionDto, ApiErrorDto>> Handle(ChangeTransactionModeCommand request, CancellationToken cancellationToken)
    {
        if (databaseSessionService.InfoOf(request.ID) is not { } session || databaseSessionService.TransactionOf(request.ID) is not { } transaction)
            return Result.Failure<DatabaseSessionDto, ApiErrorDto>(DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão não existe mais.")));

        if (request.TransactionMode is { } mode)
        {
            var changed = await databaseSessionService.SetTransactionModeAsync(request.ID, mode == "manual" ? ETransactionMode.Manual : ETransactionMode.AutoCommit, cancellationToken);
            if (changed.IsFailure)
                return Result.Failure<DatabaseSessionDto, ApiErrorDto>(DatabaseSessionErrors.From(changed.Error));

            transaction = changed.Value;
        }

        return Result.Success<DatabaseSessionDto, ApiErrorDto>(session.ToDto() with { Transaction = transaction.ToDto() });
    }
}
