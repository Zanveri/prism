using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Queries;
using Prism.Application.Transfers.Models;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Drivers.Services;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Services;
using Prism.Infrastructure.Vault.Services;
using System.Text.Json;

namespace Prism.Application.Transfers.Features.StartCopy;

/// <summary>
/// RN-IMPORT-027: `POST api/user/transfers/copies`. `Load` é a carga, lida à mão para o tipo errado ser a recusa no campo. Leva o comando e os nomes do
/// banco: o `ToString()` só diz o tipo (RN-LOG-001).
/// </summary>
public sealed record StartCopyCommand : IRequest<Result<TransferStartedDto, ApiErrorDto>>
{
    public ExportSourceDto? Source { get; init; }
    public IReadOnlyList<ExportColumnDto>? Columns { get; init; }
    public bool Count { get; init; }
    public ImportTargetDto? Target { get; init; }
    public IReadOnlyList<ImportMappingDto?>? Mapping { get; init; }
    public JsonElement? Load { get; init; }
    public long WindowID { get; init; }

    public override string ToString()
        => nameof(StartCopyCommand);
}

/// <summary>
/// RN-IMPORT-027, na ordem da regra, antes do 202 e sem tocar nos bancos: (1) a forma do pedido, no validator, e a posição do mapeamento além das colunas
/// pedidas (`IMPORT_MAPPING_INVALID`); (2) a origem, nas regras da exportação (a conexão, o banco de dados, as credenciais, o driver, um comando só, o
/// filtro e a leitura); (3) o destino (a conexão, o banco de dados, as credenciais, o driver, o somente leitura e a própria origem); (4) o limite e a
/// tabela ocupada, no registro, sob a trava com que o trabalho entra nele. RN-IMPORT-023: na cópia de Db2 ou de Informix com a origem e o destino no
/// mesmo servidor, porta e banco de dados, a contagem é obrigatória, mesmo com `count: false`.
/// </summary>
internal sealed class StartCopyHandler(IConnectionQueries connectionQueries, IVaultService vaultService, IDriverService driverService, ITransferService transferService) : IRequestHandler<StartCopyCommand, Result<TransferStartedDto, ApiErrorDto>>
{
    public async Task<Result<TransferStartedDto, ApiErrorDto>> Handle(StartCopyCommand request, CancellationToken cancellationToken)
    {
        var source = request.Source!;
        var target = request.Target!;
        var columns = request.Columns!;
        if (ImportRequestRules.SourceRefusal(request.Mapping, columns.Count) is { } position)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(ImportErrors.MappingInvalid(position.Field, position.Message));

        // A geração do cofre é lida ANTES das credenciais, como na abertura de uma sessão: o registro a confere quando o trabalho entra nele.
        var generation = vaultService.Generation;
        var sourceRecord = await CopyChecks.ConnectionAsync(connectionQueries, driverService, source.ConnectionID, source.Database, source: true, credentials: true, cancellationToken);
        if (sourceRecord.IsFailure)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(sourceRecord.Error);

        var sql = source.Kind == "table"
            ? ExportSql.Table(source.Schema!, source.Table!, columns.OrderBy(column => column.Position).Select(column => column.Name!))
            : ExportSql.Query(source.Sql!, source.Filter, sourceRecord.Value.Engine);
        if (sql.IsFailure)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(TransferJobErrors.From(sql.Error));

        var targetRecord = await CopyChecks.ConnectionAsync(connectionQueries, driverService, target.ConnectionID, target.Database, source: false, credentials: true, cancellationToken);
        if (targetRecord.IsFailure)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(targetRecord.Error);

        var writable = await CopyChecks.WritableAsync(connectionQueries, target.ConnectionID, cancellationToken);
        if (writable.IsFailure)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(writable.Error);

        if (CopyChecks.TargetIsSource(source, sourceRecord.Value, target, targetRecord.Value))
            return Result.Failure<TransferStartedDto, ApiErrorDto>(ImportErrors.TargetIsSource());

        var sourceSettings = TransferConnections.SettingsOf(sourceRecord.Value, source.Database);
        var targetSettings = TransferConnections.SettingsOf(targetRecord.Value, target.Database);
        var forcedCount = sourceSettings.Engine is EDatabaseEngine.Db2 or EDatabaseEngine.Informix && TablePlaces.SameServer(sourceSettings, targetSettings);
        var (load, _) = ImportRequestRules.Load(request.Load, copy: true);
        var job = new CopyJob(sourceRecord.Value.ID, sourceSettings, sql.Value, [.. columns.Select(column => new ExportColumnChoice(column.Position, column.Name!))], source.Kind == "query", request.Count, forcedCount, targetRecord.Value.ID, targetSettings, target.Schema!, target.Table!, ImportRequestRules.MappingOf(request.Mapping!), load!, generation, request.WindowID, TransferConnections.StopNow(connectionQueries, targetRecord.Value.ID));

        var started = transferService.StartCopy(job);
        if (started.IsFailure)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(TransferConnections.StartRefusal(started.Error, target.Schema!, target.Table!));

        // RN-CONN-014: como na exportação, a exclusão de qualquer das duas conexões enquanto o trabalho entra no registro: o trabalho não fica.
        var confirmedSource = await connectionQueries.GetRecordByID(source.ConnectionID, cancellationToken);
        var confirmedTarget = await connectionQueries.GetRecordByID(target.ConnectionID, cancellationToken);
        if (confirmedSource is { IsSuccess: true, Value: not null } && confirmedTarget is { IsSuccess: true, Value: not null })
            return Result.Success<TransferStartedDto, ApiErrorDto>(new TransferStartedDto(started.Value));

        await transferService.DeleteAsync(started.Value);
        await transferService.DeleteAsync(started.Value);

        if (confirmedSource.IsFailure)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(VaultErrors.From(confirmedSource.Error));

        if (confirmedTarget.IsFailure)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(VaultErrors.From(confirmedTarget.Error));

        return Result.Failure<TransferStartedDto, ApiErrorDto>(ConnectionErrors.NotFound(confirmedSource.Value is null ? source.ConnectionID : target.ConnectionID));
    }
}
