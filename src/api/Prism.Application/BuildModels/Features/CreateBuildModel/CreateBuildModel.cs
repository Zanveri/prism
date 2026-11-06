using CSharpFunctionalExtensions;
using Prism.Application.BuildModels.Models.Dtos;
using Prism.Application.BuildModels.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Application.BuildModels.Features.CreateBuildModel;

public sealed record CreateBuildModelCommand : IRequest<Result<BuildModelDto, ApiErrorDto>>
{
    public string Name { get; init; } = string.Empty;
    public string Body { get; init; } = string.Empty;

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprimiria o corpo do modelo.</summary>
    public override string ToString()
        => nameof(CreateBuildModelCommand);
}

internal sealed class CreateBuildModelHandler(IBuildModelRepository buildModelRepository, TimeProvider timeProvider) : IRequestHandler<CreateBuildModelCommand, Result<BuildModelDto, ApiErrorDto>>
{
    public async Task<Result<BuildModelDto, ApiErrorDto>> Handle(CreateBuildModelCommand request, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var model = new BuildModelDto
        {
            ID = Guid.CreateVersion7(),
            Name = request.Name.NormalizeName(),
            Body = request.Body,
            CreatedAt = now,
            UpdatedAt = now,
        };

        var inserted = await buildModelRepository.Insert(model, cancellationToken);
        if (inserted.IsFailure)
            return Result.Failure<BuildModelDto, ApiErrorDto>(inserted.Error);

        return Result.Success<BuildModelDto, ApiErrorDto>(model);
    }
}
