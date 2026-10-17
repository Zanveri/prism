using CSharpFunctionalExtensions;
using Prism.Application.Transfers.Models;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Services;
using System.Globalization;
using System.Text.Json;

namespace Prism.Application.Transfers.Features.ReadImportFile;

/// <summary>
/// RN-IMPORT-007: `POST api/user/transfers/imports/read`. `Reader` são as opções do leitor do formato, lidas à mão (`ImportReaderOptionsReader`), para o tipo
/// errado ser a recusa no campo, e não o 400 do MVC. O `ToString()` só diz o tipo (RN-LOG-001).
/// </summary>
public sealed record ReadImportFileCommand : IRequest<Result<ImportReadDto, ApiErrorDto>>
{
    public string? FileID { get; init; }
    public string? Format { get; init; }
    public JsonElement? Reader { get; init; }

    public override string ToString()
        => nameof(ReadImportFileCommand);
}

/// <summary>
/// RN-IMPORT-007 e 017: a prévia do arquivo, lida do `&lt;fileID&gt;.in` da pasta `transfers`, sem mudá-lo nem tomá-lo: o que a leitura achou (a codificação
/// e o separador do automático, as chaves do JSON, as planilhas) e as primeiras 20 linhas, como foram lidas. Não fala com banco nenhum.
/// </summary>
internal sealed class ReadImportFileHandler(IImportPreviewService importPreviewService) : IRequestHandler<ReadImportFileCommand, Result<ImportReadDto, ApiErrorDto>>
{
    public async Task<Result<ImportReadDto, ApiErrorDto>> Handle(ReadImportFileCommand request, CancellationToken cancellationToken)
    {
        var (options, _) = ImportReaderOptionsReader.Read(request.Format!, request.Reader, keys: false);
        var read = await importPreviewService.ReadAsync(Guid.Parse(request.FileID!, CultureInfo.InvariantCulture), request.Format!, options!, cancellationToken);

        return read.IsFailure ? ImportErrors.From(read.Error) : read.Value.ToDto();
    }
}
