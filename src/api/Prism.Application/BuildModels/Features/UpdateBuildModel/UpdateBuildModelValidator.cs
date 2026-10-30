using FluentValidation;
using Prism.Application.BuildModels.Models;

namespace Prism.Application.BuildModels.Features.UpdateBuildModel;

public sealed class UpdateBuildModelValidator : AbstractValidator<UpdateBuildModelCommand>
{
    public UpdateBuildModelValidator()
    {
        RuleFor(request => request.Name)
            .Must(BuildModelRules.IsValidName)
            .When(request => request.Name is not null)
            .WithMessage("O nome do modelo deve ter de 1 a 200 caracteres, sem caractere de controle.")
            .WithErrorCode("BUILD_MODEL_NAME_INVALID");

        RuleFor(request => request.Body)
            .Cascade(CascadeMode.Stop)
            .Must(BuildModelRules.FitsTheLimit)
            .WithMessage("O modelo passa de 4 MB.")
            .WithErrorCode("BUILD_MODEL_TOO_LARGE")
            .Must(BuildModelRules.IsJsonObject)
            .WithMessage("O modelo não é um objeto JSON.")
            .WithErrorCode("BUILD_MODEL_BODY_INVALID")
            .When(request => request.Body is not null);
    }
}
