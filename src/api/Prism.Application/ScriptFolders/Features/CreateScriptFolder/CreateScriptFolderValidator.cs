using FluentValidation;
using Prism.Application.ScriptFolders.Models;

namespace Prism.Application.ScriptFolders.Features.CreateScriptFolder;

public sealed class CreateScriptFolderValidator : AbstractValidator<CreateScriptFolderCommand>
{
    public CreateScriptFolderValidator()
    {
        // RN-SCRIPT-007. O nome que uma pasta irmã já tem é 409 do repository, e não regra daqui.
        RuleFor(request => request.Name).Must(ScriptFolderRules.IsValidName).WithMessage("O nome da pasta deve ter de 1 a 60 caracteres, sem caractere de controle.").WithErrorCode("SCRIPT_FOLDER_NAME_INVALID");
    }
}
