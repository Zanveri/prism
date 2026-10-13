using FluentValidation;
using Prism.Application.Scripts.Models;

namespace Prism.Application.Scripts.Features.UpdateScript;

public sealed class UpdateScriptValidator : AbstractValidator<UpdateScriptCommand>
{
    public UpdateScriptValidator()
    {
        // RN-SCRIPT-004, só no que veio: o ausente fica como está. O ID que não existe é 404 do repository.
        RuleFor(request => request.Name).Must(ScriptRules.IsValidName).When(request => request.Name is not null).WithMessage("O nome do script deve ter de 1 a 200 caracteres, sem caractere de controle.").WithErrorCode("SCRIPT_NAME_INVALID");
        RuleFor(request => request.Sql).Must(ScriptRules.FitsTheLimit).WithMessage("O SQL do script passa de 1 MB.").WithErrorCode("SCRIPT_TOO_LARGE");
    }
}
