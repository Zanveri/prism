using FluentValidation;
using Prism.Application.ScriptFolders.Models;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.ScriptFolders.Features.CreateScriptFolder;

public sealed class CreateScriptFolderValidator : AbstractValidator<CreateScriptFolderCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>CreateScriptFolderValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(CreateScriptFolderValidator));

    public CreateScriptFolderValidator()
    {
        // RN-SCRIPT-007. O nome que uma pasta irmã já tem é 409 do repository, e não regra daqui.
        RuleFor(request => request.Name).Must(ScriptFolderRules.IsValidName).WithMessage(_ => Texts.Get("NameInvalid")).WithErrorCode("SCRIPT_FOLDER_NAME_INVALID");
    }
}
