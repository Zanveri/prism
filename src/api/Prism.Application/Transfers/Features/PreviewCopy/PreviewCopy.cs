using CSharpFunctionalExtensions;
using Prism.Application.Connections.Queries;
using Prism.Application.Transfers.Models;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Drivers.Services;
using Prism.Infrastructure.Transfers.Services;

namespace Prism.Application.Transfers.Features.PreviewCopy;

/// <summary>
/// RN-IMPORT-024: `POST api/user/transfers/copies/preview`. A origem como a da exportação, as colunas marcadas na Extração, a tabela de destino e o
/// mapeamento, quando vem (ausente, a resposta traz o sugerido pelo nome). Leva o comando e os nomes do banco: o `ToString()` só diz o tipo (RN-LOG-001).
/// </summary>
public sealed record PreviewCopyCommand : IRequest<Result<CopyPreviewDto, ApiErrorDto>>
{
    public ExportSourceDto? Source { get; init; }
    public IReadOnlyList<ExportColumnDto>? Columns { get; init; }
    public ImportTargetDto? Target { get; init; }
    public IReadOnlyList<ImportMappingDto?>? Mapping { get; init; }

    public override string ToString()
        => nameof(PreviewCopyCommand);
}

/// <summary>
/// RN-IMPORT-024: (1) a forma do pedido, no validator; (2) a posição do mapeamento além das colunas pedidas (`IMPORT_MAPPING_INVALID`); (3) a conexão de
/// origem (que diz o servidor, para a regra da própria origem) e a de destino, com o banco de dados, o usuário e a senha e o driver do destino, e o
/// somente leitura dele; (4) a tabela de destino que é a própria origem (`IMPORT_TARGET_IS_SOURCE`). Então o catálogo da tabela de destino, numa conexão
/// à parte, e o mapeamento. A origem não é lida.
/// </summary>
internal sealed class PreviewCopyHandler(IConnectionQueries connectionQueries, IDriverService driverService, IImportPreviewService importPreviewService) : IRequestHandler<PreviewCopyCommand, Result<CopyPreviewDto, ApiErrorDto>>
{
    public async Task<Result<CopyPreviewDto, ApiErrorDto>> Handle(PreviewCopyCommand request, CancellationToken cancellationToken)
    {
        var source = request.Source!;
        var target = request.Target!;
        if (ImportRequestRules.SourceRefusal(request.Mapping, request.Columns!.Count) is { } position)
            return Result.Failure<CopyPreviewDto, ApiErrorDto>(ImportErrors.MappingInvalid(position.Field, position.Message));

        var sourceRecord = await CopyChecks.ConnectionAsync(connectionQueries, driverService, source.ConnectionID, source.Database, source: true, credentials: false, cancellationToken);
        if (sourceRecord.IsFailure)
            return Result.Failure<CopyPreviewDto, ApiErrorDto>(sourceRecord.Error);

        var targetRecord = await CopyChecks.ConnectionAsync(connectionQueries, driverService, target.ConnectionID, target.Database, source: false, credentials: true, cancellationToken);
        if (targetRecord.IsFailure)
            return Result.Failure<CopyPreviewDto, ApiErrorDto>(targetRecord.Error);

        var writable = await CopyChecks.WritableAsync(connectionQueries, target.ConnectionID, cancellationToken);
        if (writable.IsFailure)
            return Result.Failure<CopyPreviewDto, ApiErrorDto>(writable.Error);

        if (CopyChecks.TargetIsSource(source, sourceRecord.Value, target, targetRecord.Value))
            return Result.Failure<CopyPreviewDto, ApiErrorDto>(ImportErrors.TargetIsSource());

        var mapping = request.Mapping is null ? null : ImportRequestRules.MappingOf(request.Mapping);
        var settings = TransferConnections.SettingsOf(targetRecord.Value, target.Database);
        var preview = await importPreviewService.PreviewCopyAsync(new CopyPreviewRequest(settings, target.Schema!, target.Table!, [.. request.Columns.Select(column => column.Name!)], mapping), cancellationToken);

        return preview.IsFailure ? ImportErrors.From(preview.Error) : preview.Value.ToDto();
    }
}
