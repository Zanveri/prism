using CSharpFunctionalExtensions;
using Microsoft.Extensions.Options;
using Prism.Infrastructure.ConnectionFiles.Clients;
using Prism.Infrastructure.ConnectionFiles.Models;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using System.Security.Cryptography;
using System.Text.Json;

namespace Prism.Infrastructure.ConnectionFiles.Services;

/// <param name="deriveKey">
/// A derivação da chave a partir da senha de exportação. Em produção é o <see cref="VaultCrypto.DeriveKey"/>, o do cofre; entra pelo construtor, como no
/// `VaultService`, para os testes rodarem com uma derivação barata e contarem quantas aconteceram (as recusas do cabeçalho não derivam nada).
/// </param>
internal sealed class ConnectionFileService(IConnectionFileClient client, IOptions<ConnectionFileOptions> options, Func<string, VaultKdf, byte[]> deriveKey) : IConnectionFileService
{
    /// <summary>RN-TRANSF-007: o conteúdo é um JSON em camelCase. Quem decide o que vai e o que não aparece (o usuário e a senha que não vão) é o modelo de quem chama.</summary>
    private static readonly JsonSerializerOptions ContentOptions = new(JsonSerializerDefaults.Web);

    private readonly ConnectionFileOptions _options = options.Value;

    /// <summary>
    /// RN-TRANSF-008: a fila das derivações do arquivo, uma por vez em toda a API, e à parte da trava do cofre. Um Argon2id de 64 MiB leva perto de um
    /// segundo: a exportação de outra janela espera a vez, e a memória de duas não se soma.
    /// </summary>
    private readonly SemaphoreSlim _queue = new(1, 1);

    public async Task<string> SealAsync<T>(T content, string passphrase, CancellationToken cancellationToken)
    {
        // RN-TRANSF-007: sal aleatório de 16 bytes, novo a cada exportação: um arquivo, uma chave, uma cifragem.
        var kdf = new VaultKdf(VaultCrypto.Algorithm, _options.MemoryKiB, _options.Iterations, _options.Parallelism, RandomNumberGenerator.GetBytes(VaultCrypto.SaltSize));
        var key = await DeriveAsync(passphrase, kdf, cancellationToken);

        // O JSON em claro só existe neste buffer, criado depois da derivação e zerado logo depois da cifra, como no cofre; a chave também. A saída do `using`
        // os zera também quando a serialização ou a cifra lançam (um defeito, que sobe como veio).
        VaultSealedBox payload;
        using (new Wipe(key))
        {
            var plaintext = JsonSerializer.SerializeToUtf8Bytes(content, ContentOptions);

            using (new Wipe(plaintext))
                payload = VaultCrypto.Seal(key, plaintext, ConnectionFileFormat.AssociatedData(ConnectionFileFormat.Version, kdf));
        }

        return client.Write(new ConnectionFile(ConnectionFileFormat.Kind, ConnectionFileFormat.Version, kdf, payload));
    }

    public async Task<Result<T, EConnectionFileError>> OpenAsync<T>(string content, string passphrase, Func<JsonElement, T> readContent, CancellationToken cancellationToken)
    {
        // RN-TRANSF-010: o cabeçalho é conferido antes de qualquer derivação. Sem os limites, um arquivo com uma memória absurda faria a derivação tentar
        // alocar terabytes; e o formato mais novo é recusado sem olhar a senha.
        var file = client.Read(content);
        if (file.IsFailure)
            return file.Error;

        // Com os parâmetros do próprio arquivo, dentro dos limites. A senha errada não conta no contador de cinco erros do cofre (RN-CONN-003): a
        // conferência não toca o cofre, e a defesa contra quem tenta senhas é o custo do Argon2id.
        var key = await DeriveAsync(passphrase, file.Value.Kdf, cancellationToken);

        // A chave é zerada na saída do `using`, também quando a leitura do conteúdo lança o que o `Send` do client não trata.
        using (new Wipe(key))
            return client.Open(key, file.Value, readContent);
    }

    /// <summary>
    /// RN-TRANSF-008: a vez na fila e a derivação. A saída da fila é `using`, e não um `finally`: se a derivação lançar (um defeito, não uma falha prevista),
    /// a vez é devolvida do mesmo jeito, e a fila não prende as exportações seguintes. Quem desiste esperando a vez (a requisição abortada) não deriva nada.
    /// </summary>
    private async Task<byte[]> DeriveAsync(string passphrase, VaultKdf kdf, CancellationToken cancellationToken)
    {
        await _queue.WaitAsync(cancellationToken);

        using (new Turn(_queue))
            return deriveKey(passphrase, kdf);
    }

    private readonly struct Turn(SemaphoreSlim queue) : IDisposable
    {
        public void Dispose()
            => queue.Release();
    }

    /// <summary>Zera o buffer na saída do `using`, como no client do arquivo: sem `try`/`finally`.</summary>
    private readonly struct Wipe(byte[] buffer) : IDisposable
    {
        public void Dispose()
            => CryptographicOperations.ZeroMemory(buffer);
    }
}
