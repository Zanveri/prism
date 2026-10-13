using Prism.Infrastructure.Vault.Models;

namespace Prism.Infrastructure.Vault.Services;

/// <summary>
/// RN-VERSAO-005: o que muda no documento de um formato para o seguinte. O cabeçalho (`VaultFile`) é o mesmo em todos os formatos que se leem; o que
/// muda é o conteúdo cifrado. Quem regrava o arquivo no formato atual é o `VaultService.Unlock`, ao abrir.
/// </summary>
internal static class VaultMigration
{
    /// <summary>
    /// O documento de um cofre do formato <paramref name="format"/> como o formato atual o lê. Do 1 para o 2 (RN-SCRIPT-002): os scripts não existiam, e o
    /// JSON do formato 1 não tem o campo, que a leitura entrega nulo; ele vira a lista vazia. O resto passa como está.
    /// </summary>
    public static VaultDocument Upgrade(VaultDocument document, int format)
        => format < 2 ? document with { Scripts = [] } : document;
}
