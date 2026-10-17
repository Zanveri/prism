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
using Prism.Infrastructure.Transfers.Services;
using System.Globalization;
using System.Text.Json;

namespace Prism.Application.Transfers.Features.PreviewImport;

/// <summary>
/// RN-IMPORT-009 a 011: `POST api/user/transfers/imports/preview`. `Reader` são as opções do leitor, lidas à mão; `Mapping` ausente pede o mapeamento
/// automático. Leva os nomes do banco: o `ToString()` só diz o tipo (RN-LOG-001).
/// </summary>
public sealed record PreviewImportCommand : IRequest<Result<ImportPreviewDto, ApiErrorDto>>
{
    public string? FileID { get; init; }
    public string? Format { get; init; }
    public JsonElement? Reader { get; init; }
    public ImportValuesDto? Values { get; init; }
    public ImportTargetDto? Target { get; init; }
    public IReadOnlyList<ImportMappingDto?>? Mapping { get; init; }

    public override string ToString()
        => nameof(PreviewImportCommand);
}

/// <summary>
/// RN-IMPORT-009 a 011, na ordem do começo da importação (RN-IMPORT-014), sem tocar no banco até a prévia: (1) a forma do pedido, no validator; (2) o
/// arquivo (404 `IMPORT_FILE_MISSING`, 422 `IMPORT_FILE_TOO_LARGE`); (3) a conexão de destino (404), o banco de dados pedido, o usuário e a senha, o driver
/// e o somente leitura pelas proteções que valem no cofre agora (422 `CONNECTION_READ_ONLY`). Então a prévia: o arquivo lido, o catálogo da tabela numa
/// conexão à parte, o mapeamento e as 20 primeiras linhas convertidas.
/// </summary>
internal sealed class PreviewImportHandler(IConnectionQueries connectionQueries, IDriverService driverService, IImportPreviewService importPreviewService) : IRequestHandler<PreviewImportCommand, Result<ImportPreviewDto, ApiErrorDto>>
{
    public async Task<Result<ImportPreviewDto, ApiErrorDto>> Handle(PreviewImportCommand request, CancellationToken cancellationToken)
    {
        var target = request.Target!;
        var fileID = Guid.Parse(request.FileID!, CultureInfo.InvariantCulture);
        if (importPreviewService.CheckFile(fileID) is { } refusal)
            return Result.Failure<ImportPreviewDto, ApiErrorDto>(refusal.Kind switch
            {
                EImportFileRefusal.Missing => ImportErrors.FileMissing(),
                EImportFileRefusal.TooLarge => ImportErrors.FileTooLarge(refusal),
                _ => ImportErrors.Unreadable(new ImportReadFailure(EImportReadReason.System, refusal.Reason ?? "Não foi possível ler o arquivo copiado."))
            });

        var read = await connectionQueries.GetRecordByID(target.ConnectionID, cancellationToken);
        if (read.IsFailure)
            return Result.Failure<ImportPreviewDto, ApiErrorDto>(VaultErrors.From(read.Error));

        if (read.Value is not { } record)
            return Result.Failure<ImportPreviewDto, ApiErrorDto>(ConnectionErrors.NotFound(target.ConnectionID));

        if (!TransferConnections.IsDatabaseName(target.Database))
            return Result.Failure<ImportPreviewDto, ApiErrorDto>(TransferJobErrors.DatabaseNameInvalid());

        // RN-TRANSF-016 e RN-IMPORT-013: a conexão que veio sem usuário ou sem senha não conecta; a recusa diz qual falta.
        if (string.IsNullOrEmpty(record.UserName) || string.IsNullOrEmpty(record.Password))
            return Result.Failure<ImportPreviewDto, ApiErrorDto>(ImportErrors.CredentialsMissing(userNameMissing: string.IsNullOrEmpty(record.UserName)));

        if (driverService.RefusalFor(record.Engine) is { } driver)
            return Result.Failure<ImportPreviewDto, ApiErrorDto>(DatabaseSessionErrors.From(driver));

        // RN-PROT-002 e 004: a proteção da conexão ou de uma pasta acima, como está no cofre agora.
        var readOnly = await connectionQueries.IsReadOnly(record.ID, cancellationToken);
        if (readOnly.IsFailure)
            return Result.Failure<ImportPreviewDto, ApiErrorDto>(VaultErrors.From(readOnly.Error));

        if (readOnly.Value is null)
            return Result.Failure<ImportPreviewDto, ApiErrorDto>(ConnectionErrors.NotFound(target.ConnectionID));

        if (readOnly.Value == true)
            return Result.Failure<ImportPreviewDto, ApiErrorDto>(ImportErrors.ReadOnly());

        var (options, _) = ImportReaderOptionsReader.Read(request.Format!, request.Reader, keys: true);
        var settings = TransferConnections.SettingsOf(record, target.Database);
        var mapping = request.Mapping?.Select(entry => new ImportMappingEntry(entry!.Source, entry.Target!)).ToList();
        var preview = await importPreviewService.PreviewAsync(new ImportPreviewRequest(fileID, request.Format!, options!, ImportRequestRules.Formats(request.Values), settings, target.Schema!, target.Table!, mapping), cancellationToken);

        return preview.IsFailure ? ImportErrors.From(preview.Error) : preview.Value.ToDto();
    }
}
