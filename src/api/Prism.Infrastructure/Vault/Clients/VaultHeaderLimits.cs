using Prism.Infrastructure.Vault.Models;
using System.Diagnostics.CodeAnalysis;

namespace Prism.Infrastructure.Vault.Clients;

/// <summary>
/// Os limites do cabeçalho de um arquivo cifrado pelo Prism, num lugar só: o do cofre (RN-COFRE-004, no <see cref="VaultFileClient"/>) e o da exportação
/// de conexões (RN-TRANSF-010, no `ConnectionFileClient`) conferem os mesmos, ANTES de qualquer derivação. Os dois arquivos são editáveis por quem tem
/// acesso a eles, e sem teto um `memoryKiB` absurdo faria a derivação tentar alocar terabytes antes de qualquer conferência.
///
/// Os tetos: 256 MiB, 8 passadas e paralelismo 8, com o padrão da RN-COFRE-002 e da RN-TRANSF-007 (64 MiB, 3, 4) folgado dentro deles. Valem na leitura e
/// na gravação: nenhum arquivo nasce com um cabeçalho que a leitura recusaria. Quem subir um padrão além deles sobe o teto aqui, na mesma mudança. O piso de
/// memória é o do Argon2: 8 KiB por linha de paralelismo. O sal tem 16 bytes, o nonce 12 e a tag 16.
/// </summary>
internal static class VaultHeaderLimits
{
    public const int MaxMemoryKiB = 256 * 1024;
    public const int MaxIterations = 8;
    public const int MaxParallelism = 8;
    public const int MinMemoryKiBPerLane = 8;

    /// <summary>O algoritmo é o Argon2id, e a memória, as passadas, o paralelismo e o sal estão dentro dos limites acima.</summary>
    public static bool IsWellFormed([NotNullWhen(true)] VaultKdf? kdf)
        => kdf is { Algorithm: VaultCrypto.Algorithm, MemoryKiB: <= MaxMemoryKiB, Iterations: >= 1 and <= MaxIterations, Parallelism: >= 1 and <= MaxParallelism, Salt.Length: VaultCrypto.SaltSize } && kdf.MemoryKiB >= MinMemoryKiBPerLane * kdf.Parallelism;

    /// <summary>O nonce tem 12 bytes, a tag 16, e o conteúdo cifrado existe (o System.Text.Json entrega nulo ao campo que falta).</summary>
    public static bool IsSealedBox([NotNullWhen(true)] VaultSealedBox? box)
        => box is { Nonce.Length: VaultCrypto.NonceSize, Ciphertext: not null, Tag.Length: VaultCrypto.TagSize };
}
