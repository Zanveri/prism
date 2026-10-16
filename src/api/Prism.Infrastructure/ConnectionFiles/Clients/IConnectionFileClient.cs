using CSharpFunctionalExtensions;
using Prism.Infrastructure.ConnectionFiles.Models;
using System.Text.Json;

namespace Prism.Infrastructure.ConnectionFiles.Clients;

/// <summary>
/// O que no arquivo da exportação de conexões pode falhar por fora do código: a leitura do JSON e a abertura da cifra. Não há disco: o arquivo chega e sai
/// como texto (a tela o grava e o lê). Nenhuma falha prevista sai daqui como exceção: volta como <see cref="EConnectionFileError"/>.
/// </summary>
internal interface IConnectionFileClient
{
    /// <summary>
    /// RN-TRANSF-010, etapas 3 a 5, sem derivar nada: o texto é um JSON com `kind` igual a `prism-connections` (senão `Invalid`, também o texto vazio); o
    /// `version` é lido antes do resto do cabeçalho, e um inteiro maior que o formato conhecido é `Newer`, e o que não é um inteiro de 1 até ele, `Invalid`;
    /// o cabeçalho tem a forma e os limites do cabeçalho do cofre (`VaultHeaderLimits`), e todo base64 decodifica (senão `Invalid`).
    /// </summary>
    Result<ConnectionFile, EConnectionFileError> Read(string content);

    /// <summary>
    /// RN-TRANSF-010, etapas 6 e 7: abre o conteúdo com a chave (`WrongPassphrase` quando a cifra não autentica) e o entrega a <paramref name="readContent"/>
    /// como JSON (`Invalid` quando não é JSON). O texto em claro só existe num buffer que o <see cref="JsonDocument"/> lê sem copiar, e que é zerado assim que
    /// <paramref name="readContent"/> volta: o que ele devolve é o que fica do conteúdo.
    /// </summary>
    Result<T, EConnectionFileError> Open<T>(byte[] key, ConnectionFile file, Func<JsonElement, T> readContent);

    /// <summary>RN-TRANSF-007: o texto do arquivo, um JSON em UTF-8 sem BOM, com os nomes do cabeçalho em camelCase e os bytes em base64.</summary>
    string Write(ConnectionFile file);
}
