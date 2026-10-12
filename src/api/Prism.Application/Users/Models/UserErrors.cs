using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.Users.Models;

internal static class UserErrors
{
    /// <summary>Criar por cima apagaria o cofre de quem já está lá, então a recusa vale também para o arquivo ilegível (seção 7 da especificação).</summary>
    public static ApiErrorDto AlreadyExists()
        => ApiErrorDto.CreateConflict("Usuário já existe.", "USER_ALREADY_EXISTS", "Já existe um usuário com este nome neste computador. Escolha outro nome ou entre com ele.");

    /// <summary>
    /// RN-COFRE-013. 422 `INVALID_PASSWORD`, o MESMO código que a revelação de senha usa para a senha do usuário errada (`ConnectionErrors.InvalidPassword`,
    /// com o mesmo título), e não o 401 da entrada: a chamada já está autenticada, e a tela renova a sessão e repete todo 401. O detalhe diz só que a senha
    /// atual não confere. Na forma do filtro de validação (`errors` e `errorCodes` por campo, com o nome da propriedade em PascalCase como nas outras
    /// rotas), para a tela mostrar a mensagem no campo da senha atual. `PASSWORD_INVALID` é a senha NOVA inválida, que é do validator.
    /// </summary>
    public static ApiErrorDto CurrentPasswordInvalid()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Senha incorreta.", "INVALID_PASSWORD", "CurrentPassword", "A senha atual não confere.");

    /// <summary>RN-COFRE-013: a senha nova é igual à atual. No campo da senha nova.</summary>
    public static ApiErrorDto PasswordUnchanged()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Senha nova igual à atual.", "PASSWORD_UNCHANGED", "NewPassword", "A nova senha deve ser diferente da atual.");
}
