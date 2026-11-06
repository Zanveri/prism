using FluentValidation;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.Users.Models;

/// <summary>
/// RN-COFRE-010: a senha do usuário tem de 8 a 128 caracteres, sem regra de composição. É uma regra só, da criação de conta e da troca de senha
/// (RN-COFRE-013: a senha nova segue EXATAMENTE as regras da criação): os dois validators a aplicam daqui, e nenhum repete o tamanho, a mensagem
/// nem o código.
/// </summary>
internal static class UserPasswordRules
{
    /// <summary>Os textos, no idioma do pedido: <c>UserPasswordRules.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(UserPasswordRules));

    public static IRuleBuilderOptions<T, string> MustBeAValidPassword<T>(this IRuleBuilder<T, string> rule)
        => rule.Must(password => password is { Length: >= 8 and <= 128 }).WithMessage(_ => Texts.Get("PasswordInvalid")).WithErrorCode("PASSWORD_INVALID");
}
