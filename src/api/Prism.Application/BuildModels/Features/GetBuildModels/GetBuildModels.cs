using CSharpFunctionalExtensions;
using Prism.Application.BuildModels.Models.Dtos;
using Prism.Application.Common.Vault;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.BuildModels.Features.GetBuildModels;

/// <summary>A lista dos modelos do Construir do usuário, com o corpo JSON (seção 7 da especificação: a lista mostra destino e contagens, que estão no corpo).</summary>
public sealed record GetBuildModelsCommand : IRequest<Result<IReadOnlyList<BuildModelDto>, ApiErrorDto>>;

internal sealed class GetBuildModelsHandler(IVaultService vaultService) : IRequestHandler<GetBuildModelsCommand, Result<IReadOnlyList<BuildModelDto>, ApiErrorDto>>
{
    public Task<Result<IReadOnlyList<BuildModelDto>, ApiErrorDto>> Handle(GetBuildModelsCommand request, CancellationToken cancellationToken)
    {
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<IReadOnlyList<BuildModelDto>, ApiErrorDto>(VaultErrors.From(read.Error)));

        var records = read.Value.BuildModels ?? [];
        IReadOnlyList<BuildModelDto> models = [.. records
            .OrderBy(model => model.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(model => model.ID)
            .Select(model => model.ToDto())];

        return Task.FromResult(Result.Success<IReadOnlyList<BuildModelDto>, ApiErrorDto>(models));
    }
}
