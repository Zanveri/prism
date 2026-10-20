using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.Connections.Models;

/// <summary>Os códigos e os status são os da seção 6 da especificação. A pasta que não existe é o `FOLDER_NOT_FOUND` das pastas (`FolderErrors.NotFound`).</summary>
internal static class ConnectionErrors
{
    public static ApiErrorDto NotFound(Guid id)
        => ApiErrorDto.CreateNotFound("Conexão não localizada.", "CONNECTION_NOT_FOUND", $"Não existe uma conexão com o ID {id}.");

    /// <summary>RN-CONN-011.</summary>
    public static ApiErrorDto AlreadyExists(string name)
        => ApiErrorDto.CreateConflict("Conexão já existe.", "CONNECTION_ALREADY_EXISTS", $"Já existe uma conexão chamada {name} neste lugar. O nome não pode se repetir na mesma pasta, nem com outras maiúsculas e minúsculas.");

    /// <summary>
    /// RN-CONN-002. 422, e não 401: a tela renova a sessão e repete todo 401. O detalhe não diz nada da conexão nem do
    /// que faltou: só que a senha do Prism não confere.
    /// </summary>
    public static ApiErrorDto InvalidPassword()
        => ApiErrorDto.CreateUnprocessableEntity("Senha incorreta.", "INVALID_PASSWORD", "A senha informada não é a do seu usuário no Prism.");

    /// <summary>RN-CONN-004: o `PATCH` mudou o host ou a porta sem a senha da conexão.</summary>
    public static ApiErrorDto PasswordRequiredToChangeServer()
        => PasswordRequired("Ao mudar o host ou a porta, informe a senha da conexão de novo.");

    /// <summary>RN-CONN-013: o teste de uma conexão gravada, sem a senha, apontou para outro host ou outra porta.</summary>
    public static ApiErrorDto PasswordRequiredToTestOtherServer()
        => PasswordRequired("Para testar com outro host ou outra porta, informe a senha da conexão.");

    /// <summary>
    /// RN-TRANSF-015: o `PATCH` sem usuário numa conexão que tem um. O usuário vazio só passa na conexão gravada já sem usuário (a que a importação trouxe
    /// sem ele); tirar o de uma que tem continua sendo a recusa do formulário, com a mesma frase, no campo.
    /// </summary>
    public static ApiErrorDto UserNameRequired()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Erro ao enviar dados para a API.", "CONNECTION_INVALID", "UserName", "Informe o usuário do banco.");

    /// <summary>
    /// RN-TRANSF-016: abrir uma sessão com a conexão gravada sem usuário (campo `UserName`), ou com o usuário e sem a senha (campo `Password`), é recusado
    /// antes do driver. Sem a recusa, o driver tentaria o usuário vazio (o do PostgreSQL usaria o do sistema operacional), e a mensagem do banco não diria o
    /// que fazer. Na forma do erro de campo: é o campo que diz à tela qual falta, e ela abre o "Editar conexão" com o foco nele.
    /// </summary>
    public static ApiErrorDto CredentialsMissingToConnect(bool userNameMissing)
        => userNameMissing
            ? CredentialsMissing("UserName", "A conexão não tem usuário gravado. Preencha o usuário e a senha em \"Editar conexão\" para conectar.")
            : CredentialsMissing("Password", "A conexão não tem senha gravada. Preencha a senha em \"Editar conexão\" para conectar.");

    /// <summary>RN-TRANSF-016 e RN-CONN-013: o "Testar conexão" de uma conexão gravada sem senha, sem a senha no pedido, em vez de testar com a senha vazia.</summary>
    public static ApiErrorDto CredentialsMissingToTest()
        => CredentialsMissing("Password", "Esta conexão não tem senha gravada. Informe a senha do banco para testar.");

    private static ApiErrorDto CredentialsMissing(string field, string message)
        => ApiErrorDto.CreateUnprocessableEntityOnField("Conexão sem usuário ou sem senha.", "CONNECTION_CREDENTIALS_MISSING", field, message);

    /// <summary>
    /// 422 `CONNECTION_INVALID` na forma do filtro de validação (`errors` e `errorCodes` por campo): a tela mostra a mensagem no campo da
    /// senha, que é onde a pessoa resolve. A senha gravada nunca vai a outro servidor: sem esta regra, apontar a conexão para ele entregaria a
    /// senha que a RN-CONN-002 só mostra a quem redigita a senha do Prism.
    /// </summary>
    private static ApiErrorDto PasswordRequired(string message)
        => ApiErrorDto.CreateUnprocessableEntityOnField("Erro ao enviar dados para a API.", "CONNECTION_INVALID", "Password", message);
}
