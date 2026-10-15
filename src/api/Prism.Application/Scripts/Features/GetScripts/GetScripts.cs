using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Scripts.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Scripts.Features.GetScripts;

/// <summary>A lista inteira dos scripts do usuário, sem paginação e sem o SQL (RN-SCRIPT-003: a seção "Scripts" do navegador).</summary>
public sealed record GetScriptsCommand : IRequest<Result<IReadOnlyList<ScriptSummaryDto>, ApiErrorDto>>;

internal sealed class GetScriptsHandler(IVaultService vaultService) : IRequestHandler<GetScriptsCommand, Result<IReadOnlyList<ScriptSummaryDto>, ApiErrorDto>>
{
    public Task<Result<IReadOnlyList<ScriptSummaryDto>, ApiErrorDto>> Handle(GetScriptsCommand request, CancellationToken cancellationToken)
    {
        // Uma lista vazia seria a resposta errada para um cofre fechado.
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<IReadOnlyList<ScriptSummaryDto>, ApiErrorDto>(VaultErrors.From(read.Error)));

        // RN-SCRIPT-003: em ordem de nome, sem diferenciar maiúsculas; o ID (Guid v7) desempata.
        IReadOnlyList<ScriptSummaryDto> scripts = [.. read.Value.Scripts.OrderBy(script => script.Name, StringComparer.OrdinalIgnoreCase).ThenBy(script => script.ID).Select(script => script.ToSummaryDto())];

        return Task.FromResult(Result.Success<IReadOnlyList<ScriptSummaryDto>, ApiErrorDto>(scripts));
    }
}
