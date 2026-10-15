using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Scripts.Models;
using Prism.Application.Scripts.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Scripts.Features.GetScript;

public sealed record GetScriptCommand(Guid ID) : IRequest<Result<ScriptDto, ApiErrorDto>>;

internal sealed class GetScriptHandler(IVaultService vaultService) : IRequestHandler<GetScriptCommand, Result<ScriptDto, ApiErrorDto>>
{
    public Task<Result<ScriptDto, ApiErrorDto>> Handle(GetScriptCommand request, CancellationToken cancellationToken)
    {
        // A leitura carrega a falha do cofre: fechado é 401, e só um documento lido sem o script é 404.
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<ScriptDto, ApiErrorDto>(VaultErrors.From(read.Error)));

        var record = read.Value.Scripts.FirstOrDefault(script => script.ID == request.ID);
        if (record is null)
            return Task.FromResult(Result.Failure<ScriptDto, ApiErrorDto>(ScriptErrors.NotFound(request.ID)));

        return Task.FromResult(Result.Success<ScriptDto, ApiErrorDto>(record.ToDto()));
    }
}
