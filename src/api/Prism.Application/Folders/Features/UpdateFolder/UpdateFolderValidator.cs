using FluentValidation;
using Prism.Application.Common.Environments;
using Prism.Core.Extensions;

namespace Prism.Application.Folders.Features.UpdateFolder;

public sealed class UpdateFolderValidator : AbstractValidator<UpdateFolderCommand>
{
    public UpdateFolderValidator()
    {
        // RN-PASTA-001: a mesma regra da criação, sobre o nome normalizado. O ID e a pasta pai que não existem são 404 do handler, e não regra daqui.
        RuleFor(request => request.Name).Must(name => name.NormalizeName().Length is >= 1 and <= 60).WithMessage("O nome da pasta deve ter de 1 a 60 caracteres.").WithErrorCode("FOLDER_NAME_INVALID");

        // RN-PASTA-005: o ambiente tem as regras do ambiente da conexão, e a recusa vai no código das pastas, no campo de cada um.
        RuleFor(request => request.EnvironmentName).MustBeAnEnvironmentName().WithErrorCode("FOLDER_NAME_INVALID");
        RuleFor(request => request.EnvironmentColor).MustBeAnEnvironmentColor().WithErrorCode("FOLDER_NAME_INVALID");

        // RN-PASTA-007: a cor da pasta é `#RRGGBB`, como a do ambiente, e a recusa vai no mesmo código, no campo dela.
        RuleFor(request => request.Color).MustBeAnEnvironmentColor().WithErrorCode("FOLDER_NAME_INVALID");
    }
}
