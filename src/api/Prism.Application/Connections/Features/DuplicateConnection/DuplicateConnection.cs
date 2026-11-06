using CSharpFunctionalExtensions;
using Prism.Application.Connections.Models.Dtos;
using Prism.Application.Connections.Repositories;
using Prism.Application.Journal;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Services;
using ILogger = Serilog.ILogger;

namespace Prism.Application.Connections.Features.DuplicateConnection;

/// <summary>RN-CONN-016: "Duplicar conexão". Só o ID, que vem da rota: a senha é copiada dentro do cofre e não passa pela tela.</summary>
public sealed record DuplicateConnectionCommand(Guid ID) : IRequest<Result<ConnectionDto, ApiErrorDto>>;

internal sealed class DuplicateConnectionHandler(IConnectionRepository connectionRepository, TimeProvider timeProvider, ILogger logger, IVaultService? vaultService = null, IJournalRecorder? journal = null) : IRequestHandler<DuplicateConnectionCommand, Result<ConnectionDto, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<DuplicateConnectionHandler>();

    public async Task<Result<ConnectionDto, ApiErrorDto>> Handle(DuplicateConnectionCommand request, CancellationToken cancellationToken)
    {
        var startedAt = timeProvider.GetUtcNow();
        var duplicated = await connectionRepository.Duplicate(request.ID, startedAt.UtcDateTime, cancellationToken);
        if (duplicated.IsFailure)
            return Result.Failure<ConnectionDto, ApiErrorDto>(duplicated.Error);

        var (copy, protections) = duplicated.Value;

        // RN-LOG-001: os IDs, e nada da conexão (nome, host, usuário e senha ficam fora do log).
        _logger.Information("Conexão {ConnectionID} duplicada; a cópia é a conexão {CopyID}.", request.ID, copy.ID);

        var endedAt = timeProvider.GetUtcNow();
        var (snapshot, _) = JournalSnapshots.FromRecord(vaultService, ConnectionRecords.ToRecord(copy));
        journal?.Record(
            new JournalEntryStart(startedAt, EJournalKind.Connections, "Conexão criada", EJournalLevel.Info, "Conexão duplicada.", Connection: snapshot, Protections: JournalSnapshots.ProtectionsText(protections)),
            new JournalEntryEnd(endedAt, Math.Max(0L, (long)(endedAt - startedAt).TotalMilliseconds), EJournalOutcome.Ok));

        return Result.Success<ConnectionDto, ApiErrorDto>(copy.ToDto(protections));
    }
}
