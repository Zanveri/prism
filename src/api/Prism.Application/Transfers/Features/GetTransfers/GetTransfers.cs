using CSharpFunctionalExtensions;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Transfers.Services;

namespace Prism.Application.Transfers.Features.GetTransfers;

/// <summary>
/// RN-EXPORT-016: `GET api/user/transfers`, os trabalhos do cofre aberto, de todas as janelas, com o `windowID` de cada um: o "Sair" conta os que estão
/// em andamento, a página que monta a área de trabalho cancela os da janela dela, e o diálogo de excluir a conexão conta os dela. Não conta como consulta.
/// </summary>
public sealed record GetTransfersCommand : IRequest<Result<IReadOnlyList<TransferDto>, ApiErrorDto>>;

internal sealed class GetTransfersHandler(ITransferService transferService) : IRequestHandler<GetTransfersCommand, Result<IReadOnlyList<TransferDto>, ApiErrorDto>>
{
    public Task<Result<IReadOnlyList<TransferDto>, ApiErrorDto>> Handle(GetTransfersCommand request, CancellationToken cancellationToken)
        => Task.FromResult(Result.Success<IReadOnlyList<TransferDto>, ApiErrorDto>([.. transferService.List().Select(TransferMappings.ToDto)]));
}
