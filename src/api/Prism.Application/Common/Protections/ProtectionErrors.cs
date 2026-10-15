using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.Common.Protections;

/// <summary>
/// RN-PROT-003: as recusas da senha do somente leitura, na pasta e na conexão. As duas vão no campo `UserPassword`, na forma do filtro de validação
/// (`errors` e `errorCodes`), para a tela mostrar a mensagem no diálogo da senha.
/// </summary>
internal static class ProtectionErrors
{
    /// <summary>A alteração pede a senha, e ela não veio. Nada foi conferido nem contado.</summary>
    public static ApiErrorDto PasswordRequired()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Senha do usuário necessária.", "USER_PASSWORD_REQUIRED", "UserPassword", "Para marcar ou desmarcar \"Somente leitura\", ou para tirar uma conexão de uma pasta somente leitura, informe a sua senha do Prism.");

    /// <summary>
    /// A senha não confere. O MESMO código e o mesmo título da revelação da senha e da troca de senha (`ConnectionErrors.InvalidPassword` e
    /// `UserErrors.CurrentPasswordInvalid`): a conferência e a contagem de erros são as delas.
    /// </summary>
    public static ApiErrorDto InvalidPassword()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Senha incorreta.", "INVALID_PASSWORD", "UserPassword", "A senha informada não é a do seu usuário no Prism.");
}
