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
    /// 422 `CONNECTION_INVALID` na forma do filtro de validação (`errors` e `errorCodes` por campo): a tela mostra a mensagem no campo da
    /// senha, que é onde a pessoa resolve. A senha gravada nunca vai a outro servidor: sem esta regra, apontar a conexão para ele entregaria a
    /// senha que a RN-CONN-002 só mostra a quem redigita a senha do Prism.
    /// </summary>
    private static ApiErrorDto PasswordRequired(string message)
        => ApiErrorDto.CreateUnprocessableEntityOnField("Erro ao enviar dados para a API.", "CONNECTION_INVALID", "Password", message);
}
