using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Databases.Services;

/// <summary>
/// RN-REDE-002: a senha (ou frase secreta) do túnel SSH e a senha do proxy que a pessoa digitou numa conexão gravada sem "Salvar credenciais": não vão ao cofre, e
/// ficam aqui, só na memória da API, até o cofre fechar por qualquer caminho (RN-COFRE-008). É `Singleton` como o registro de sessões: o segredo é
/// digitado ao gravar a conexão e usado ao conectar, em outra requisição. Guarda o túnel e o proxy inteiros, para quem usa conferir que o servidor é o mesmo.
/// </summary>
public interface IUnsavedSecretsService
{
    /// <summary>Guarda o túnel e o proxy que vieram com o segredo e sem "Salvar credenciais"; o que vem de outro jeito não muda o que já estava guardado.</summary>
    void Remember(Guid connectionID, ConnectionSshSettings? ssh, ConnectionProxySettings? proxy);

    ConnectionSshSettings? Ssh(Guid connectionID);

    ConnectionProxySettings? Proxy(Guid connectionID);
}
