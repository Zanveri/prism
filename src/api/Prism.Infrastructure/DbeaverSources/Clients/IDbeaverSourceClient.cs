using CSharpFunctionalExtensions;
using Prism.Infrastructure.DbeaverSources.Models;
using System.Text.Json;

namespace Prism.Infrastructure.DbeaverSources.Clients;

/// <summary>
/// RN-DBEAVER-006 e 008: o disco da cópia do DBeaver na pasta `transfers` e a cifra do `credentials-config.json`, a quinta integração (a dos arquivos de outro
/// programa), com o único `try` dela no `Send`. O nome da pasta sai só do `sourceId`, e nenhum caminho vem da tela.
/// </summary>
internal interface IDbeaverSourceClient
{
    /// <summary>
    /// Lê `&lt;sourceId&gt;.dbeaver/manifest.json` e, de cada projeto dele, os arquivos conhecidos (só estes nomes, e só arquivos comuns: o atalho é ignorado).
    /// O manifesto ausente é <see cref="EDbeaverSourceError.Missing"/>; o que o processo principal não escreve (a versão, o lugar, a forma, os nomes de
    /// pasta que não são `1` a `50`) é <see cref="EDbeaverSourceError.Invalid"/>. Cada arquivo tem até 5 MiB; o que passa disso ou não abre vem sem conteúdo.
    /// </summary>
    Result<DbeaverSource, EDbeaverSourceError> Read(Guid sourceId);

    /// <summary>
    /// RN-DBEAVER-007: lê um `data-sources*.json` ou o `project-settings.json` com o `System.Text.Json`, até 64 níveis e sem comentários, e entrega a raiz a
    /// <paramref name="readContent"/>, que extrai o que precisa (o <see cref="JsonElement"/> não sobrevive à chamada). Nenhum valor se perde com o `try`: o JSON
    /// que não lê (inclusive o que não é UTF-8) é <see cref="Maybe{T}.None"/>, e o log recebe só a classe da exceção.
    /// </summary>
    Maybe<T> ReadJson<T>(byte[] content, Func<JsonElement, T> readContent);

    /// <summary>Apaga a pasta da cópia com o que tem dentro. Não falha: o que não se apaga na hora fica para a partida seguinte (RN-DBEAVER-006).</summary>
    void Delete(Guid sourceId);

    /// <summary>Apaga todas as cópias prontas (`*.dbeaver`), com o que têm dentro: o cofre que fechou não deixa senhas do DBeaver no disco. A que o processo principal ainda escreve (`.part`) fica. Não falha.</summary>
    void DeleteAll();

    /// <summary>
    /// RN-DBEAVER-008: decifra o `credentials-config.json` (AES-128 em CBC, PKCS #7, a chave pública do DBeaver, o IV nos 16 primeiros bytes) e entrega o
    /// conteúdo como JSON a <paramref name="readContent"/>, que extrai o que precisa; o buffer em claro e a cópia da chave são zerados em seguida.
    /// </summary>
    Result<T, EDbeaverCredentialsError> Decrypt<T>(byte[] file, Func<JsonElement, T> readContent);
}
