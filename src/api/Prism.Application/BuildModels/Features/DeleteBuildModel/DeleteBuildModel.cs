using CSharpFunctionalExtensions;
using Prism.Application.BuildModels.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;

namespace Prism.Application.BuildModels.Features.DeleteBuildModel;

public sealed record DeleteBuildModelCommand(Guid ID) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class DeleteBuildModelHandler(IBuildModelRepository buildModelRepository) : IRequestHandler<DeleteBuildModelCommand, UnitResult<ApiErrorDto>>
{
    public Task<UnitResult<ApiErrorDto>> Handle(DeleteBuildModelCommand request, CancellationToken cancellationToken)
        => buildModelRepository.Delete(request.ID, cancellationToken);
}
