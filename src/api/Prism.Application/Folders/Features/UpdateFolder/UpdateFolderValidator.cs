using FluentValidation;
using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Application.Common.Texts;
using Prism.Application.Folders.Models;

namespace Prism.Application.Folders.Features.UpdateFolder;

public sealed class UpdateFolderValidator : AbstractValidator<UpdateFolderCommand>
{
    public UpdateFolderValidator()
    {
        // RN-PASTA-001: a mesma regra da criação (`FolderRules`), sobre o nome normalizado. O ID e a pasta pai que não existem são 404 do handler, e não regra daqui.
        RuleFor(request => request.Name).MustPass(FolderRules.NameRefusal).WithErrorCode("FOLDER_NAME_INVALID");

        // RN-PASTA-005: o ambiente tem as regras do ambiente da conexão (também sem caractere de controle nem de direção do texto, RN-PASTA-001), e a
        // recusa vai no código das pastas, no campo de cada um.
        RuleFor(request => request.EnvironmentName).MustBeAnEnvironmentName().WithErrorCode("FOLDER_NAME_INVALID");
        RuleFor(request => request.EnvironmentColor).MustBeAnEnvironmentColor().WithErrorCode("FOLDER_NAME_INVALID");

        // RN-PASTA-007: a cor da pasta é `#RRGGBB`, como a do ambiente, e a recusa vai no mesmo código, no campo dela.
        RuleFor(request => request.Color).MustBeAnEnvironmentColor().WithErrorCode("FOLDER_NAME_INVALID");

        // RN-PROT-001: a confirmação é uma da lista, com a regra da conexão. A senha do usuário (RN-PROT-003) não é regra daqui: quem diz se ela é
        // pedida, e a confere, é a gravação.
        RuleFor(request => request.ConfirmCommands).MustBeAConfirmation().WithErrorCode("FOLDER_NAME_INVALID");
    }
}
