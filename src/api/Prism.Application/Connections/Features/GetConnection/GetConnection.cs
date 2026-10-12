using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Models.Dtos;
using Prism.Application.Connections.Queries;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;

namespace Prism.Application.Connections.Features.GetConnection;

public sealed record GetConnectionCommand(Guid ID) : IRequest<Result<ConnectionDto, ApiErrorDto>>;

internal sealed class GetConnectionHandler(IConnectionQueries connectionQueries) : IRequestHandler<GetConnectionCommand, Result<ConnectionDto, ApiErrorDto>>
{
    public async Task<Result<ConnectionDto, ApiErrorDto>> Handle(GetConnectionCommand request, CancellationToken cancellationToken)
    {
        // RN-CONN-001: o registro tem a senha, e o DTO não. Cofre fechado é 401; só um sucesso com `null` é "não existe".
        var read = await connectionQueries.GetRecordByID(request.ID, cancellationToken);
        if (read.IsFailure)
            return Result.Failure<ConnectionDto, ApiErrorDto>(VaultErrors.From(read.Error));

        if (read.Value is not { } record)
            return Result.Failure<ConnectionDto, ApiErrorDto>(ConnectionErrors.NotFound(request.ID));

        return Result.Success<ConnectionDto, ApiErrorDto>(record.ToDto());
    }
}
