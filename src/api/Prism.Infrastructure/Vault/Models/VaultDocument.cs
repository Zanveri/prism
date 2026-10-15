namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// O conteúdo de um cofre aberto: é o que vai cifrado no `payload` do arquivo. Não muda no lugar: quem
/// altera entrega um documento novo ao `SaveAsync` do serviço. Os scripts (RN-SCRIPT-002) entraram no formato 2,
/// e a área de trabalho (as abas que voltam na próxima entrada, RN-ABAS-006), no formato 3: um cofre de formato
/// anterior não os tem, e ganha a lista vazia e a área de trabalho vazia ao ser migrado (RN-VERSAO-005, `VaultMigration`).
/// </summary>
public sealed record VaultDocument(string UserName, IReadOnlyList<VaultFolderRecord> Folders, IReadOnlyList<VaultConnectionRecord> Connections, IReadOnlyList<VaultScriptRecord> Scripts, VaultWorkspaceRecord Workspace);
