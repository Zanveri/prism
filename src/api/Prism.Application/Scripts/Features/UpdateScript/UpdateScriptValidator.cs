using FluentValidation;
using Prism.Application.Common.Environments;
using Prism.Application.Scripts.Models;

namespace Prism.Application.Scripts.Features.UpdateScript;

public sealed class UpdateScriptValidator : AbstractValidator<UpdateScriptCommand>
{
    public UpdateScriptValidator()
    {
        // RN-SCRIPT-004, só no que veio: o ausente fica como está. O ID que não existe é 404 do repository.
        RuleFor(request => request.Name).Must(ScriptRules.IsValidName).When(request => request.Name is not null).WithMessage("O nome do script deve ter de 1 a 200 caracteres, sem caractere de controle.").WithErrorCode("SCRIPT_NAME_INVALID");
        RuleFor(request => request.Sql).Must(ScriptRules.FitsTheLimit).WithMessage("O SQL do script passa de 1 MB.").WithErrorCode("SCRIPT_TOO_LARGE");

        // RN-SCRIPT-005: o script genérico não tem lugar. Pedir o genérico e um lugar ao mesmo tempo é contradição, e não "o genérico ganha".
        RuleFor(request => request.ConnectionID).Null().When(request => request.Generic).WithMessage("O script genérico não tem conexão nem banco.").WithErrorCode("SCRIPT_PLACE_INVALID");
        RuleFor(request => request.Database).Null().When(request => request.Generic).WithMessage("O script genérico não tem conexão nem banco.").WithErrorCode("SCRIPT_PLACE_INVALID");

        // RN-SCRIPT-006: o ícone é um da lista fechada, e a cor dele é `#RRGGBB`, a regra da cor do ambiente. O vazio volta ao padrão, e o ausente fica.
        RuleFor(request => request.Icon).Must(ScriptRules.IsKnownIcon).WithMessage("Escolha um dos ícones da lista.").WithErrorCode("SCRIPT_ICON_INVALID");
        RuleFor(request => request.Color).MustBeAnEnvironmentColor().WithErrorCode("SCRIPT_ICON_INVALID");
    }
}
