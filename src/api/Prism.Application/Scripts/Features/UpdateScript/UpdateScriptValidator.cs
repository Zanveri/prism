using FluentValidation;
using Prism.Application.Common.Environments;
using Prism.Application.Scripts.Models;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.Scripts.Features.UpdateScript;

public sealed class UpdateScriptValidator : AbstractValidator<UpdateScriptCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>UpdateScriptValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(UpdateScriptValidator));

    public UpdateScriptValidator()
    {
        // RN-SCRIPT-004, só no que veio: o ausente fica como está. O ID que não existe é 404 do repository.
        RuleFor(request => request.Name).Must(ScriptRules.IsValidName).When(request => request.Name is not null).WithMessage(_ => Texts.Get("NameInvalid")).WithErrorCode("SCRIPT_NAME_INVALID");
        RuleFor(request => request.Sql).Must(ScriptRules.FitsTheLimit).WithMessage(_ => Texts.Get("SqlTooLarge")).WithErrorCode("SCRIPT_TOO_LARGE");

        // RN-SCRIPT-005: o script genérico não tem lugar. Pedir o genérico e um lugar ao mesmo tempo é contradição, e não "o genérico ganha".
        RuleFor(request => request.ConnectionID).Null().When(request => request.Generic).WithMessage(_ => Texts.Get("GenericHasNoPlace")).WithErrorCode("SCRIPT_PLACE_INVALID");
        RuleFor(request => request.Database).Null().When(request => request.Generic).WithMessage(_ => Texts.Get("GenericHasNoPlace")).WithErrorCode("SCRIPT_PLACE_INVALID");

        // RN-SCRIPT-009: o script vai para uma pasta ou para a raiz, não para as duas. Pedir as duas é contradição, e não "a raiz ganha".
        RuleFor(request => request.FolderID).Null().When(request => request.Root).WithMessage(_ => Texts.Get("FolderOrRoot")).WithErrorCode("SCRIPT_PLACE_INVALID");

        // RN-SCRIPT-006: o ícone é um da lista fechada, e a cor dele é `#RRGGBB`, a regra da cor do ambiente. O vazio volta ao padrão, e o ausente fica.
        RuleFor(request => request.Icon).Must(ScriptRules.IsKnownIcon).WithMessage(_ => Texts.Get("IconInvalid")).WithErrorCode("SCRIPT_ICON_INVALID");
        RuleFor(request => request.Color).MustBeAnEnvironmentColor().WithErrorCode("SCRIPT_ICON_INVALID");
    }
}
