namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// Um script salvo como fica gravado dentro do cofre (RN-SCRIPT-002): o nome, o texto do SQL e o lugar em que ele foi salvo, a conexão e o banco da aba
/// (RN-SCRIPT-003). `ConnectionID` pode apontar para uma conexão que já não existe: o script continua do usuário, e a tela pede outra conexão ao abri-lo.
/// `Database` nulo é o banco da própria conexão.
/// </summary>
public sealed record VaultScriptRecord(Guid ID, string Name, string Sql, Guid? ConnectionID, string? Database, DateTime CreatedAt, DateTime UpdatedAt)
{
    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria o texto do SQL onde quer que o record fosse parar.</summary>
    public override string ToString()
        => nameof(VaultScriptRecord);
}
