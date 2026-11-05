using FluentValidation;
using Prism.Application.ScriptFolders.Models;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.ScriptFolders.Features.UpdateScriptFolder;

public sealed class UpdateScriptFolderValidator : AbstractValidator<UpdateScriptFolderCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>UpdateScriptFolderValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(UpdateScriptFolderValidator));

    public UpdateScriptFolderValidator()
    {
        // RN-SCRIPT-007: a mesma regra da criação. A pasta e a pasta pai que não existem são 404 do repository, e o ciclo e o nome repetido, 409.
        RuleFor(request => request.Name).Must(ScriptFolderRules.IsValidName).WithMessage(_ => Texts.Get("NameInvalid")).WithErrorCode("SCRIPT_FOLDER_NAME_INVALID");
    }
}
