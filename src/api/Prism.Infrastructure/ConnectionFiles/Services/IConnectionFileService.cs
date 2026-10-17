using CSharpFunctionalExtensions;
using Prism.Infrastructure.ConnectionFiles.Models;
using System.Text.Json;

namespace Prism.Infrastructure.ConnectionFiles.Services;

/// <summary>
/// RN-TRANSF-007 a 010: o arquivo da exportação de conexões, sempre cifrado com uma senha de exportação. A cifra é a do cofre (Argon2id e AES-256-GCM, a
/// `VaultCrypto`), sem a chave do cofre no meio: a chave sai da senha de exportação e cifra o conteúdo direto, com o cabeçalho como dado autenticado e um
/// começo próprio (`prism-connections|`). O arquivo não depende do cofre nem da senha do Prism.
///
/// `Singleton`: guarda a fila das derivações (RN-TRANSF-008). As derivações do arquivo (a exportação, a prévia e a importação) rodam uma por vez, fora da
/// trava do cofre: as outras janelas não esperam por elas, e a memória de duas não se soma. A senha chega como quem chama a entrega (a Application a passa
/// à forma NFC, e na importação tira os espaços das pontas), e nunca vai a log nem fica guardada.
/// </summary>
public interface IConnectionFileService
{
    /// <summary>
    /// RN-TRANSF-007: monta o arquivo. Deriva a chave da senha (sal novo de 16 bytes, os parâmetros das `ConnectionFileOptions`, na fila), serializa
    /// <paramref name="content"/> em JSON camelCase, cifra com AES-256-GCM (nonce novo) e zera o JSON em claro e a chave. Devolve o texto do arquivo.
    /// </summary>
    Task<string> SealAsync<T>(T content, string passphrase, CancellationToken cancellationToken);

    /// <summary>
    /// RN-TRANSF-010, etapas 3 a 7: lê o cabeçalho sem derivar nada (`Invalid` e `Newer` vêm antes de qualquer derivação), deriva a chave na fila, abre o
    /// conteúdo (`WrongPassphrase`, a mesma recusa para a senha errada e o arquivo alterado) e o entrega como JSON a <paramref name="readContent"/>, que extrai
    /// o que precisa; o buffer em claro e a chave são zerados em seguida. O JSON que não lê é `Invalid`.
    /// </summary>
    Task<Result<T, EConnectionFileError>> OpenAsync<T>(string content, string passphrase, Func<JsonElement, T> readContent, CancellationToken cancellationToken);
}
