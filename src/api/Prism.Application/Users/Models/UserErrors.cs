using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.Users.Models;

internal static class UserErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>UserErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(UserErrors));

    /// <summary>Criar por cima apagaria o cofre de quem já está lá, então a recusa vale também para o arquivo ilegível (seção 7 da especificação).</summary>
    public static ApiErrorDto AlreadyExists()
        => ApiErrorDto.CreateConflict(Texts.Get("AlreadyExistsTitle"), "USER_ALREADY_EXISTS", Texts.Get("AlreadyExistsDetail"));

    /// <summary>
    /// RN-COFRE-013. 422 `INVALID_PASSWORD`, o MESMO código que a revelação de senha usa para a senha do usuário errada (`ConnectionErrors.InvalidPassword`,
    /// com o mesmo título), e não o 401 da entrada: a chamada já está autenticada, e a tela renova a sessão e repete todo 401. O detalhe diz só que a senha
    /// atual não confere. Na forma do filtro de validação (`errors` e `errorCodes` por campo, com o nome da propriedade em PascalCase como nas outras
    /// rotas), para a tela mostrar a mensagem no campo da senha atual. `PASSWORD_INVALID` é a senha NOVA inválida, que é do validator.
    /// </summary>
    public static ApiErrorDto CurrentPasswordInvalid()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("CurrentPasswordInvalidTitle"), "INVALID_PASSWORD", "CurrentPassword", Texts.Get("CurrentPasswordInvalidDetail"));

    /// <summary>RN-COFRE-013: a senha nova é igual à atual. No campo da senha nova.</summary>
    public static ApiErrorDto PasswordUnchanged()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("PasswordUnchangedTitle"), "PASSWORD_UNCHANGED", "NewPassword", Texts.Get("PasswordUnchangedDetail"));
}
