using Prism.Infrastructure.Vault.Models;

namespace Prism.Infrastructure.Vault.Services;

/// <summary>
/// RN-VERSAO-005: o que muda no documento de um formato para o seguinte. O cabeçalho (`VaultFile`) é o mesmo em todos os formatos que se leem; o que
/// muda é o conteúdo cifrado. Quem regrava o arquivo no formato atual é o `VaultService.Unlock`, ao abrir. Cada passo é de um formato para o seguinte, e
/// um cofre antigo passa por todos os que faltam, em ordem.
/// </summary>
internal static class VaultMigration
{
    /// <summary>
    /// O documento de um cofre do formato <paramref name="format"/> como o formato atual o lê. O JSON de um formato anterior não tem os campos que vieram
    /// depois, e a leitura os entrega nulos. Do 1 para o 2 (RN-SCRIPT-002): os scripts não existiam, e viram a lista vazia. Do 2 para o 3 (RN-ABAS-006): a
    /// área de trabalho não existia, e vira a vazia (nada volta na entrada seguinte). Do 3 para o 4 (RN-SCRIPT-011): as pastas de scripts não existiam, e
    /// viram a lista vazia; a pasta de cada script, que o JSON de antes não tem, já chega nula, e todo script fica na raiz. O resto passa como está.
    /// </summary>
    public static VaultDocument Upgrade(VaultDocument document, int format)
    {
        var upgraded = document;
        if (format < 2)
            upgraded = upgraded with { Scripts = [] };

        if (format < 3)
            upgraded = upgraded with { Workspace = VaultWorkspaceRecord.Empty };

        if (format < 4)
            upgraded = upgraded with { ScriptFolders = [] };

        return upgraded;
    }
}
