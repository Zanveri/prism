using FluentValidation;
using Prism.Application.ScriptFolders.Models;

namespace Prism.Application.ScriptFolders.Features.UpdateScriptFolder;

public sealed class UpdateScriptFolderValidator : AbstractValidator<UpdateScriptFolderCommand>
{
    public UpdateScriptFolderValidator()
    {
        // RN-SCRIPT-007: a mesma regra da criação. A pasta e a pasta pai que não existem são 404 do repository, e o ciclo e o nome repetido, 409.
        RuleFor(request => request.Name).Must(ScriptFolderRules.IsValidName).WithMessage("O nome da pasta deve ter de 1 a 60 caracteres, sem caractere de controle.").WithErrorCode("SCRIPT_FOLDER_NAME_INVALID");
    }
}
