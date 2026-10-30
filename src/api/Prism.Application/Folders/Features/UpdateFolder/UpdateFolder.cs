using CSharpFunctionalExtensions;
using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Models.Dtos;
using Prism.Application.Folders.Queries;
using Prism.Application.Folders.Repositories;
using Prism.Application.Journal;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;

namespace Prism.Application.Folders.Features.UpdateFolder;

/// <summary>
/// Renomear, mover e trocar o ambiente, a cor ou as proteções são a mesma rota, e o `PATCH` grava a pasta por inteiro: `ParentID` nulo
/// move a pasta para a raiz, o ambiente ausente a deixa sem ambiente (RN-PASTA-005, como no `PATCH` da conexão), a cor
/// ausente a deixa sem cor (RN-PASTA-007), a confirmação ausente volta a "Não" e o somente leitura ausente sai (RN-PROT-001 e 002),
/// e quem só renomeia ou só move manda o que ela já tem.
///
/// `UserPassword` é a senha do usuário do Prism, que só a mudança do somente leitura pede (RN-PROT-003: marcar ou desmarcar o da pasta, ou mover
/// para fora de uma pasta somente leitura uma pasta que tem conexões dentro); quem decide se ela é pedida é a gravação, contra o documento mais recente.
/// </summary>
public sealed record UpdateFolderCommand : IRequest<Result<FolderDto, ApiErrorDto>>
{
    public Guid ID { get; init; }
    public string Name { get; init; } = string.Empty;
    public Guid? ParentID { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }
    public string? Color { get; init; }

    /// <summary>RN-PROT-001: `none`, `irreversible` ou `all`; ausente, nulo ou vazio é `none`.</summary>
    public string? ConfirmCommands { get; init; }

    /// <summary>RN-PROT-002: ausente é falso.</summary>
    public bool ReadOnly { get; init; }

    public bool UseInternalDescriptions { get; init; }

