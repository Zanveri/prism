using CSharpFunctionalExtensions;
using Prism.Application.Transfers.Models;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Transfers.Services;

namespace Prism.Application.Transfers.Features.GetTransfer;

/// <summary>RN-EXPORT-016: `GET api/user/transfers/{id}`. A consulta mantém o trabalho vivo: o que ninguém consulta por 5 minutos é abandonado.</summary>
public sealed record GetTransferCommand(Guid ID) : IRequest<Result<TransferDto, ApiErrorDto>>;

internal sealed class GetTransferHandler(ITransferService transferService) : IRequestHandler<GetTransferCommand, Result<TransferDto, ApiErrorDto>>
{
    public Task<Result<TransferDto, ApiErrorDto>> Handle(GetTransferCommand request, CancellationToken cancellationToken)
        => Task.FromResult(transferService.Get(request.ID) is { } transfer ? Result.Success<TransferDto, ApiErrorDto>(transfer.ToDto()) : Result.Failure<TransferDto, ApiErrorDto>(TransferJobErrors.NotFound(request.ID)));
}
