using CSharpFunctionalExtensions;
using Prism.Application.Common.Protections;
using Prism.Application.Common.Vault;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.ConnectionTransfers.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.ConnectionFiles.Services;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using System.Text;
using ILogger = Serilog.ILogger;

namespace Prism.Application.ConnectionTransfers.Features.ExportConnections;

/// <summary>
/// RN-TRANSF-008: as pastas marcadas (as do caminho de cada item vêm sozinhas), as conexões marcadas com a escolha de cada uma (RN-TRANSF-003), a senha de
/// exportação (RN-TRANSF-004) e, quando pedida, a senha do Prism (RN-TRANSF-005). As duas senhas nunca voltam numa resposta nem vão a log.
/// </summary>
public sealed record ExportConnectionsCommand : IRequest<Result<ExportedConnectionsDto, ApiErrorDto>>
{
    public IReadOnlyList<Guid>? FolderIDs { get; init; }
    public IReadOnlyList<ExportConnectionChoice?>? Connections { get; init; }

    /// <summary>A senha de exportação. Não é a do Prism, e nunca é gravada (nem no cofre, nem nas preferências, nem no arquivo).</summary>
    public string Passphrase { get; init; } = string.Empty;

    /// <summary>A senha do usuário do Prism, só quando ao menos uma conexão vai com a senha de banco gravada (RN-TRANSF-005).</summary>
    public string? UserPassword { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e duas delas são senhas.</summary>
    public override string ToString()
        => nameof(ExportConnectionsCommand);
}

/// <summary>RN-TRANSF-003: a conexão marcada e o que vai dela: `none` (o padrão, ausente ou nulo), `user` ou `userAndPassword`.</summary>
public sealed record ExportConnectionChoice
{
    public Guid ID { get; init; }
    public string? Credentials { get; init; }
}

internal sealed class ExportConnectionsHandler(IVaultService vaultService, IConnectionFileService fileService, ILogger logger, IJournalRecorder? journal = null, TimeProvider? timeProvider = null) : IRequestHandler<ExportConnectionsCommand, Result<ExportedConnectionsDto, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<ExportConnectionsHandler>();

    public async Task<Result<ExportedConnectionsDto, ApiErrorDto>> Handle(ExportConnectionsCommand request, CancellationToken cancellationToken)
    {
        var clock = timeProvider ?? TimeProvider.System;
        var startedAt = clock.GetUtcNow();
        var generation = vaultService.Generation;

        var read = vaultService.Read();
        if (read.IsFailure)
            return Refuse(VaultErrors.From(read.Error));

        var folderIDs = (request.FolderIDs ?? []).Distinct().ToList();
        var choices = (request.Connections ?? []).Select(choice => new ExportChoice(choice!.ID, TransferRules.CredentialsOf(choice.Credentials))).ToList();

        var planned = ExportPlanner.Plan(read.Value, folderIDs, choices);
        if (planned.IsFailure)
            return Refuse(planned.Error);

        var (document, plan) = (read.Value, planned.Value);

        if (plan.NeedsUserPassword)
        {
            if (string.IsNullOrEmpty(request.UserPassword))
                return Refuse(TransferErrors.UserPasswordRequired());

            var verified = await vaultService.ReadIfPasswordMatchesAsync(request.UserPassword, cancellationToken);
            if (verified.IsFailure)
                return Refuse(VaultErrors.From(verified.Error));

            if (verified.Value is not { } verifiedDocument)
            {
                var endedAtErr = clock.GetUtcNow();
                journal?.Record(
                    new JournalEntryStart(startedAt, EJournalKind.Security, "Senha errada numa conferência", EJournalLevel.Warning, "Senha errada ao exportar conexões com senhas."),
                    new JournalEntryEnd(endedAtErr, Math.Max(0L, (long)(endedAtErr - startedAt).TotalMilliseconds), EJournalOutcome.Error, ErrorCode: "INVALID_PASSWORD"));

                return Refuse(ProtectionErrors.InvalidPassword());
            }

            if (PassphraseRules.EqualsUserPassword(request.Passphrase, request.UserPassword))
                return Refuse(TransferErrors.PassphraseEqualsUserPassword());

            var replanned = ExportPlanner.Plan(verifiedDocument, folderIDs, choices);
            if (replanned.IsFailure)
                return Refuse(replanned.Error);

            (document, plan) = (verifiedDocument, replanned.Value);
        }

        var build = ExportPlanner.Build(document, plan);
        var content = await fileService.SealAsync(build.Content, PassphraseRules.ForExport(request.Passphrase), cancellationToken);

        if (vaultService.Generation != generation)
            return Refuse(VaultErrors.From(EVaultError.Locked));

        if (Encoding.UTF8.GetByteCount(content) > TransferLimits.MaxFileBytes)
            return Refuse(TransferErrors.ExportLimitsExceeded());

        _logger.Information("Exportação de conexões: {Folders} pastas e {Connections} conexões, {WithUser} com o usuário e {WithPassword} com a senha; pastas {FolderIDs} e conexões {ConnectionIDs}.", build.Folders, build.Connections, build.WithUser, build.WithPassword, build.FolderIDs, build.ConnectionIDs);

        var endedAt = clock.GetUtcNow();
        var durationMs = Math.Max(0L, (long)(endedAt - startedAt).TotalMilliseconds);
        if (build.WithPassword > 0)
        {
            journal?.Record(
                new JournalEntryStart(startedAt, EJournalKind.Security, "Exportação de conexões com senhas", EJournalLevel.High, $"Exportação de {build.Connections} conexões ({build.WithPassword} com senha)."),
                new JournalEntryEnd(endedAt, durationMs, EJournalOutcome.Ok, RowCount: build.Connections));
        }
        else
        {
            journal?.Record(
                new JournalEntryStart(startedAt, EJournalKind.Connections, "Exportação de conexões", EJournalLevel.Info, $"Exportação de {build.Connections} conexões sem senha."),
                new JournalEntryEnd(endedAt, durationMs, EJournalOutcome.Ok, RowCount: build.Connections));
        }

        return Result.Success<ExportedConnectionsDto, ApiErrorDto>(new ExportedConnectionsDto { Content = content, Folders = build.Folders, Connections = build.Connections, WithUser = build.WithUser, WithPassword = build.WithPassword });
    }

    private Result<ExportedConnectionsDto, ApiErrorDto> Refuse(ApiErrorDto error)
    {
        _logger.Information("Exportação de conexões recusada ({Refusal:l}).", error.Type);

        return Result.Failure<ExportedConnectionsDto, ApiErrorDto>(error);
    }
}
