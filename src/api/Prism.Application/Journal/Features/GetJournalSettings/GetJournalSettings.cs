using CSharpFunctionalExtensions;
using Prism.Application.Journal.Models;
using Prism.Application.Journal.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Services;

namespace Prism.Application.Journal.Features.GetJournalSettings;

public sealed record GetJournalSettingsCommand : IRequest<Result<JournalSettingsDto, ApiErrorDto>>;

internal sealed class GetJournalSettingsHandler(IJournalService journalService) : IRequestHandler<GetJournalSettingsCommand, Result<JournalSettingsDto, ApiErrorDto>>
{
    public async Task<Result<JournalSettingsDto, ApiErrorDto>> Handle(GetJournalSettingsCommand request, CancellationToken cancellationToken)
    {
        var result = await journalService.GetRetentionAsync(cancellationToken);
        if (result.IsFailure)
            return Result.Failure<JournalSettingsDto, ApiErrorDto>(JournalErrors.From(result.Error));

        return Result.Success<JournalSettingsDto, ApiErrorDto>(new JournalSettingsDto
        {
            RetentionDays = result.Value ?? 0
        });
    }
}
