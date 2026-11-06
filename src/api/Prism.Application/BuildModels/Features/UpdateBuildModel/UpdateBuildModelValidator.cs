using FluentValidation;
using Prism.Application.BuildModels.Models;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.BuildModels.Features.UpdateBuildModel;

public sealed class UpdateBuildModelValidator : AbstractValidator<UpdateBuildModelCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>UpdateBuildModelValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(UpdateBuildModelValidator));

    public UpdateBuildModelValidator()
    {
        RuleFor(request => request.Name)
            .Must(BuildModelRules.IsValidName)
            .When(request => request.Name is not null)
            .WithMessage(_ => Texts.Get("NameInvalid"))
            .WithErrorCode("BUILD_MODEL_NAME_INVALID");

        RuleFor(request => request.Body)
            .Cascade(CascadeMode.Stop)
            .Must(BuildModelRules.FitsTheLimit)
            .WithMessage(_ => Texts.Get("BodyTooLarge"))
            .WithErrorCode("BUILD_MODEL_TOO_LARGE")
            .Must(BuildModelRules.IsJsonObject)
            .WithMessage(_ => Texts.Get("BodyNotAnObject"))
            .WithErrorCode("BUILD_MODEL_BODY_INVALID")
            .When(request => request.Body is not null);
    }
}
