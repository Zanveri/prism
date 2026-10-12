using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Vault.Models;

/// <summary>Uma conexão como fica gravada dentro do cofre, com a senha do banco (RN-COFRE-001).</summary>
public sealed record VaultConnectionRecord(Guid ID, Guid? FolderID, string Name, EDatabaseEngine Engine, string Host, int Port, string Database, string UserName, string Password, string? EnvironmentName, string? EnvironmentColor, DateTime CreatedAt, DateTime UpdatedAt)
{
    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria host, usuário e senha onde quer que o record fosse parar.</summary>
    public override string ToString()
        => nameof(VaultConnectionRecord);
}