    /// <summary>RN-PROT-003: a senha do usuário do Prism.</summary>
    public string? UserPassword { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e esta pode ser a senha do usuário.</summary>
    public override string ToString() => nameof(UpdateFolderCommand);
}

internal sealed class UpdateFolderHandler(IFolderQueries folderQueries, IFolderRepository folderRepository, TimeProvider timeProvider, IJournalRecorder? journal = null) : IRequestHandler<UpdateFolderCommand, Result<FolderDto, ApiErrorDto>>
{
    public async Task<Result<FolderDto, ApiErrorDto>> Handle(UpdateFolderCommand request, CancellationToken cancellationToken)
    {
        var startedAt = timeProvider.GetUtcNow();
        var loaded = await folderRepository.GetByID(request.ID, cancellationToken);
        if (loaded.IsFailure)
            return Result.Failure<FolderDto, ApiErrorDto>(loaded.Error);

        var (folder, protections) = loaded.Value;
        var parentChanged = request.ParentID != folder.ParentID;

        if (parentChanged && request.ParentID is { } parentID && await folderQueries.IsSelfOrDescendant(parentID, folder.ID, cancellationToken))
            return Result.Failure<FolderDto, ApiErrorDto>(FolderErrors.Cycle());

        var name = request.Name.NormalizeName();
        var environmentChanged = EnvironmentRules.NormalizeName(request.EnvironmentName) != folder.EnvironmentName || EnvironmentRules.NormalizeColor(request.EnvironmentColor) != folder.EnvironmentColor;
        var colorChanged = EnvironmentRules.NormalizeColor(request.Color) != folder.Color;
        var protectionsChanged = ProtectionRules.NormalizeConfirmation(request.ConfirmCommands) != folder.ConfirmCommands || request.ReadOnly != folder.ReadOnly;
        var internalDescriptionsChanged = request.UseInternalDescriptions != folder.UseInternalDescriptions;

        if (!parentChanged && name == folder.Name && !environmentChanged && !colorChanged && !protectionsChanged && !internalDescriptionsChanged)
            return Result.Success<FolderDto, ApiErrorDto>(folder.ToDto(protections));

        var keyChanged = parentChanged || !string.Equals(name, folder.Name, StringComparison.OrdinalIgnoreCase);
        if (keyChanged && await folderQueries.Exists(name, request.ParentID, cancellationToken))
            return Result.Failure<FolderDto, ApiErrorDto>(FolderErrors.AlreadyExists(name));

        var previousReadOnly = folder.ReadOnly;
        var previousConfirm = folder.ConfirmCommands;
        var previousParentID = folder.ParentID;

        var now = startedAt.UtcDateTime;
        folder.Rename(name, now);
        folder.MoveTo(request.ParentID, now);
        folder.ChangeEnvironment(request.EnvironmentName, request.EnvironmentColor, now);
        folder.ChangeColor(request.Color, now);
        folder.ChangeProtections(request.ConfirmCommands, request.ReadOnly, now);
        folder.ChangeInternalDescriptions(request.UseInternalDescriptions, now);

        var updated = await folderRepository.Update(folder, request.UserPassword, cancellationToken);
        var endedAt = timeProvider.GetUtcNow();
        var durationMs = Math.Max(0L, (long)(endedAt - startedAt).TotalMilliseconds);
        if (updated.IsFailure)
        {
            if (updated.Error.Type == "INVALID_PASSWORD")
                journal?.Record(
                    new JournalEntryStart(startedAt, EJournalKind.Security, "Senha errada numa conferência", EJournalLevel.Warning, "Senha errada ao mudar o somente leitura da pasta.", Protections: JournalSnapshots.ProtectionsText(protections)),
                    new JournalEntryEnd(endedAt, durationMs, EJournalOutcome.Error, ErrorCode: "INVALID_PASSWORD"));

            return Result.Failure<FolderDto, ApiErrorDto>(updated.Error);
        }

        var (action, level, reason) = ClassifyChange(previousReadOnly, folder.ReadOnly, previousConfirm, folder.ConfirmCommands, previousParentID, folder.ParentID);
        journal?.Record(
            new JournalEntryStart(startedAt, EJournalKind.Connections, action, level, reason, Protections: JournalSnapshots.ProtectionsText(updated.Value)),
            new JournalEntryEnd(endedAt, durationMs, EJournalOutcome.Ok));

        return Result.Success<FolderDto, ApiErrorDto>(folder.ToDto(updated.Value));
    }

    private static (string Action, EJournalLevel Level, string Reason) ClassifyChange(bool previousReadOnly, bool currentReadOnly, string? previousConfirm, string? currentConfirm, Guid? previousParentID, Guid? currentParentID)
    {
        if (previousReadOnly && !currentReadOnly)
            return ("Somente leitura desligado", EJournalLevel.High, "Somente leitura desligado na pasta.");

        if (!previousReadOnly && currentReadOnly)
            return ("Somente leitura ligado", EJournalLevel.Info, "Somente leitura ligado na pasta.");

        var previousRank = ConfirmationRank(previousConfirm);
        var currentRank = ConfirmationRank(currentConfirm);
        if (currentRank < previousRank)
            return ("Confirmação afrouxada", EJournalLevel.High, "Confirmação de comandos afrouxada na pasta.");

        if (currentRank > previousRank)
            return ("Confirmação ligada", EJournalLevel.Info, "Confirmação de comandos reforçada na pasta.");

        if (previousParentID != currentParentID)
            return ("Pasta movida", EJournalLevel.Info, "Pasta movida.");

        return ("Pasta editada", EJournalLevel.Info, "Pasta editada.");
    }

    private static int ConfirmationRank(string? confirm)
        => confirm switch
        {
            ProtectionRules.ConfirmAll => 2,
            ProtectionRules.ConfirmIrreversible => 1,
            _ => 0
        };
}
