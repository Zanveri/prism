using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Queries;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Transfers.Models;

/// <summary>
/// O que a importação e a cópia para outro banco (seção 36) conferem e montam das conexões do cofre antes do 202: o banco de dados pedido, na regra da
/// abertura de uma sessão (RN-ARVORE-006); os dados da conexão à parte; a proteção da conexão de destino, lida do cofre a cada comando do trabalho
/// (RN-PROT-006); e a tradução das recusas do registro.
/// </summary>
internal static class TransferConnections
{
    /// <summary>RN-ARVORE-006: o teto do nome de outro banco do servidor, o mesmo da abertura de uma sessão.</summary>
    public const int MaxDatabaseLength = 128;

    /// <summary>O banco de dados pedido: ausente (o da conexão), ou de 1 a 128 caracteres, sem caractere de controle.</summary>
    public static bool IsDatabaseName(string? database)
        => database is null || (!string.IsNullOrWhiteSpace(database) && database.Length <= MaxDatabaseLength && !database.Any(char.IsControl));

    /// <summary>
    /// A conexão à parte do trabalho: a conexão gravada no cofre, lida agora, com o banco de dados pedido, e pelo túnel SSH, o SSL e o proxy dela (sem eles
    /// o trabalho iria direto ao host, que é o do outro lado do túnel). Os segredos que a conexão não grava, sem `unsavedSecrets`, faltam.
    /// </summary>
    public static ConnectionSettings SettingsOf(VaultConnectionRecord record, string? database, IUnsavedSecretsService? unsavedSecrets = null)
        => ConnectionRules.SettingsOf(record, database, unsavedSecrets);

    /// <summary>RN-REDE-003 e 006: a recusa do trabalho cuja conexão não tem o segredo do túnel ou do proxy, antes de qualquer conexão; `null` quando não falta nada.</summary>
    public static ApiErrorDto? NetworkSecretRefusal(VaultConnectionRecord record, ConnectionSettings settings)
        => ConnectionRules.MissingNetworkSecret(settings.Ssh, settings.Proxy) is { } field ? TransferJobErrors.NetworkSecretMissing(field, record.ID) : null;

    /// <summary>
    /// RN-PROT-006 e RN-IMPORT-014: antes de cada comando, o trabalho lê as proteções da conexão de destino no cofre, como a sessão faz a cada comando (a
    /// própria, uma pasta acima, a conexão movida para dentro de uma pasta somente leitura), e para como a sessão recusaria o comando: a conexão somente
    /// leitura, com `readOnly`; a que sumiu (a exclusão chegou antes do cancelamento dela, RN-CONN-014), com `connectionDeleted`; e o cofre que não
    /// responde (fechado, ou o disco), sem ler a proteção, como o cancelamento (o fechamento cancela o trabalho por conta própria).
    /// </summary>
    public static Func<CancellationToken, Task<ETransferCancelReason?>> StopNow(IConnectionQueries connectionQueries, Guid connectionID)
        => async cancellationToken =>
        {
            var read = await connectionQueries.IsReadOnly(connectionID, cancellationToken);
            if (read.IsFailure)
                return ETransferCancelReason.Person;

            return read.Value switch
            {
                null => ETransferCancelReason.ConnectionDeleted,
                true => ETransferCancelReason.ReadOnly,
                false => null
            };
        };

    /// <summary>RN-EXPORT-016 e RN-IMPORT-014: as recusas do registro, sob a trava com que o trabalho entra nele.</summary>
    public static ApiErrorDto StartRefusal(ETransferStartFailure failure, string schema, string table)
        => failure switch
        {
            ETransferStartFailure.LimitReached => TransferJobErrors.LimitReached(),
            ETransferStartFailure.VaultChanged => VaultErrors.From(EVaultError.Locked),
            ETransferStartFailure.ImportBusy => ImportErrors.TargetBusy(copy: false, schema, table),
            ETransferStartFailure.CopyBusy => ImportErrors.TargetBusy(copy: true, schema, table),
            ETransferStartFailure.FileMissing => ImportErrors.FileMissing(),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };
}
