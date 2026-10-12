namespace Prism.Infrastructure.Vault.Models;

/// <summary>Uma pasta como fica gravada dentro do cofre.</summary>
public sealed record VaultFolderRecord(Guid ID, Guid? ParentID, string Name, DateTime CreatedAt, DateTime UpdatedAt);
