using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.Sessions.Models;

internal static class SessionErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>SessionErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(SessionErrors));

    /// <summary>
    /// RN-COFRE-006: a mesma frase para usuário inexistente, senha errada, nome fora das regras e cofre
    /// ilegível. Separar contaria a quem tenta se o usuário existe.
    /// </summary>
    public static ApiErrorDto InvalidCredentials()
        => ApiErrorDto.CreateUnauthorized(Texts.Get("InvalidCredentialsTitle"), "INVALID_CREDENTIALS", Texts.Get("InvalidCredentialsDetail"));
}
