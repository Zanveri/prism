namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// O arquivo do cofre como está no disco (RN-COFRE-003 e 004). Os `byte[]` são base64 no JSON. Nada
/// aqui é segredo: a chave do cofre só aparece cifrada, em `WrappedKey`.
/// </summary>
public sealed record VaultFile(int Version, VaultKdf Kdf, VaultSealedBox WrappedKey, VaultSealedBox Payload);

/// <summary>RN-COFRE-004: os parâmetros da derivação viajam com o arquivo, e é com eles que o cofre abre.</summary>
public sealed record VaultKdf(string Algorithm, int MemoryKiB, int Iterations, int Parallelism, byte[] Salt);

/// <summary>Uma saída do AES-256-GCM: o nonce que foi sorteado, o conteúdo cifrado e a tag que o autentica.</summary>
public sealed record VaultSealedBox(byte[] Nonce, byte[] Ciphertext, byte[] Tag);
