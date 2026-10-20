using CSharpFunctionalExtensions;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.ConnectionFiles.Services;

namespace Prism.Application.ConnectionTransfers.Models;

/// <summary>
/// RN-TRANSF-010: a leitura do arquivo, a mesma na prévia e na importação, nas etapas 3 a 7: o cabeçalho sem derivar nada (`IMPORT_FILE_INVALID` e
/// `IMPORT_FILE_NEWER`), a chave derivada da senha (sem os espaços das pontas, na forma NFC) na fila das derivações, fora da trava do cofre, o conteúdo
/// aberto (`IMPORT_PASSPHRASE_WRONG`, a mesma recusa para a senha errada e o arquivo alterado) e lido, e a estrutura e os itens conferidos. Cada pedido
/// deriva de novo: a API não guarda nada da importação de um pedido para o outro. A senha errada não conta no contador de cinco erros do cofre.
/// </summary>
internal static class ImportFiles
{
    public static async Task<Result<ImportAnalysis, ApiErrorDto>> OpenAsync(IConnectionFileService fileService, string content, string passphrase, CancellationToken cancellationToken)
    {
        var opened = await fileService.OpenAsync(content, PassphraseRules.ForImport(passphrase), ImportedFile.Read, cancellationToken);
        if (opened.IsFailure)
            return TransferErrors.From(opened.Error);

        return opened.Value.Outcome switch
        {
            EImportedFileRead.Read => ImportAnalysis.Analyze(opened.Value.File!),
            EImportedFileRead.LimitsExceeded => TransferErrors.ImportLimitsExceeded(),
            _ => TransferErrors.FileInvalid()
        };
    }
}
