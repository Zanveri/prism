using CSharpFunctionalExtensions;
using Prism.Application.Journal.Models;
using Prism.Application.Journal.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Services;

namespace Prism.Application.Journal.Features.GetAuditEntry;

public sealed record GetAuditEntryCommand(long Id) : IRequest<Result<AuditEntryDto, ApiErrorDto>>;

internal sealed class GetAuditEntryHandler(IJournalService journalService) : IRequestHandler<GetAuditEntryCommand, Result<AuditEntryDto, ApiErrorDto>>
{
    public async Task<Result<AuditEntryDto, ApiErrorDto>> Handle(GetAuditEntryCommand request, CancellationToken cancellationToken)
    {
        var result = await journalService.GetAsync(request.Id, cancellationToken);
        if (result.IsFailure)
            return Result.Failure<AuditEntryDto, ApiErrorDto>(JournalErrors.From(result.Error, request.Id));

        return Result.Success<AuditEntryDto, ApiErrorDto>(AuditEntryDto.FromEntry(result.Value));
    }
}
