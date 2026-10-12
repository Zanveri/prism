namespace Prism.Infrastructure.Vault.Models;

/// <summary>As recusas do serviço do cofre. Quem as traduz para o erro da API é a Application.</summary>
public enum EVaultError
{
    UserAlreadyExists,

    /// <summary>
    /// Senha errada, usuário inexistente e arquivo ilegível ou adulterado: a mesma resposta para os
    /// três (RN-COFRE-006 e seção 7 da especificação).
    /// </summary>
    InvalidCredentials,

    Locked,

    /// <summary>Só falha de disco ao ler ou gravar o arquivo.</summary>
    Unavailable,

    /// <summary>
    /// O cabeçalho do cofre declara um formato mais novo que o conhecido (RN-VERSAO-005). É a única exceção à
    /// regra de `InvalidCredentials`: sem ela, quem voltasse a uma versão antiga do Prism concluiria que errou a senha.
    /// </summary>
    FormatUnsupported,

    /// <summary>
    /// RN-COFRE-013: a senha atual da troca de senha não confere. Na API é 422 `INVALID_PASSWORD`, o código da revelação de senha, e não o 401 da
    /// entrada: a chamada já está autenticada, e a tela renova a sessão e repete todo 401.
    /// </summary>
    CurrentPasswordInvalid,

    /// <summary>RN-COFRE-013: a senha nova é igual à atual.</summary>
    PasswordUnchanged
}
