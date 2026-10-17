namespace Prism.Infrastructure.ConnectionFiles.Models;

/// <summary>RN-TRANSF-010: o que a leitura do arquivo da exportação distingue numa recusa. Quem as traduz para o erro da API é a Application.</summary>
public enum EConnectionFileError
{
    /// <summary>
    /// Não é uma exportação de conexões do Prism, ou está danificado: não é JSON, o `kind` não é `prism-connections`, o `version` não é um inteiro de 1
    /// até o formato conhecido, o cabeçalho passa dos limites (`VaultHeaderLimits`) ou tem um base64 que não decodifica, ou o conteúdo aberto não é JSON.
    /// Nada é derivado antes de o cabeçalho passar.
    /// </summary>
    Invalid,

    /// <summary>O `version` é um inteiro maior que o formato que este Prism conhece (RN-VERSAO-002). Conferido antes do resto do cabeçalho, sem derivar.</summary>
    Newer,

    /// <summary>
    /// A cifra não autenticou: a senha de exportação errada e o arquivo alterado (um byte do conteúdo, da tag ou do nonce, ou um valor do cabeçalho que
    /// ainda passe pelos limites) dão a MESMA recusa. O AES-GCM não distingue os dois, e dizer qual seria ajudar quem altera.
    /// </summary>
    WrongPassphrase
}
