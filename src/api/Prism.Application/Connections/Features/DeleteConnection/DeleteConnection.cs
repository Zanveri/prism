using CSharpFunctionalExtensions;
using Prism.Application.Connections.Repositories;
using Prism.Application.Journal;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Transfers.Services;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Connections.Features.DeleteConnection;

public sealed record DeleteConnectionCommand(Guid ID) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class DeleteConnectionHandler(IConnectionRepository connectionRepository, IDatabaseSessionService databaseSessionService, ITransferService transferService, IVaultService? vaultService = null, IJournalRecorder? journal = null, TimeProvider? timeProvider = null) : IRequestHandler<DeleteConnectionCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(DeleteConnectionCommand request, CancellationToken cancellationToken)
    {
        var clock = timeProvider ?? TimeProvider.System;
        var startedAt = clock.GetUtcNow();
        var (snapshot, protections) = JournalSnapshots.FromVault(vaultService, request.ID);

        var deleted = await connectionRepository.Delete(request.ID, cancellationToken);
        if (deleted.IsFailure)
            return deleted;

        transferService.CancelByConnection(request.ID);
        await databaseSessionService.CloseByConnectionAsync(request.ID);

        var endedAt = clock.GetUtcNow();
        journal?.Record(
            new JournalEntryStart(startedAt, EJournalKind.Connections, "Conexão excluída", EJournalLevel.Warning, "Conexão excluída.", Connection: snapshot, Protections: protections),
            new JournalEntryEnd(endedAt, Math.Max(0L, (long)(endedAt - startedAt).TotalMilliseconds), EJournalOutcome.Ok));

        return deleted;
    }
}
