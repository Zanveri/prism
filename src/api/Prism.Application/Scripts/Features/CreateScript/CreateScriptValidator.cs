using FluentValidation;
using Prism.Application.Scripts.Models;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.Scripts.Features.CreateScript;

public sealed class CreateScriptValidator : AbstractValidator<CreateScriptCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>CreateScriptValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(CreateScriptValidator));

    public CreateScriptValidator()
    {
        // RN-SCRIPT-004. O nome que outro script já tem é 409 do repository, e não regra daqui.
        RuleFor(request => request.Name).Must(ScriptRules.IsValidName).WithMessage(_ => Texts.Get("NameInvalid")).WithErrorCode("SCRIPT_NAME_INVALID");
        RuleFor(request => request.Sql).Must(ScriptRules.FitsTheLimit).WithMessage(_ => Texts.Get("SqlTooLarge")).WithErrorCode("SCRIPT_TOO_LARGE");
    }
}
