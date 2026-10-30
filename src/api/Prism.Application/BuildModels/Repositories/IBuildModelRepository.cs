using CSharpFunctionalExtensions;
using Prism.Application.BuildModels.Models.Dtos;
using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.BuildModels.Repositories;

public interface IBuildModelRepository
{
    Task<UnitResult<ApiErrorDto>> Insert(BuildModelDto model, CancellationToken cancellationToken);
    Task<Result<BuildModelDto, ApiErrorDto>> Update(Guid id, string? name, string? body, DateTime expectedUpdatedAt, DateTime now, CancellationToken cancellationToken);
    Task<UnitResult<ApiErrorDto>> Delete(Guid id, CancellationToken cancellationToken);
}
