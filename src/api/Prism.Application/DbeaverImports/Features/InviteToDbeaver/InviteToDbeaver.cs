using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.DbeaverImports.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.DbeaverImports.Features.InviteToDbeaver;

/// <summary>
/// RN-DBEAVER-018: `PUT api/user/connections/dbeaver/invite`, o convite do DBeaver como feito para este usuário, com a hora da API. 204 sem corpo; o que já tem
/// data fica com ela (o cofre nem é regravado).
/// </summary>
public sealed record InviteToDbeaverCommand : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class InviteToDbeaverHandler(IVaultService vaultService, TimeProvider timeProvider) : IRequestHandler<InviteToDbeaverCommand, UnitResult<ApiErrorDto>>
{
    public Task<UnitResult<ApiErrorDto>> Handle(InviteToDbeaverCommand request, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;

        return vaultService.SaveOrRefuse(document => DbeaverState.Invite(document, now), cancellationToken);
    }
}
