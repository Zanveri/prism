using System.Security.Cryptography;

namespace Prism.Infrastructure.DbeaverSources.Clients;

/// <summary>
/// RN-DBEAVER-008: a cifra do `credentials-config.json` do DBeaver, sem estado e sem disco. Nada aqui captura exceção: o preenchimento que não confere
/// lança `CryptographicException`, e vira falha no `Send` do <see cref="DbeaverSourceClient"/>, o único `try` da integração.
/// </summary>
internal static class DbeaverCrypto
{
    /// <summary>
    /// A chave do DBeaver Community, em hexadecimal: a constante `LOCAL_KEY_CACHE` do `BaseProjectImpl` dele (os 16 bytes -70, -69, 74, -97, 119, 74, -72, 83,
    /// -55, 108, 45, 101, 61, -2, 84 e 74), que o `DefaultValueEncryptor` recebe. É PÚBLICA: está no código aberto do DBeaver e é a mesma de qualquer
    /// instalação, então não protege nada, e quem tem o arquivo tem as senhas. Por isso o Prism trata o que sai da decifração como segredo (zera os buffers,
    /// nunca registra, e só o põe no cofre cifrado). Não é segredo do Prism, não é configurável e não serve para mais nada (seção 8, item 8, da especificação).
    /// </summary>
    public const string PublicKeyHex = "babb4a9f774ab853c96c2d653dfe544a";

    /// <summary>O IV são os 16 primeiros bytes do arquivo (o `encryptValue` do DBeaver grava o IV e depois o conteúdo cifrado).</summary>
    public const int IvSize = 16;

    /// <summary>Um IV e ao menos um bloco cifrado: o arquivo com menos de 32 bytes, ou de um tamanho que não é múltiplo de 16, não é decifrado.</summary>
    public static bool HasTheShape(byte[] file)
        => file.Length >= 2 * IvSize && file.Length % 16 == 0;

    /// <summary>
    /// AES-128 em CBC com o preenchimento PKCS #7, o IV nos 16 primeiros bytes. O conteúdo em claro é UTF-8 e sai num buffer novo, que quem chama zera. A cópia
    /// da chave é zerada na saída.
    /// </summary>
    public static byte[] Decrypt(byte[] file)
    {
        var key = Convert.FromHexString(PublicKeyHex);
        using var wipe = new Wipe(key);
        using var aes = Aes.Create();
        aes.Key = key;

        return aes.DecryptCbc(file.AsSpan(IvSize), file.AsSpan(0, IvSize), PaddingMode.PKCS7);
    }

    /// <summary>Zera o buffer na saída do `using`, como no client do arquivo de conexões: sem `try`/`finally` fora do `Send`.</summary>
    private readonly struct Wipe(byte[] buffer) : IDisposable
    {
        public void Dispose()
            => CryptographicOperations.ZeroMemory(buffer);
    }
}
