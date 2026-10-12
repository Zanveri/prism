using FluentValidation;
using Prism.Application.Users.Models;

namespace Prism.Application.Users.Features.ChangePassword;

public sealed class ChangePasswordValidator : AbstractValidator<ChangePasswordCommand>
{
    public ChangePasswordValidator()
    {
        // RN-COFRE-013: a senha nova segue as regras da criação de conta (RN-COFRE-010), que moram em `UserPasswordRules`. A senha atual não é validada:
        // qualquer texto é só uma senha errada, e responde com a derivação do cofre, como uma entrada errada. Um 422 de formato antes dela dispensaria a
        // derivação e diria a quem tenta como é uma senha válida.
        RuleFor(request => request.NewPassword).MustBeAValidPassword();
    }
}
