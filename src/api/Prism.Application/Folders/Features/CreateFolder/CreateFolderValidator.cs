using FluentValidation;
using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Application.Common.Texts;
using Prism.Application.Folders.Models;

namespace Prism.Application.Folders.Features.CreateFolder;

public sealed class CreateFolderValidator : AbstractValidator<CreateFolderCommand>
{
    public CreateFolderValidator()
    {
        // RN-PASTA-001: de 1 a 60 caracteres, medidos sobre o nome normalizado, que é o que o handler grava, e sem caractere de controle nem de direção do
        // texto (`FolderRules`, a regra que a importação de conexões também aplica).
        // O `NormalizeName` aceita nulo (um corpo sem o campo chega vazio, e o `null` explícito o MVC já recusa).
        RuleFor(request => request.Name).MustPass(FolderRules.NameRefusal).WithErrorCode("FOLDER_NAME_INVALID");

        // RN-PASTA-005: o ambiente tem as regras do ambiente da conexão (também sem caractere de controle nem de direção do texto, RN-PASTA-001), e a
        // recusa vai no código das pastas, no campo de cada um.
        RuleFor(request => request.EnvironmentName).MustBeAnEnvironmentName().WithErrorCode("FOLDER_NAME_INVALID");
        RuleFor(request => request.EnvironmentColor).MustBeAnEnvironmentColor().WithErrorCode("FOLDER_NAME_INVALID");

        // RN-PASTA-007: a cor da pasta é `#RRGGBB`, como a do ambiente, e a recusa vai no mesmo código, no campo dela.
        RuleFor(request => request.Color).MustBeAnEnvironmentColor().WithErrorCode("FOLDER_NAME_INVALID");

        // RN-PROT-001: a confirmação é uma da lista, com a regra da conexão, e a recusa vai no código das pastas, no campo dela.
        RuleFor(request => request.ConfirmCommands).MustBeAConfirmation().WithErrorCode("FOLDER_NAME_INVALID");
    }
}
