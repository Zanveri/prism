using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Models.Dtos;
using Prism.Application.Connections.Queries;
using Prism.Application.Journal;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Services;
using System.Text.Json.Serialization;

namespace Prism.Application.Connections.Features.RevealConnectionPassword;

/// <summary>
/// RN-CONN-002: `Password` é a senha do usuário (a do Prism), e não a do banco. O `ID` vem da rota, e o `[JsonIgnore]` impede
/// que o corpo o escolha: o controller completa o comando com `with { ID = id }`.
/// </summary>
public sealed record RevealConnectionPasswordCommand : IRequest<Result<ConnectionPasswordDto, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid ID { get; init; }
    public string Password { get; init; } = string.Empty;

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e esta é a senha do usuário.</summary>
    public override string ToString() => nameof(RevealConnectionPasswordCommand);
}

internal sealed class RevealConnectionPasswordHandler(IConnectionQueries connectionQueries, IVaultService vaultService, IJournalRecorder? journal = null, TimeProvider? timeProvider = null) : IRequestHandler<RevealConnectionPasswordCommand, Result<ConnectionPasswordDto, ApiErrorDto>>
{
    public async Task<Result<ConnectionPasswordDto, ApiErrorDto>> Handle(RevealConnectionPasswordCommand request, CancellationToken cancellationToken)
    {
        var clock = timeProvider ?? TimeProvider.System;
        var startedAt = clock.GetUtcNow();

        var read = await connectionQueries.GetRecordByID(request.ID, cancellationToken);
        if (read.IsFailure)
            return Result.Failure<ConnectionPasswordDto, ApiErrorDto>(VaultErrors.From(read.Error));

        if (read.Value is not { } record)
            return Result.Failure<ConnectionPasswordDto, ApiErrorDto>(ConnectionErrors.NotFound(request.ID));

        var verified = await vaultService.ReadIfPasswordMatchesAsync(request.Password, cancellationToken);
        var endedAt = clock.GetUtcNow();
        var durationMs = Math.Max(0L, (long)(endedAt - startedAt).TotalMilliseconds);
        if (verified.IsFailure)
            return Result.Failure<ConnectionPasswordDto, ApiErrorDto>(VaultErrors.From(verified.Error));

        if (verified.Value is not { } document)
        {
            if (journal is not null)
            {
                var (errSnapshot, errProtections) = JournalSnapshots.FromRecord(vaultService, record);
                journal.Record(
                    new JournalEntryStart(startedAt, EJournalKind.Security, "Senha da conexão revelada", EJournalLevel.High, "Tentativa de revelar a senha da conexão com senha errada.", Connection: errSnapshot, Protections: errProtections),
                    new JournalEntryEnd(endedAt, durationMs, EJournalOutcome.Error, ErrorCode: "INVALID_PASSWORD"));
            }

            return Result.Failure<ConnectionPasswordDto, ApiErrorDto>(ConnectionErrors.InvalidPassword());
        }

        var verifiedRecord = document.Connections.FirstOrDefault(connection => connection.ID == request.ID);
        if (verifiedRecord is null)
            return Result.Failure<ConnectionPasswordDto, ApiErrorDto>(ConnectionErrors.NotFound(request.ID));

        if (journal is not null)
        {
            var (snapshot, protections) = JournalSnapshots.FromDocument(document, verifiedRecord);
            journal.Record(
                new JournalEntryStart(startedAt, EJournalKind.Security, "Senha da conexão revelada", EJournalLevel.High, "Senha da conexão revelada.", Connection: snapshot, Protections: protections),
                new JournalEntryEnd(endedAt, durationMs, EJournalOutcome.Ok));
        }

        return Result.Success<ConnectionPasswordDto, ApiErrorDto>(new ConnectionPasswordDto { Password = verifiedRecord.Password });
    }
}
