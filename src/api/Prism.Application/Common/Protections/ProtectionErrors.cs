using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.Common.Protections;

/// <summary>
/// RN-PROT-003: as recusas da senha do somente leitura, na pasta e na conexão. As duas vão no campo `UserPassword`, na forma do filtro de validação
/// (`errors` e `errorCodes`), para a tela mostrar a mensagem no diálogo da senha.
/// </summary>
internal static class ProtectionErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>ProtectionErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(ProtectionErrors));

    /// <summary>A alteração pede a senha, e ela não veio. Nada foi conferido nem contado.</summary>
    public static ApiErrorDto PasswordRequired()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("PasswordRequiredTitle"), "USER_PASSWORD_REQUIRED", "UserPassword", Texts.Get("PasswordRequiredDetail"));

    /// <summary>
    /// A senha não confere. O MESMO código e o mesmo título da revelação da senha e da troca de senha (`ConnectionErrors.InvalidPassword` e
    /// `UserErrors.CurrentPasswordInvalid`): a conferência e a contagem de erros são as delas.
    /// </summary>
    public static ApiErrorDto InvalidPassword()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("InvalidPasswordTitle"), "INVALID_PASSWORD", "UserPassword", Texts.Get("InvalidPasswordDetail"));
}
