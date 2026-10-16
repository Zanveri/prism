namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// Uma pasta de scripts como fica gravada dentro do cofre (RN-SCRIPT-007): o nome, a pasta pai (nula na raiz da seção Scripts) e as datas. É da seção Scripts, e
/// não uma pasta de conexões (`VaultFolderRecord`): não tem ambiente, cor nem proteções, e nada herda dela. Entrou no formato 4 do cofre (RN-SCRIPT-011): um
/// cofre de formato anterior não tem a lista, e a ganha vazia ao ser migrado (`VaultMigration`).
/// </summary>
public sealed record VaultScriptFolderRecord(Guid ID, Guid? ParentID, string Name, DateTime CreatedAt, DateTime UpdatedAt);
