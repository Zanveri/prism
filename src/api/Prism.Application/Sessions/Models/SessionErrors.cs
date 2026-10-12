using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.Sessions.Models;

internal static class SessionErrors
{
    /// <summary>
    /// RN-COFRE-006: a mesma frase para usuário inexistente, senha errada, nome fora das regras e cofre
    /// ilegível. Separar contaria a quem tenta se o usuário existe.
    /// </summary>
    public static ApiErrorDto InvalidCredentials()
        => ApiErrorDto.CreateUnauthorized("Usuário ou senha inválidos.", "INVALID_CREDENTIALS", "Confira o usuário e a senha e tente de novo.");
}
