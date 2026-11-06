using Prism.Core.Extensions;
using System.Resources;
using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.Connections.Models;

/// <summary>Os códigos e os status são os da seção 6 da especificação. A pasta que não existe é o `FOLDER_NOT_FOUND` das pastas (`FolderErrors.NotFound`).</summary>
internal static class ConnectionErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>ConnectionErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(ConnectionErrors));

    public static ApiErrorDto NotFound(Guid id)
        => ApiErrorDto.CreateNotFound(Texts.Get("NotFoundTitle"), "CONNECTION_NOT_FOUND", Texts.Get("NotFoundDetail", id));

    /// <summary>RN-CONN-011.</summary>
    public static ApiErrorDto AlreadyExists(string name)
        => ApiErrorDto.CreateConflict(Texts.Get("AlreadyExistsTitle"), "CONNECTION_ALREADY_EXISTS", Texts.Get("AlreadyExistsDetail", name));

    /// <summary>
    /// RN-CONN-002. 422, e não 401: a tela renova a sessão e repete todo 401. O detalhe não diz nada da conexão nem do
    /// que faltou: só que a senha do Prism não confere.
    /// </summary>
    public static ApiErrorDto InvalidPassword()
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("InvalidPasswordTitle"), "INVALID_PASSWORD", Texts.Get("InvalidPasswordDetail"));

    /// <summary>RN-CONN-004: o `PATCH` mudou o host ou a porta sem a senha da conexão.</summary>
    public static ApiErrorDto PasswordRequiredToChangeServer()
        => PasswordRequired(Texts.Get("PasswordRequiredToChangeServer"));

    /// <summary>RN-CONN-013: o teste de uma conexão gravada, sem a senha, apontou para outro host ou outra porta.</summary>
    public static ApiErrorDto PasswordRequiredToTestOtherServer()
        => PasswordRequired(Texts.Get("PasswordRequiredToTestOtherServer"));

    /// <summary>RN-REDE-001 (a RN-CONN-004 no túnel SSH): o pedido omitiu o segredo SSH gravado e apontou o túnel para outro host ou outra porta.</summary>
    public static ApiErrorDto SshSecretRequiredForOtherServer()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("RequestInvalidTitle"), "CONNECTION_INVALID", "Ssh", Texts.Get("SshSecretRequiredForOtherServer"));

    /// <summary>RN-REDE-001 (a RN-CONN-004 no proxy): o pedido omitiu a senha gravada do proxy e apontou para outro host ou outra porta.</summary>
    public static ApiErrorDto ProxyPasswordRequiredForOtherServer()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("RequestInvalidTitle"), "CONNECTION_INVALID", "Proxy", Texts.Get("ProxyPasswordRequiredForOtherServer"));

    /// <summary>
    /// RN-TRANSF-015: o `PATCH` sem usuário numa conexão que tem um. O usuário vazio só passa na conexão gravada já sem usuário (a que a importação trouxe
    /// sem ele); tirar o de uma que tem continua sendo a recusa do formulário, com a mesma frase, no campo.
    /// </summary>
    public static ApiErrorDto UserNameRequired()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("RequestInvalidTitle"), "CONNECTION_INVALID", "UserName", Texts.Get("UserNameRequired"));

    /// <summary>
    /// RN-TRANSF-016: abrir uma sessão com a conexão gravada sem usuário (campo `UserName`), ou com o usuário e sem a senha (campo `Password`), é recusado
    /// antes do driver. Sem a recusa, o driver tentaria o usuário vazio (o do PostgreSQL usaria o do sistema operacional), e a mensagem do banco não diria o
    /// que fazer. Na forma do erro de campo: é o campo que diz à tela qual falta, e ela abre o "Editar conexão" com o foco nele.
    /// </summary>
    public static ApiErrorDto CredentialsMissingToConnect(bool userNameMissing)
        => userNameMissing
            ? CredentialsMissing("UserName", Texts.Get("UserNameMissingToConnect"))
            : CredentialsMissing("Password", Texts.Get("PasswordMissingToConnect"));

    /// <summary>RN-TRANSF-016 e RN-CONN-013: o "Testar conexão" de uma conexão gravada sem senha, sem a senha no pedido, em vez de testar com a senha vazia.</summary>
    public static ApiErrorDto CredentialsMissingToTest()
        => CredentialsMissing("Password", Texts.Get("PasswordMissingToTest"));

    /// <summary>
    /// RN-REDE-003: o túnel SSH por senha, ou o proxy com usuário, sem o segredo: a conexão gravada sem "Salvar credenciais" e sem o segredo digitado desde que o cofre
    /// abriu. `field` é o de <see cref="ConnectionRules.MissingNetworkSecret"/>; a tela pede o segredo (RN-REDE-006).
    /// </summary>
    public static ApiErrorDto NetworkSecretMissingToConnect(string field)
        => CredentialsMissing(field, Texts.Get(field == "SshSecret" ? "SshSecretMissingToConnect" : "ProxyPasswordMissingToConnect"));

    /// <summary>O mesmo no "Testar conexão": o campo do segredo, vazio, sem o segredo gravado nem digitado antes.</summary>
    public static ApiErrorDto NetworkSecretMissingToTest(string field)
        => CredentialsMissing(field, Texts.Get(field == "SshSecret" ? "SshSecretMissingToTest" : "ProxyPasswordMissingToTest"));

    /// <summary>RN-REDE-007: o segredo que falta descoberto ao conectar (a chave privada cifrada sem a frase), com a frase do túnel.</summary>
    public static ApiErrorDto NetworkSecretMissing(string field, string message)
        => CredentialsMissing(field, message);

    private static ApiErrorDto CredentialsMissing(string field, string message)
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("CredentialsMissingTitle"), "CONNECTION_CREDENTIALS_MISSING", field, message);

    /// <summary>
    /// 422 `CONNECTION_INVALID` na forma do filtro de validação (`errors` e `errorCodes` por campo): a tela mostra a mensagem no campo da
    /// senha, que é onde a pessoa resolve. A senha gravada nunca vai a outro servidor: sem esta regra, apontar a conexão para ele entregaria a
    /// senha que a RN-CONN-002 só mostra a quem redigita a senha do Prism.
    /// </summary>
    private static ApiErrorDto PasswordRequired(string message)
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("RequestInvalidTitle"), "CONNECTION_INVALID", "Password", message);
}
