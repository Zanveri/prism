using CSharpFunctionalExtensions;
using Prism.Infrastructure.DbeaverSources.Models;
using System.Text.Json;

namespace Prism.Infrastructure.DbeaverSources.Services;

/// <summary>
/// RN-DBEAVER-006 a 008: a cópia dos arquivos do DBeaver que o processo principal fez na pasta `transfers`, e a cifra do `credentials-config.json` dele.
/// Quem lê e decifra é a API, em C#, igual nos três sistemas, sem `openssl`, WSL nem ferramenta do sistema; nada é decifrado na tela nem no processo principal, e
/// nada é enviado para fora do computador. Sem estado: cada pedido abre a cópia de novo.
/// </summary>
public interface IDbeaverSourceService
{
    /// <summary>
    /// Lê a cópia pelo `sourceId` (só o formato do identificador passa, e o caminho é montado aqui): o manifesto e os arquivos dele. `Missing` é a cópia que não
    /// existe, e `Invalid`, a que não tem o manifesto que o processo principal escreve.
    /// </summary>
    Result<DbeaverSource, EDbeaverSourceError> Open(Guid sourceId);

    /// <summary>RN-DBEAVER-007: lê um JSON da cópia (até 64 níveis, sem comentários) e entrega a raiz a <paramref name="readContent"/>; o JSON que não lê é <see cref="Maybe{T}.None"/>.</summary>
    Maybe<T> ReadJson<T>(byte[] content, Func<JsonElement, T> readContent);

    /// <summary>Apaga a cópia (a importação que terminou, e quem fecha o cofre). A cópia que não existe não é erro.</summary>
    void Delete(Guid sourceId);

    /// <summary>
    /// RN-DBEAVER-008: decifra o `credentials-config.json` e entrega o conteúdo, como JSON, a <paramref name="readContent"/>, que extrai o que precisa. O buffer
    /// em claro e a cópia da chave são zerados em seguida, também quando a leitura falha; o que <paramref name="readContent"/> devolve não pode guardar o
    /// <see cref="JsonElement"/> (o buffer some). A falha nunca leva a mensagem de uma exceção.
    /// </summary>
    Result<T, EDbeaverCredentialsError> DecryptCredentials<T>(byte[] file, Func<JsonElement, T> readContent);
}
