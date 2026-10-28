using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// Uma conexão como fica gravada dentro do cofre, com a senha do banco (RN-COFRE-001).
///
/// As proteções (RN-PROT-001 e 002: `ConfirmCommands` e `ReadOnly`) e a verificação periódica (RN-VERIF-001: `VerificationEnabled`,
/// `VerificationInterval` e `VerificationQuery`) vieram depois, no mesmo formato do cofre (RN-VERSAO-005): a leitura entrega nulo ao campo que o JSON
/// de antes não tem, e nulo é o padrão (sem confirmação, sem somente leitura, a verificação ligada a cada 30 segundos com a consulta do banco), então a
/// conexão gravada antes abre como estava. Por isso os cinco ficam no fim, com o padrão nulo, e o padrão se grava nulo (uma forma só).
///
/// A origem (`Origin`, RN-DBEAVER-018: de onde a conexão importada veio) veio depois, do mesmo jeito e também sem subir o formato: nula na conexão que o usuário
/// criou, e mantida quando ela é editada, renomeada ou movida (o `ConnectionRepository.Update`); a cópia (RN-CONN-016) e a exportação não a levam.
/// </summary>
public sealed record VaultConnectionRecord(Guid ID, Guid? FolderID, string Name, EDatabaseEngine Engine, string Host, int Port, string Database, string UserName, string Password, string? EnvironmentName, string? EnvironmentColor, DateTime CreatedAt, DateTime UpdatedAt, string? ConfirmCommands = null, bool? ReadOnly = null, bool? VerificationEnabled = null, int? VerificationInterval = null, string? VerificationQuery = null, VaultConnectionOrigin? Origin = null, bool? UseInternalDescriptions = null)
{
    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria host, usuário, senha e a consulta de verificação onde quer que o record fosse parar.</summary>
    public override string ToString()
        => nameof(VaultConnectionRecord);
}
