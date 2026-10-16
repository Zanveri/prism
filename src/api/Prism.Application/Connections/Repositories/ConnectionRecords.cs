using Prism.Application.Common.Protections;
using Prism.Application.Connections.Domain;
using Prism.Application.Connections.Models;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Connections.Repositories;

/// <summary>
/// A ida e a volta entre a conexão do domínio e o registro do cofre, num lugar só: o domínio não conhece o cofre. No registro, o padrão das proteções e
/// da verificação se grava nulo (RN-PROT-001 e 002, RN-VERIF-001), para a conexão gravada antes delas e a de agora sem nada escolhido serem iguais.
/// </summary>
internal static class ConnectionRecords
{
    public static Connection ToDomain(VaultConnectionRecord record)
        => Connection.Restore(record.ID, record.FolderID, record.Name, record.Engine, record.Host, record.Port, record.Database, record.UserName, record.Password, record.EnvironmentName, record.EnvironmentColor, SafeguardsOf(record), record.CreatedAt, record.UpdatedAt);

    public static VaultConnectionRecord ToRecord(Connection connection)
        => new(connection.ID, connection.FolderID, connection.Name, connection.Engine, connection.Host, connection.Port, connection.Database, connection.UserName, connection.Password, connection.EnvironmentName, connection.EnvironmentColor, connection.CreatedAt, connection.UpdatedAt,
            connection.ConfirmCommands,
            ProtectionRules.ToRecord(connection.ReadOnly),
            connection.VerificationEnabled ? null : false,
            connection.VerificationInterval == ConnectionRules.VerificationIntervalDefault ? null : connection.VerificationInterval,
            connection.VerificationQuery);

    public static ConnectionSafeguards SafeguardsOf(VaultConnectionRecord record)
        => new(record.ConfirmCommands, record.ReadOnly == true, record.VerificationEnabled ?? true, record.VerificationInterval ?? ConnectionRules.VerificationIntervalDefault, record.VerificationQuery);
}
