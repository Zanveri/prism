namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// Uma pasta como fica gravada dentro do cofre. O ambiente (RN-PASTA-005) e depois a cor da pasta (RN-PASTA-007) vieram no mesmo formato do cofre
/// (RN-VERSAO-005): a leitura entrega nulo ao campo que o JSON de antes não tem, e a pasta gravada antes abre sem ambiente e sem cor. Por isso os três
/// ficam no fim, com o padrão nulo, na ordem em que entraram.
/// </summary>
public sealed record VaultFolderRecord(Guid ID, Guid? ParentID, string Name, DateTime CreatedAt, DateTime UpdatedAt, string? EnvironmentName = null, string? EnvironmentColor = null, string? Color = null);
