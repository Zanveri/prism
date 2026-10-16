using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.Transfers.Models;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Drivers.Services;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Services;
using Prism.Infrastructure.Transfers.Writers;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using System.Text.Json;

namespace Prism.Application.Transfers.Features.StartExport;

/// <summary>
/// RN-EXPORT-016: `POST api/user/transfers/exports`. Leva o comando e os nomes do banco: o `ToString()` só diz o tipo (RN-LOG-001). `Options` é o objeto
/// das opções do formato, lido à mão (`ExportOptionsReader`) para o tipo errado ser a recusa no campo, e não o 400 do MVC.
/// </summary>
public sealed record StartExportCommand : IRequest<Result<TransferStartedDto, ApiErrorDto>>
{
    public ExportSourceDto? Source { get; init; }
    public IReadOnlyList<ExportColumnDto>? Columns { get; init; }
    public bool Count { get; init; }
    public string? Format { get; init; }
    public JsonElement? Options { get; init; }
    public ExportOutputDto? Output { get; init; }
    public long WindowID { get; init; }

    public override string ToString()
        => nameof(StartExportCommand);
}

/// <summary>
/// RN-EXPORT-016, na ordem da regra, sem tocar no banco antes do 202: (1) a forma do pedido, no validator; (2) a conexão (404), o banco de dados pedido
/// (`DATABASE_NAME_INVALID`), o usuário e a senha (`CONNECTION_CREDENTIALS_MISSING`, no campo) e o driver (`DRIVER_NOT_INSTALLED`), como na abertura de
/// uma sessão; (3) o que depende do banco da conexão: mais de um comando, o filtro e a leitura, pelo dialeto dele (RN-PROT-005), e as linhas por comando
/// no Informix; (4) o limite e o cofre, no registro, sob a trava com que o trabalho entra nele.
/// </summary>
internal sealed class StartExportHandler(IConnectionQueries connectionQueries, IVaultService vaultService, IDriverService driverService, ITransferService transferService) : IRequestHandler<StartExportCommand, Result<TransferStartedDto, ApiErrorDto>>
{
    /// <summary>RN-ARVORE-006: o teto do nome de outro banco do servidor, o mesmo da abertura de uma sessão.</summary>
    private const int MaxDatabaseLength = 128;

    /// <summary>RN-EXPORT-006: o nome da origem do resultado de uma consulta.</summary>
    private const string ResultName = "resultado";

    public async Task<Result<TransferStartedDto, ApiErrorDto>> Handle(StartExportCommand request, CancellationToken cancellationToken)
    {
        var source = request.Source!;

        // A geração do cofre é lida ANTES das credenciais, como na abertura de uma sessão: o registro a confere quando o trabalho entra nele.
        var generation = vaultService.Generation;
        var read = await connectionQueries.GetRecordByID(source.ConnectionID, cancellationToken);
        if (read.IsFailure)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(VaultErrors.From(read.Error));

        if (read.Value is not { } record)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(ConnectionErrors.NotFound(source.ConnectionID));

        if (source.Database is { } database && (string.IsNullOrWhiteSpace(database) || database.Length > MaxDatabaseLength || database.Any(char.IsControl)))
            return Result.Failure<TransferStartedDto, ApiErrorDto>(TransferJobErrors.DatabaseNameInvalid());

        // RN-TRANSF-016 e RN-EXPORT-015: a conexão que veio sem usuário ou sem senha não conecta; a recusa diz qual falta. A conta é a da abertura de uma
        // sessão (`OpenDatabaseSessionHandler`): o usuário só de espaços também falta.
        if (string.IsNullOrWhiteSpace(record.UserName) || string.IsNullOrEmpty(record.Password))
            return Result.Failure<TransferStartedDto, ApiErrorDto>(TransferJobErrors.CredentialsMissing(userNameMissing: string.IsNullOrWhiteSpace(record.UserName)));

        // RN-DRIVER-006: sem o driver o trabalho nem começa (e a plataforma sem driver também não conecta).
        if (driverService.RefusalFor(record.Engine) is { } refusal)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(DatabaseSessionErrors.From(refusal));

        var command = CommandOf(source, request.Columns!, record.Engine);
        if (command.IsFailure)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(TransferJobErrors.From(command.Error));

        var (options, _) = ExportOptionsReader.Read(request.Format!, request.Options, ExportRequestRules.DefaultTable(source));
        if (options is SqlExportOptions { RowsPerStatement: > 1 } && record.Engine == EDatabaseEngine.Informix)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(TransferJobErrors.InformixRowsPerStatement());

        var output = request.Output ?? new();
        var columns = request.Columns!.OrderBy(column => column.Position).Select(column => new ExportColumnChoice(column.Position, column.Name!)).ToList();
        var settings = new ConnectionSettings(record.Engine, record.Host, record.Port, source.Database ?? record.Database, record.UserName, record.Password);
        var job = new ExportJob(record.ID, settings, generation, request.WindowID, command.Value, columns, source.Kind == "query", request.Count, request.Format!, options!, source.Kind == "table" ? source.Table! : source.Name ?? ResultName, output.Bom, output.Zip ? output.EntryName : null, output.Clipboard);

        var started = transferService.StartExport(job);
        if (started.IsFailure)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(started.Error == ETransferStartFailure.LimitReached ? TransferJobErrors.LimitReached() : VaultErrors.From(EVaultError.Locked));

        // RN-CONN-014: a exclusão da conexão pode terminar enquanto o trabalho entra no registro, e o cancelamento dela não o acharia. A exclusão grava
        // antes de cancelar, então uma leitura feita agora já a enxerga: sem a conexão (ou com o cofre fechado), o trabalho não fica.
        var confirmed = await connectionQueries.GetRecordByID(source.ConnectionID, cancellationToken);
        if (confirmed is { IsSuccess: true, Value: not null })
            return Result.Success<TransferStartedDto, ApiErrorDto>(new TransferStartedDto(started.Value));

        await transferService.DeleteAsync(started.Value);
        await transferService.DeleteAsync(started.Value);

        return Result.Failure<TransferStartedDto, ApiErrorDto>(confirmed.IsFailure ? VaultErrors.From(confirmed.Error) : ConnectionErrors.NotFound(source.ConnectionID));
    }

    /// <summary>
    /// RN-EXPORT-002: o comando que a exportação executa. Na tabela, o `SELECT` das colunas marcadas, pelo nome e na ordem da posição, montado pela API; nos
    /// Registros e no resultado, o comando como foi executado, com o filtro, conferido de novo como leitura pelo dialeto do banco.
    /// </summary>
    private static Result<string, ExportSqlRefusal> CommandOf(ExportSourceDto source, IReadOnlyList<ExportColumnDto> columns, EDatabaseEngine engine)
        => source.Kind == "table"
            ? ExportSql.Table(source.Schema!, source.Table!, columns.OrderBy(column => column.Position).Select(column => column.Name!))
            : ExportSql.Query(source.Sql!, source.Filter, engine);
}
