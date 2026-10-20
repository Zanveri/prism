using CSharpFunctionalExtensions;
using Prism.Application.Transfers.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Transfers.Services;

namespace Prism.Application.Transfers.Features.DeleteTransfer;

/// <summary>
/// RN-EXPORT-016: `DELETE api/user/transfers/{id}` cancela o trabalho que roda (e responde quando ele parou, ou em 10 segundos) e esquece o que terminou,
/// apagando o arquivo dele. Não usa o `CancellationToken` da requisição: o cancelamento pedido não se desfaz porque a tela desistiu de esperar.
/// </summary>
public sealed record DeleteTransferCommand(Guid ID) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class DeleteTransferHandler(ITransferService transferService) : IRequestHandler<DeleteTransferCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(DeleteTransferCommand request, CancellationToken cancellationToken)
        => await transferService.DeleteAsync(request.ID) ? UnitResult.Success<ApiErrorDto>() : UnitResult.Failure(TransferJobErrors.NotFound(request.ID));
}
