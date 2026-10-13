using FluentValidation;
using Prism.Application.Scripts.Models;

namespace Prism.Application.Scripts.Features.CreateScript;

public sealed class CreateScriptValidator : AbstractValidator<CreateScriptCommand>
{
    public CreateScriptValidator()
    {
        // RN-SCRIPT-004. O nome que outro script já tem é 409 do repository, e não regra daqui.
        RuleFor(request => request.Name).Must(ScriptRules.IsValidName).WithMessage("O nome do script deve ter de 1 a 200 caracteres, sem caractere de controle.").WithErrorCode("SCRIPT_NAME_INVALID");
        RuleFor(request => request.Sql).Must(ScriptRules.FitsTheLimit).WithMessage("O SQL do script passa de 1 MB.").WithErrorCode("SCRIPT_TOO_LARGE");
    }
}
