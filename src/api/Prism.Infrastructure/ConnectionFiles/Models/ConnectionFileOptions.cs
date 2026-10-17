namespace Prism.Infrastructure.ConnectionFiles.Models;

/// <summary>
/// RN-TRANSF-007: os parâmetros da derivação da chave do arquivo da exportação, os da RN-COFRE-002 (Argon2id com 64 MiB, 3 passadas e paralelismo 4),
/// gravados no cabeçalho de cada arquivo. Valem para o arquivo que sai agora; o que chega abre com os parâmetros do próprio cabeçalho, dentro dos limites
/// (`VaultHeaderLimits`). O teste de integração os reduz como reduz os do cofre, e o de unidade troca a própria derivação (`deriveKey`).
/// </summary>
public sealed class ConnectionFileOptions
{
    public int MemoryKiB { get; set; } = 65536;

    public int Iterations { get; set; } = 3;

    public int Parallelism { get; set; } = 4;
}
