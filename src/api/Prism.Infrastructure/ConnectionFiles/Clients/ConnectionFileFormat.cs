using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Infrastructure.ConnectionFiles.Clients;

/// <summary>
/// RN-TRANSF-007 e RN-VERSAO-002: o formato do arquivo da exportação de conexões é contrato, com o número próprio, independente da versão do app e do
/// formato do cofre. O número sobe só quando um Prism mais antigo leria o arquivo errado; um campo novo e opcional, dentro do conteúdo cifrado, não o muda.
/// </summary>
internal static class ConnectionFileFormat
{
    /// <summary>O `kind` do cabeçalho: o que diz que o JSON é uma exportação de conexões do Prism.</summary>
    public const string Kind = "prism-connections";

    /// <summary>O formato que esta versão grava e o mais novo que ela lê. Um `version` maior é `Newer`, sem derivar a chave.</summary>
    public const int Version = 1;

    /// <summary>
    /// O começo do dado autenticado, diferente do do cofre (`prism-vault`): um arquivo de exportação nunca abre como cofre, nem um cofre como arquivo de
    /// exportação, mesmo com a mesma senha. O resto do texto é o do cofre (`VaultCrypto.AssociatedData`).
    /// </summary>
    public const string AssociatedDataPrefix = "prism-connections";

    public static byte[] AssociatedData(int version, VaultKdf kdf)
        => VaultCrypto.AssociatedData(AssociatedDataPrefix, version, kdf);
}
