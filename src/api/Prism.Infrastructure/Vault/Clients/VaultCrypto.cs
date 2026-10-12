using Konscious.Security.Cryptography;
using Prism.Infrastructure.Vault.Models;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Prism.Infrastructure.Vault.Clients;

/// <summary>
/// A cifra do cofre, sem estado e sem disco: Argon2id para tirar uma chave da senha e AES-256-GCM
/// para cifrar. Nada aqui captura exceção. A do `Open` (tag inválida) é a resposta de senha errada,
/// e vira falha no `Send` do <see cref="VaultFileClient"/>, o único `try` da integração.
/// </summary>
internal static class VaultCrypto
{
    public const int Version = 1;
    public const string Algorithm = "argon2id";
    public const int KeySize = 32;
    public const int SaltSize = 16;
    public const int NonceSize = 12;
    public const int TagSize = 16;

    /// <summary>
    /// RN-COFRE-003: a chave do cofre é aleatória, de 256 bits. A criação da conta e a troca de senha (RN-COFRE-013) a geram aqui; o serviço a recebe pelo
    /// construtor, como a derivação, para o teste conferir o que acontece com o buffer.
    /// </summary>
    public static byte[] NewKey()
        => RandomNumberGenerator.GetBytes(KeySize);

    /// <summary>
    /// RN-COFRE-002: a chave que protege a chave do cofre sai da senha por Argon2id, com os parâmetros
    /// e o sal que o chamador entrega (os do cabeçalho do arquivo, para um cofre que já existe).
    /// Quem recebe a chave a zera depois de usar.
    /// </summary>
    public static byte[] DeriveKey(string password, VaultKdf kdf)
    {
        // A senha chega como string, do JSON da requisição, e só vira bytes aqui; esta cópia é zerada na saída.
        var passwordBytes = Encoding.UTF8.GetBytes(password);

        // O Argon2 da biblioteca recusa senha vazia com exceção. Senha vazia nunca é a certa, mas o erro dela
        // custa a mesma derivação de qualquer outro (RN-COFRE-006) e não pode virar 500: vira um byte zero,
        // que nenhuma senha criada produz (as de 8 caracteres ou mais têm 8 bytes ou mais, RN-COFRE-010).
        if (passwordBytes.Length == 0)
            passwordBytes = [0];

        using var argon2 = new Argon2id(passwordBytes) { Salt = kdf.Salt, MemorySize = kdf.MemoryKiB, Iterations = kdf.Iterations, DegreeOfParallelism = kdf.Parallelism };
        var key = argon2.GetBytes(KeySize);
        CryptographicOperations.ZeroMemory(passwordBytes);

        return key;
    }

    /// <summary>
    /// RN-COFRE-003: o cabeçalho entra como dado autenticado das duas cifras, então trocar a versão, o
    /// algoritmo, um parâmetro ou o sal faz a abertura falhar. O formato é contrato com os cofres já
    /// gravados: mudá-lo deixa todos ilegíveis.
    /// </summary>
    public static byte[] AssociatedData(int version, VaultKdf kdf)
        => Encoding.UTF8.GetBytes(string.Create(CultureInfo.InvariantCulture, $"prism-vault|{version}|{kdf.Algorithm}|{kdf.MemoryKiB}|{kdf.Iterations}|{kdf.Parallelism}|{Convert.ToBase64String(kdf.Salt)}"));

    /// <summary>RN-COFRE-003: AES-256-GCM com nonce aleatório novo a cada chamada; a mesma chave nunca cifra duas vezes com o mesmo nonce.</summary>
    public static VaultSealedBox Seal(byte[] key, byte[] plaintext, byte[] associatedData)
    {
        var box = new VaultSealedBox(RandomNumberGenerator.GetBytes(NonceSize), new byte[plaintext.Length], new byte[TagSize]);

        using var aes = new AesGcm(key, TagSize);
        aes.Encrypt(box.Nonce, plaintext, box.Ciphertext, box.Tag, associatedData);

        return box;
    }

    /// <summary>
    /// Lança `AuthenticationTagMismatchException` quando a chave é outra ou quando o conteúdo, a tag ou
    /// o dado autenticado foram alterados: o `AesGcm` não tem outra maneira de recusar. Chame pelo
    /// <see cref="IVaultFileClient.Open"/>, que devolve `Result`.
    /// </summary>
    public static byte[] Open(byte[] key, VaultSealedBox box, byte[] associatedData)
    {
        var plaintext = new byte[box.Ciphertext.Length];

        using var aes = new AesGcm(key, TagSize);
        aes.Decrypt(box.Nonce, box.Ciphertext, box.Tag, plaintext, associatedData);

        return plaintext;
    }
}
