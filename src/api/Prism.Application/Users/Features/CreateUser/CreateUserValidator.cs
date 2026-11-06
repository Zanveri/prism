using FluentValidation;
using Prism.Application.Users.Models;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.Users.Features.CreateUser;

public sealed class CreateUserValidator : AbstractValidator<CreateUserCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>CreateUserValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(CreateUserValidator));

    public CreateUserValidator()
    {
        // RN-COFRE-010. As regras rodam sobre o nome normalizado, que é o que o handler grava; o `Must`
        // aceita nulo (um corpo `{ "userName": null }`) e o recusa como qualquer outro nome inválido.
        RuleFor(request => request.UserName).Must(userName => UserNameRules.IsValid(UserNameRules.Normalize(userName))).WithMessage(_ => Texts.Get("UserNameInvalid")).WithErrorCode("USERNAME_INVALID");

        // RN-COFRE-010: sem regra de composição, só o tamanho. A regra é a mesma da senha nova da troca de senha (RN-COFRE-013).
        RuleFor(request => request.Password).MustBeAValidPassword();
    }
}
