using CSharpFunctionalExtensions;
using Prism.Application.Folders.Domain;
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

namespace Prism.Application.Folders.Features.CreateFolder;

/// <summary>
/// `ParentID` nulo cria na raiz (RN-PASTA-001). O ambiente é opcional (RN-PASTA-005): sem nome, a pasta não tem ambiente. A cor da pasta também
/// (RN-PASTA-007): sem ela, o ícone da pasta é o neutro. As proteções também (RN-PROT-001 e 002): sem elas, a pasta não impõe nada; criar uma pasta
/// já somente leitura não pede a senha do usuário (RN-PROT-003).
/// </summary>
public sealed record CreateFolderCommand : IRequest<Result<FolderDto, ApiErrorDto>>
{
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
}

internal sealed class CreateFolderHandler(IFolderQueries folderQueries, IFolderRepository folderRepository, TimeProvider timeProvider, IJournalRecorder? journal = null) : IRequestHandler<CreateFolderCommand, Result<FolderDto, ApiErrorDto>>
{
    public async Task<Result<FolderDto, ApiErrorDto>> Handle(CreateFolderCommand request, CancellationToken cancellationToken)
    {
        var startedAt = timeProvider.GetUtcNow();
        var name = request.Name.NormalizeName();

        if (await folderQueries.Exists(name, request.ParentID, cancellationToken))
            return Result.Failure<FolderDto, ApiErrorDto>(FolderErrors.AlreadyExists(name));

        var folder = Folder.Create(name, request.ParentID, request.EnvironmentName, request.EnvironmentColor, request.Color, request.ConfirmCommands, request.ReadOnly, startedAt.UtcDateTime, request.UseInternalDescriptions);

        var inserted = await folderRepository.Insert(folder, cancellationToken);
        if (inserted.IsFailure)
            return Result.Failure<FolderDto, ApiErrorDto>(inserted.Error);

        var endedAt = timeProvider.GetUtcNow();
        journal?.Record(
            new JournalEntryStart(startedAt, EJournalKind.Connections, "Pasta criada", EJournalLevel.Info, "Pasta criada.", Protections: JournalSnapshots.ProtectionsText(inserted.Value)),
            new JournalEntryEnd(endedAt, Math.Max(0L, (long)(endedAt - startedAt).TotalMilliseconds), EJournalOutcome.Ok));

        return Result.Success<FolderDto, ApiErrorDto>(folder.ToDto(inserted.Value));
    }
}
