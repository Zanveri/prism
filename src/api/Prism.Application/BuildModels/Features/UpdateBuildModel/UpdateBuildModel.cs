using CSharpFunctionalExtensions;
using Prism.Application.BuildModels.Models.Dtos;
using Prism.Application.BuildModels.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;

namespace Prism.Application.BuildModels.Features.UpdateBuildModel;

public sealed record UpdateBuildModelCommand : IRequest<Result<BuildModelDto, ApiErrorDto>>
{
    public Guid ID { get; init; }
    public string? Name { get; init; }
    public string? Body { get; init; }
    public DateTime ExpectedUpdatedAt { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprimiria o corpo do modelo.</summary>
    public override string ToString()
        => nameof(UpdateBuildModelCommand);
}

internal sealed class UpdateBuildModelHandler(IBuildModelRepository buildModelRepository, TimeProvider timeProvider) : IRequestHandler<UpdateBuildModelCommand, Result<BuildModelDto, ApiErrorDto>>
{
    public Task<Result<BuildModelDto, ApiErrorDto>> Handle(UpdateBuildModelCommand request, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;

        return buildModelRepository.Update(request.ID, request.Name, request.Body, request.ExpectedUpdatedAt, now, cancellationToken);
    }
}
