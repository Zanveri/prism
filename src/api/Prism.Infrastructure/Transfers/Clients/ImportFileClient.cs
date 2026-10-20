using CSharpFunctionalExtensions;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Models;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Transfers.Clients;

/// <summary>
/// RN-IMPORT-017: o arquivo de uma importação na pasta `transfers`, que o processo principal copiou (`&lt;fileId&gt;.in`), com o nome tirado só do
/// identificador. As prévias o leem sem mudá-lo nem tomá-lo; o começo da importação o toma (<see cref="Take"/>), e o trabalho o lê pelo identificador dele.
/// O único `try` do disco dele está no <see cref="Send{T}"/>.
/// </summary>
internal interface IImportFileClient
{
    /// <summary>
    /// Abre `&lt;fileID&gt;.in` só para leitura, deixando que ele seja renomeado e apagado enquanto está aberto (`FileShare.Delete`, no Windows): a leitura
    /// de uma prévia atrasada não impede o começo da importação nem a limpeza. Recusa o que não existe e o que passa de 2 GiB.
    /// </summary>
    Result<FileStream, ImportFileRefusal> Open(Guid fileID);

    /// <summary>A mesma conferência do <see cref="Open"/>, sem deixar o arquivo aberto.</summary>
    ImportFileRefusal? Check(Guid fileID);

    /// <summary>
    /// RN-IMPORT-014: o começo da importação toma o arquivo: `&lt;fileID&gt;.in` passa a se chamar `&lt;jobID&gt;.in`, e daí em diante é do trabalho (o
    /// processo principal não o acha mais para apagar). Recusa (`Missing`) o arquivo que sumiu entre a conferência e a troca de nome.
    /// </summary>
    ImportFileRefusal? Take(Guid fileID, Guid jobID);
}

internal sealed class ImportFileClient(TransferSettings settings, ILogger logger) : IImportFileClient
{
    /// <summary>RN-IMPORT-008: o arquivo tem até 2 GiB.</summary>
    public const long MaxBytes = 2L * 1024 * 1024 * 1024;

    private readonly ILogger _logger = logger.ForContext<ImportFileClient>();

    public Result<FileStream, ImportFileRefusal> Open(Guid fileID)
    {
        var opened = Send(() =>
        {
            var path = PathOf(fileID);
            if (!File.Exists(path))
                return null;

            return new FileStream(path, new FileStreamOptions { Mode = FileMode.Open, Access = FileAccess.Read, Share = FileShare.ReadWrite | FileShare.Delete, BufferSize = 64 * 1024 });
        });

        if (opened.IsFailure)
            return opened.Error;

        if (opened.Value is not { } stream)
            return new ImportFileRefusal(EImportFileRefusal.Missing);

        if (stream.Length <= MaxBytes)
            return stream;

        var size = stream.Length;
        stream.Dispose();

        return new ImportFileRefusal(EImportFileRefusal.TooLarge, size);
    }

    public ImportFileRefusal? Check(Guid fileID)
    {
        var opened = Open(fileID);
        if (opened.IsFailure)
            return opened.Error;

        opened.Value.Dispose();

        return null;
    }

    public ImportFileRefusal? Take(Guid fileID, Guid jobID)
    {
        var taken = Send(() =>
        {
            // A prévia atrasada que ainda o lê não impede a troca: o `.in` é aberto com `FileShare.Delete`.
            File.Move(PathOf(fileID), PathOf(jobID));

            return true;
        });

        return taken.IsFailure ? taken.Error : null;
    }

    /// <summary>RN-IMPORT-017: o nome sai só do identificador, na forma de 36 caracteres em minúsculas com os hifens que o processo principal dá.</summary>
    private string PathOf(Guid fileID)
        => Path.Combine(settings.Directory, $"{fileID:D}.in");

    /// <summary>O único `try` do arquivo. O log recebe a classe do erro e o `HResult`, nunca a mensagem, que traz o caminho (RN-LOG-001). O arquivo que some entre a conferência e a abertura é o que não existe.</summary>
    private Result<T, ImportFileRefusal> Send<T>(Func<T> call)
    {
        try
        {
            return call();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            if (exception is FileNotFoundException or DirectoryNotFoundException)
                return new ImportFileRefusal(EImportFileRefusal.Missing);

            _logger.Warning("O arquivo da importação não abriu ({ExceptionType}, HResult {HResult}).", exception.GetType().Name, exception.HResult);

            return new ImportFileRefusal(EImportFileRefusal.Unreadable, Reason: $"Não foi possível ler o arquivo copiado (código {exception.HResult & 0xFFFF}).");
        }
    }
}
