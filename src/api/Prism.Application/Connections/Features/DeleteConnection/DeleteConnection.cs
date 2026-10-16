using CSharpFunctionalExtensions;
using Prism.Application.Connections.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Transfers.Services;

namespace Prism.Application.Connections.Features.DeleteConnection;

public sealed record DeleteConnectionCommand(Guid ID) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class DeleteConnectionHandler(IConnectionRepository connectionRepository, IDatabaseSessionService databaseSessionService, ITransferService transferService) : IRequestHandler<DeleteConnectionCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(DeleteConnectionCommand request, CancellationToken cancellationToken)
    {
        // Que a conexão exista é dito só pela gravação: uma leitura feita antes devolveria "não existe" também com o cofre fechado, e seria um 404 onde o certo é o 401.
        var deleted = await connectionRepository.Delete(request.ID, cancellationToken);
        if (deleted.IsFailure)
            return deleted;

        // RN-CONN-014: só depois de a exclusão estar gravada. Uma exclusão recusada (404, cofre fechado) não encerra sessão nenhuma. As exportações de
        // dados dela são canceladas, com o motivo `connectionDeleted` (RN-EXPORT-016).
        transferService.CancelByConnection(request.ID);
        await databaseSessionService.CloseByConnectionAsync(request.ID);

        return deleted;
    }
}
