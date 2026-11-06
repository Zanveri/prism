using CSharpFunctionalExtensions;
using Prism.Application.BuildModels.Models;
using Prism.Application.BuildModels.Models.Dtos;
using Prism.Application.Common.Vault;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.BuildModels.Features.GetBuildModel;

public sealed record GetBuildModelCommand(Guid ID) : IRequest<Result<BuildModelDto, ApiErrorDto>>;

internal sealed class GetBuildModelHandler(IVaultService vaultService) : IRequestHandler<GetBuildModelCommand, Result<BuildModelDto, ApiErrorDto>>
{
    public Task<Result<BuildModelDto, ApiErrorDto>> Handle(GetBuildModelCommand request, CancellationToken cancellationToken)
    {
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<BuildModelDto, ApiErrorDto>(VaultErrors.From(read.Error)));

        var records = read.Value.BuildModels ?? [];
        var record = records.FirstOrDefault(model => model.ID == request.ID);
        if (record is null)
            return Task.FromResult(Result.Failure<BuildModelDto, ApiErrorDto>(BuildModelErrors.NotFound(request.ID)));

        return Task.FromResult(Result.Success<BuildModelDto, ApiErrorDto>(record.ToDto()));
    }
}
