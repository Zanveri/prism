using FluentValidation;

namespace Prism.Application.Users.Models;

/// <summary>
/// RN-COFRE-010: a senha do usuário tem de 8 a 128 caracteres, sem regra de composição. É uma regra só, da criação de conta e da troca de senha
/// (RN-COFRE-013: a senha nova segue EXATAMENTE as regras da criação): os dois validators a aplicam daqui, e nenhum repete o tamanho, a mensagem
/// nem o código.
/// </summary>
internal static class UserPasswordRules
{
    public static IRuleBuilderOptions<T, string> MustBeAValidPassword<T>(this IRuleBuilder<T, string> rule)
        => rule.Must(password => password is { Length: >= 8 and <= 128 }).WithMessage("A senha deve ter de 8 a 128 caracteres.").WithErrorCode("PASSWORD_INVALID");
}
