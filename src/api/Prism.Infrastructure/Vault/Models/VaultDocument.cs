namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// O conteúdo de um cofre aberto: é o que vai cifrado no `payload` do arquivo. Não muda no lugar: quem
/// altera entrega um documento novo ao `SaveAsync` do serviço. Os scripts (RN-SCRIPT-002) entraram no formato 2,
/// a área de trabalho (as abas que voltam na próxima entrada, RN-ABAS-006), no formato 3, e as pastas de scripts
/// (RN-SCRIPT-011), no formato 4: um cofre de formato anterior não os tem, e ganha as listas vazias e a área de
/// trabalho vazia ao ser migrado (RN-VERSAO-005, `VaultMigration`). As pastas de scripts vêm no fim, para as
/// construções de antes só ganharem a lista nova.
///
/// O que o cofre guarda da importação do DBeaver (`Dbeaver`, RN-DBEAVER-018: o convite e a última importação) e dos plugins de terceiros (`Plugins`) veio depois, no fim e sem subir o formato: nulo
/// até acontecer algo, e uma versão anterior do Prism o ignora.
/// </summary>
public sealed record VaultDocument(string UserName, IReadOnlyList<VaultFolderRecord> Folders, IReadOnlyList<VaultConnectionRecord> Connections, IReadOnlyList<VaultScriptRecord> Scripts, VaultWorkspaceRecord Workspace, IReadOnlyList<VaultScriptFolderRecord> ScriptFolders, VaultDbeaverRecord? Dbeaver = null, VaultPluginsRecord? Plugins = null);
