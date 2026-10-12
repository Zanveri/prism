using Prism.Application.Sessions.Models;
using Prism.Application.Users.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using System.Net;

namespace Prism.Application.Common.Vault;

/// <summary>
/// A tradução das recusas do serviço do cofre (`EVaultError`) para o erro da API, num lugar só: qualquer
/// handler que fale com o cofre responde a mesma falha do mesmo jeito. Os códigos são os da seção 6 da
/// especificação (e os da RN-COFRE-013, na seção 19). `Locked`, `Unavailable` e `FormatUnsupported` não são
/// de um recurso, e moram aqui; os outros vêm do `UserErrors` e do `SessionErrors`.
/// </summary>
internal static class VaultErrors
{
    public static ApiErrorDto From(EVaultError error)
        => error switch
        {
            EVaultError.Locked => ApiErrorDto.CreateUnauthorized("Cofre fechado.", "VAULT_LOCKED", "Entre com seu usuário e sua senha para abrir o cofre."),
            EVaultError.Unavailable => ApiErrorDto.Create("VAULT_UNAVAILABLE", "Cofre indisponível.", HttpStatusCode.ServiceUnavailable, "Não foi possível ler ou gravar o arquivo do cofre. Tente de novo em instantes.", null, null),
            // RN-VERSAO-005: a única entrada recusada que diz mais do que "credencial inválida"; as rotas `api/user/...` nunca o veem (o cofre já está aberto).
            EVaultError.FormatUnsupported => ApiErrorDto.CreateConflict("Cofre de uma versão mais nova do Prism.", "VAULT_FORMAT_UNSUPPORTED", "Este cofre foi criado por uma versão mais nova do Prism. Atualize o Prism para abri-lo."),
            EVaultError.InvalidCredentials => SessionErrors.InvalidCredentials(),
            EVaultError.UserAlreadyExists => UserErrors.AlreadyExists(),
            // RN-COFRE-013: a troca de senha. 422 nas duas, porque a chamada já está autenticada (um 401 seria renovado e repetido pela tela).
            EVaultError.CurrentPasswordInvalid => UserErrors.CurrentPasswordInvalid(),
            EVaultError.PasswordUnchanged => UserErrors.PasswordUnchanged(),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };
}
