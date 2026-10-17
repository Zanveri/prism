using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Drivers.Services;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Transfers.Models;

/// <summary>
/// RN-IMPORT-023 a 027: as conferências da cópia para outro banco que não vão ao banco, nas rotas `copies/preview` e `copies`: a conexão de origem e a de
/// destino, cada uma com o banco de dados pedido, o usuário e a senha (no campo `source.userName` ou `target.password`) e o driver; o somente leitura do
/// destino (a origem só é lida, e pode ser somente leitura); e a tabela de destino que é a própria origem.
/// </summary>
internal static class CopyChecks
{
    /// <summary>
    /// A conexão de um lado, conferida: a que não existe é 404; o banco de dados fora da regra é `DATABASE_NAME_INVALID`; com `credentials`, a que não tem
    /// usuário ou senha é `CONNECTION_CREDENTIALS_MISSING` no campo do lado, e a do banco sem driver, `DRIVER_NOT_INSTALLED`.
    /// </summary>
    public static async Task<Result<VaultConnectionRecord, ApiErrorDto>> ConnectionAsync(IConnectionQueries connectionQueries, IDriverService driverService, Guid connectionID, string? database, bool source, bool credentials, CancellationToken cancellationToken)
    {
        var read = await connectionQueries.GetRecordByID(connectionID, cancellationToken);
        if (read.IsFailure)
            return VaultErrors.From(read.Error);

        if (read.Value is not { } record)
            return ConnectionErrors.NotFound(connectionID);

        if (!TransferConnections.IsDatabaseName(database))
            return TransferJobErrors.DatabaseNameInvalid();

        if (!credentials)
            return record;

        if (string.IsNullOrEmpty(record.UserName) || string.IsNullOrEmpty(record.Password))
            return ImportErrors.CopyCredentialsMissing(source, userNameMissing: string.IsNullOrEmpty(record.UserName));

        if (driverService.RefusalFor(record.Engine) is { } driver)
            return DatabaseSessionErrors.From(driver);

        return record;
    }

    /// <summary>RN-PROT-002 e RN-IMPORT-023: a conexão de destino somente leitura, pela proteção dela ou de uma pasta acima, como está no cofre agora.</summary>
    public static async Task<UnitResult<ApiErrorDto>> WritableAsync(IConnectionQueries connectionQueries, Guid connectionID, CancellationToken cancellationToken)
    {
        var readOnly = await connectionQueries.IsReadOnly(connectionID, cancellationToken);
        if (readOnly.IsFailure)
            return VaultErrors.From(readOnly.Error);

        if (readOnly.Value is null)
            return ConnectionErrors.NotFound(connectionID);

        return readOnly.Value == true ? UnitResult.Failure(ImportErrors.ReadOnly()) : UnitResult.Success<ApiErrorDto>();
    }

    /// <summary>
    /// RN-IMPORT-023: a tabela de destino é a própria origem, quando a origem é a tabela pelo navegador: a mesma tabela pela regra da própria origem (o
    /// mesmo servidor, porta e banco de dados, também por outra conexão, e o mesmo esquema e nome). O comando dos Registros e do resultado não é
    /// reconhecido pelo texto.
    /// </summary>
    public static bool TargetIsSource(ExportSourceDto source, VaultConnectionRecord sourceRecord, ImportTargetDto target, VaultConnectionRecord targetRecord)
        => source.Kind == "table" && TablePlaces.SameTable(TransferConnections.SettingsOf(sourceRecord, source.Database), source.Schema!, source.Table!, TransferConnections.SettingsOf(targetRecord, target.Database), target.Schema!, target.Table!);
}
