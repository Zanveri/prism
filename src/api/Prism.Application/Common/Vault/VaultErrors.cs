using Prism.Application.Sessions.Models;
using Prism.Application.Users.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using System.Net;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.Common.Vault;

/// <summary>
/// A tradução das recusas do serviço do cofre (`EVaultError`) para o erro da API, num lugar só: qualquer
/// handler que fale com o cofre responde a mesma falha do mesmo jeito. Os códigos são os da seção 6 da
/// especificação (e os da RN-COFRE-013, na seção 19). `Locked`, `Unavailable` e `FormatUnsupported` não são
/// de um recurso, e moram aqui; os outros vêm do `UserErrors` e do `SessionErrors`.
/// </summary>
internal static class VaultErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>VaultErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(VaultErrors));

    public static ApiErrorDto From(EVaultError error)
        => error switch
        {
            EVaultError.Locked => ApiErrorDto.CreateUnauthorized(Texts.Get("LockedTitle"), "VAULT_LOCKED", Texts.Get("LockedDetail")),
            EVaultError.Unavailable => ApiErrorDto.Create("VAULT_UNAVAILABLE", Texts.Get("UnavailableTitle"), HttpStatusCode.ServiceUnavailable, Texts.Get("UnavailableDetail"), null, null),
            // RN-VERSAO-005: a única entrada recusada que diz mais do que "credencial inválida"; as rotas `api/user/...` nunca o veem (o cofre já está aberto).
            EVaultError.FormatUnsupported => ApiErrorDto.CreateConflict(Texts.Get("FormatUnsupportedTitle"), "VAULT_FORMAT_UNSUPPORTED", Texts.Get("FormatUnsupportedDetail")),
            EVaultError.InvalidCredentials => SessionErrors.InvalidCredentials(),
            EVaultError.UserAlreadyExists => UserErrors.AlreadyExists(),
            // RN-COFRE-013: a troca de senha. 422 nas duas, porque a chamada já está autenticada (um 401 seria renovado e repetido pela tela).
            EVaultError.CurrentPasswordInvalid => UserErrors.CurrentPasswordInvalid(),
            EVaultError.PasswordUnchanged => UserErrors.PasswordUnchanged(),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };
}
