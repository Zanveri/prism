using FluentValidation;
using Prism.Application.BuildModels.Models;

namespace Prism.Application.BuildModels.Features.CreateBuildModel;

public sealed class CreateBuildModelValidator : AbstractValidator<CreateBuildModelCommand>
{
    public CreateBuildModelValidator()
    {
        RuleFor(request => request.Name)
            .Must(BuildModelRules.IsValidName)
            .WithMessage("O nome do modelo deve ter de 1 a 200 caracteres, sem caractere de controle.")
            .WithErrorCode("BUILD_MODEL_NAME_INVALID");

        RuleFor(request => request.Body)
            .Cascade(CascadeMode.Stop)
            .Must(BuildModelRules.FitsTheLimit)
            .WithMessage("O modelo passa de 4 MB.")
            .WithErrorCode("BUILD_MODEL_TOO_LARGE")
            .Must(BuildModelRules.IsJsonObject)
            .WithMessage("O modelo não é um objeto JSON.")
            .WithErrorCode("BUILD_MODEL_BODY_INVALID");
    }
}
