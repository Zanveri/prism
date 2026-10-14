using FluentValidation;
using Prism.Application.Common.Environments;
using Prism.Core.Extensions;

namespace Prism.Application.Folders.Features.CreateFolder;

public sealed class CreateFolderValidator : AbstractValidator<CreateFolderCommand>
{
    public CreateFolderValidator()
    {
        // RN-PASTA-001: de 1 a 60 caracteres, medidos sobre o nome normalizado, que é o que o handler grava.
        // O `NormalizeName` aceita nulo (um corpo sem o campo chega vazio, e o `null` explícito o MVC já recusa).
        RuleFor(request => request.Name).Must(name => name.NormalizeName().Length is >= 1 and <= 60).WithMessage("O nome da pasta deve ter de 1 a 60 caracteres.").WithErrorCode("FOLDER_NAME_INVALID");

        // RN-PASTA-005: o ambiente tem as regras do ambiente da conexão, e a recusa vai no código das pastas, no campo de cada um.
        RuleFor(request => request.EnvironmentName).MustBeAnEnvironmentName().WithErrorCode("FOLDER_NAME_INVALID");
        RuleFor(request => request.EnvironmentColor).MustBeAnEnvironmentColor().WithErrorCode("FOLDER_NAME_INVALID");
    }
}
