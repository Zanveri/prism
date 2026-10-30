using CSharpFunctionalExtensions;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Queries;
using Prism.Application.Folders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;

namespace Prism.Application.Folders.Features.DeleteFolder;

public sealed record DeleteFolderCommand(Guid ID) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class DeleteFolderHandler(IFolderQueries folderQueries, IFolderRepository folderRepository, IJournalRecorder? journal = null, TimeProvider? timeProvider = null) : IRequestHandler<DeleteFolderCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(DeleteFolderCommand request, CancellationToken cancellationToken)
    {
        var clock = timeProvider ?? TimeProvider.System;
        var startedAt = clock.GetUtcNow();

        if (await folderQueries.HasChildren(request.ID, cancellationToken))
            return UnitResult.Failure(FolderErrors.NotEmpty());

        var deleted = await folderRepository.Delete(request.ID, cancellationToken);
        if (deleted.IsFailure)
            return deleted;

        var endedAt = clock.GetUtcNow();
        journal?.Record(
            new JournalEntryStart(startedAt, EJournalKind.Connections, "Pasta excluída", EJournalLevel.Warning, "Pasta excluída."),
            new JournalEntryEnd(endedAt, Math.Max(0L, (long)(endedAt - startedAt).TotalMilliseconds), EJournalOutcome.Ok));

        return deleted;
    }
}
