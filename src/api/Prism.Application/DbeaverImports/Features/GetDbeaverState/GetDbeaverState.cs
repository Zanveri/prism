using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.DbeaverImports.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.DbeaverImports.Features.GetDbeaverState;

/// <summary>RN-DBEAVER-018: `GET api/user/connections/dbeaver`, o convite e a última importação deste usuário. Nada gravado é `{ invitedAt: null, lastImportAt: null }`.</summary>
public sealed record GetDbeaverStateCommand : IRequest<Result<DbeaverStateDto, ApiErrorDto>>;

internal sealed class GetDbeaverStateHandler(IVaultService vaultService) : IRequestHandler<GetDbeaverStateCommand, Result<DbeaverStateDto, ApiErrorDto>>
{
    public Task<Result<DbeaverStateDto, ApiErrorDto>> Handle(GetDbeaverStateCommand request, CancellationToken cancellationToken)
    {
        // Um estado vazio seria a resposta errada para um cofre fechado: a tela convidaria quem já foi convidado.
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<DbeaverStateDto, ApiErrorDto>(VaultErrors.From(read.Error)));

        var dbeaver = read.Value.Dbeaver;

        return Task.FromResult(Result.Success<DbeaverStateDto, ApiErrorDto>(new DbeaverStateDto { InvitedAt = dbeaver?.InvitedAt, LastImportAt = dbeaver?.LastImportAt }));
    }
}
