namespace Prism.Infrastructure.Vault.Models;

public sealed class VaultOptions
{
    /// <summary>`PRISM_DATA_DIR`. Os cofres ficam em `vaults/`, dentro dela (RN-COFRE-001).</summary>
    public string DataDirectory { get; set; } = string.Empty;

    /// <summary>
    /// RN-COFRE-002: Argon2id com 64 MiB, 3 passadas e paralelismo 4. Valem para o cofre que nasce agora;
    /// o que já existe abre com os parâmetros gravados no próprio cabeçalho (RN-COFRE-004).
    /// </summary>
    public int MemoryKiB { get; set; } = 65536;

    public int Iterations { get; set; } = 3;

    public int Parallelism { get; set; } = 4;
}
