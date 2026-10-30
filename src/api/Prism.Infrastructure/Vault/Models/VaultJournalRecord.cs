namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// RN-DIARIO-002 e 004: chave de 256 bits do diário SQLCipher do usuário e o instante em que foi gerada, guardados dentro do documento
/// cifrado do cofre. `ToString` não imprime a chave (RN-LOG-001).
/// </summary>
public sealed record VaultJournalRecord(byte[] Key, DateTimeOffset CreatedAt)
{
    public override string ToString() => nameof(VaultJournalRecord);
}
