using CSharpFunctionalExtensions;
using Prism.Application.Journal.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Services;

namespace Prism.Application.Journal.Features.HideHistoryEntry;

public sealed record HideHistoryEntryCommand(long Id) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class HideHistoryEntryHandler(IJournalService journalService) : IRequestHandler<HideHistoryEntryCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(HideHistoryEntryCommand request, CancellationToken cancellationToken)
    {
        var result = await journalService.HideAsync(request.Id, cancellationToken);
        if (result.IsFailure)
            return UnitResult.Failure(JournalErrors.From(result.Error, request.Id));

        return UnitResult.Success<ApiErrorDto>();
    }
}
