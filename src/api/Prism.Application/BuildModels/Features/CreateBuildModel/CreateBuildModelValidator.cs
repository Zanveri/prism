using FluentValidation;
using Prism.Application.BuildModels.Models;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.BuildModels.Features.CreateBuildModel;

public sealed class CreateBuildModelValidator : AbstractValidator<CreateBuildModelCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>CreateBuildModelValidator.resx</c> (português) e as traduções ao lado. A mensagem é lida na validação, e não na construção.</summary>
    private static readonly ResourceManager Texts = new(typeof(CreateBuildModelValidator));

    public CreateBuildModelValidator()
    {
        RuleFor(request => request.Name)
            .Must(BuildModelRules.IsValidName)
            .WithMessage(_ => Texts.Get("NameInvalid"))
            .WithErrorCode("BUILD_MODEL_NAME_INVALID");

        RuleFor(request => request.Body)
            .Cascade(CascadeMode.Stop)
            .Must(BuildModelRules.FitsTheLimit)
            .WithMessage(_ => Texts.Get("BodyTooLarge"))
            .WithErrorCode("BUILD_MODEL_TOO_LARGE")
            .Must(BuildModelRules.IsJsonObject)
            .WithMessage(_ => Texts.Get("BodyNotAnObject"))
            .WithErrorCode("BUILD_MODEL_BODY_INVALID");
    }
}
