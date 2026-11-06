using CSharpFunctionalExtensions;
using Prism.Application.Journal.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Services;

namespace Prism.Application.Journal.Features.HideConnectionHistory;

public sealed record HideConnectionHistoryCommand(string? ConnectionId) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class HideConnectionHistoryHandler(IJournalService journalService) : IRequestHandler<HideConnectionHistoryCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(HideConnectionHistoryCommand request, CancellationToken cancellationToken)
    {
        var connectionId = Guid.Parse(request.ConnectionId!);
        var result = await journalService.HideConnectionAsync(connectionId, cancellationToken);
        if (result.IsFailure)
            return UnitResult.Failure(JournalErrors.From(result.Error));

        return UnitResult.Success<ApiErrorDto>();
    }
}
