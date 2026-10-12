using FluentValidation;
using Prism.Application.Users.Models;

namespace Prism.Application.Users.Features.CreateUser;

public sealed class CreateUserValidator : AbstractValidator<CreateUserCommand>
{
    public CreateUserValidator()
    {
        // RN-COFRE-010. As regras rodam sobre o nome normalizado, que é o que o handler grava; o `Must`
        // aceita nulo (um corpo `{ "userName": null }`) e o recusa como qualquer outro nome inválido.
        RuleFor(request => request.UserName).Must(userName => UserNameRules.IsValid(UserNameRules.Normalize(userName))).WithMessage("Use de 3 a 32 caracteres: letras de a a z, números, ponto, hífen ou sublinhado, começando por letra ou número.").WithErrorCode("USERNAME_INVALID");

        // RN-COFRE-010: sem regra de composição, só o tamanho. A regra é a mesma da senha nova da troca de senha (RN-COFRE-013).
        RuleFor(request => request.Password).MustBeAValidPassword();
    }
}
