namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// Um modelo do modo Construir salvo no cofre do usuário (seção 7 da especificação de Construir): o nome, o corpo JSON do modelo (que a API guarda e devolve
/// sem interpretar o esquema interno) e as datas de criação e de última alteração (`UpdatedAt`, usada no controle de concorrência otimista por
/// `expectedUpdatedAt`).
/// </summary>
public sealed record VaultBuildModelRecord(Guid ID, string Name, string Body, DateTime CreatedAt, DateTime UpdatedAt)
{
    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprimiria o corpo do modelo e o nome.</summary>
    public override string ToString()
        => nameof(VaultBuildModelRecord);
}
