using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.Transfers.Models;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Drivers.Services;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Services;
using Prism.Infrastructure.Vault.Services;
using System.Globalization;
using System.Text.Json;

namespace Prism.Application.Transfers.Features.StartImport;

/// <summary>
/// RN-IMPORT-014: `POST api/user/transfers/imports`. `Reader` são as opções do leitor e `Load` a carga, lidas à mão para o tipo errado ser a recusa no
/// campo. Leva os nomes do banco: o `ToString()` só diz o tipo (RN-LOG-001).
/// </summary>
public sealed record StartImportCommand : IRequest<Result<TransferStartedDto, ApiErrorDto>>
{
    public string? FileID { get; init; }
    public string? Format { get; init; }
    public JsonElement? Reader { get; init; }
    public ImportValuesDto? Values { get; init; }
    public ImportTargetDto? Target { get; init; }
    public IReadOnlyList<ImportMappingDto?>? Mapping { get; init; }
    public JsonElement? Load { get; init; }
    public long WindowID { get; init; }

    public override string ToString()
        => nameof(StartImportCommand);
}

/// <summary>
/// RN-IMPORT-014, na ordem da regra, sem tocar no banco antes do 202: (1) a forma do pedido, no validator; (2) o arquivo (404 `IMPORT_FILE_MISSING`, 422
/// `IMPORT_FILE_TOO_LARGE`); (3) a conexão de destino (404), o banco de dados pedido, o usuário e a senha (no campo), o driver e o somente leitura pelas
/// proteções que valem no cofre agora; (4) o limite, a tabela ocupada e a troca de nome do arquivo, no registro, sob a trava com que o trabalho entra
/// nele. Conectar, ler o catálogo, conferir o arquivo e gravar acontecem no trabalho.
/// </summary>
internal sealed class StartImportHandler(IConnectionQueries connectionQueries, IVaultService vaultService, IDriverService driverService, IImportPreviewService importPreviewService, ITransferService transferService) : IRequestHandler<StartImportCommand, Result<TransferStartedDto, ApiErrorDto>>
{
    public async Task<Result<TransferStartedDto, ApiErrorDto>> Handle(StartImportCommand request, CancellationToken cancellationToken)
    {
        var target = request.Target!;
        var fileID = Guid.Parse(request.FileID!, CultureInfo.InvariantCulture);
        // A seção 6 dá a este passo só o 404 e o 422 do tamanho: o arquivo que o sistema não deixa abrir não é do trabalho, como o que não se deixa
        // renomear no registro, e a resposta é a do que sumiu: a tela pede o arquivo de novo.
        if (importPreviewService.CheckFile(fileID) is { } refusal)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(refusal.Kind == EImportFileRefusal.TooLarge ? ImportErrors.FileTooLarge(refusal) : ImportErrors.FileMissing());

        // A geração do cofre é lida ANTES das credenciais, como na abertura de uma sessão: o registro a confere quando o trabalho entra nele.
        var generation = vaultService.Generation;
        var read = await connectionQueries.GetRecordByID(target.ConnectionID, cancellationToken);
        if (read.IsFailure)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(VaultErrors.From(read.Error));

        if (read.Value is not { } record)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(ConnectionErrors.NotFound(target.ConnectionID));

        if (!TransferConnections.IsDatabaseName(target.Database))
            return Result.Failure<TransferStartedDto, ApiErrorDto>(TransferJobErrors.DatabaseNameInvalid());

        // RN-TRANSF-016 e RN-IMPORT-013: a conexão que veio sem usuário ou sem senha não conecta; a recusa diz qual falta.
        if (string.IsNullOrEmpty(record.UserName) || string.IsNullOrEmpty(record.Password))
            return Result.Failure<TransferStartedDto, ApiErrorDto>(ImportErrors.CredentialsMissing(userNameMissing: string.IsNullOrEmpty(record.UserName)));

        if (driverService.RefusalFor(record.Engine) is { } driver)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(DatabaseSessionErrors.From(driver));

        // RN-PROT-002 e 004: a proteção da conexão ou de uma pasta acima, como está no cofre agora.
        var readOnly = await connectionQueries.IsReadOnly(record.ID, cancellationToken);
        if (readOnly.IsFailure)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(VaultErrors.From(readOnly.Error));

        if (readOnly.Value is null)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(ConnectionErrors.NotFound(target.ConnectionID));

        if (readOnly.Value == true)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(ImportErrors.ReadOnly());

        var (options, _) = ImportReaderOptionsReader.Read(request.Format!, request.Reader, keys: true);
        var (load, _) = ImportRequestRules.Load(request.Load, copy: false);
        var job = new ImportJob(fileID, record.ID, TransferConnections.SettingsOf(record, target.Database), generation, request.WindowID, request.Format!, options!, ImportRequestRules.Formats(request.Values), target.Schema!, target.Table!, ImportRequestRules.MappingOf(request.Mapping!), load!, TransferConnections.StopNow(connectionQueries, record.ID));

        var started = transferService.StartImport(job);
        if (started.IsFailure)
            return Result.Failure<TransferStartedDto, ApiErrorDto>(TransferConnections.StartRefusal(started.Error, target.Schema!, target.Table!));

        // RN-CONN-014: a exclusão da conexão pode terminar enquanto o trabalho entra no registro, e o cancelamento dela não o acharia. A exclusão grava
        // antes de cancelar, então uma leitura feita agora já a enxerga: sem a conexão (ou com o cofre fechado), o trabalho não fica.
        var confirmed = await connectionQueries.GetRecordByID(target.ConnectionID, cancellationToken);
        if (confirmed is { IsSuccess: true, Value: not null })
            return Result.Success<TransferStartedDto, ApiErrorDto>(new TransferStartedDto(started.Value));

        await transferService.DeleteAsync(started.Value);
        await transferService.DeleteAsync(started.Value);

        return Result.Failure<TransferStartedDto, ApiErrorDto>(confirmed.IsFailure ? VaultErrors.From(confirmed.Error) : ConnectionErrors.NotFound(target.ConnectionID));
    }
}
