using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Writers;
using System.IO.Compression;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Transfers.Clients;

/// <summary>
/// RN-EXPORT-018: o disco da pasta `transfers`, a quarta integração (a do arquivo temporário das transferências), com o único `try` dela no
/// <see cref="Send{T}"/>. O nome de cada arquivo vem só do identificador do trabalho (`&lt;id&gt;.part` enquanto escreve, `&lt;id&gt;.ready` depois de
/// completo, fechado e gravado no disco); nenhum nome nem pedaço de caminho vem da tela.
/// </summary>
internal interface ITransferFileClient
{
    /// <summary>
    /// Na partida: cria a pasta quando falta (no Linux e no macOS com o modo 0700, dado na criação), volta a 0700 a que já existe com um modo mais
    /// aberto, e apaga tudo o que encontra nela (o que sobrou de uma execução que caiu: nenhum trabalho atravessa uma partida). O que não se apaga na hora
    /// fica para a partida seguinte. Não falha.
    /// </summary>
    void Prepare();

    /// <summary>
    /// Cria `&lt;id&gt;.part` (0600 no Linux e no macOS) e, por dentro, a entrada do .zip quando pedida, o BOM quando pedido e o escritor do formato. A pasta
    /// é criada de novo se alguém a apagou.
    /// </summary>
    Result<ExportFile, TransferFileFailure> CreateExport(Guid id, string format, ExportWriterContext context, bool bom, string? zipEntryName);

    /// <summary>O começo do arquivo (a declaração, o cabeçalho).</summary>
    UnitResult<TransferFileFailure> Begin(ExportFile file);

    /// <summary>Um lote de linhas, mandado ao disco; o tamanho do arquivo (`ExportFile.Bytes`) acompanha.</summary>
    UnitResult<TransferFileFailure> Append(ExportFile file, IReadOnlyList<IReadOnlyList<ExportCell>> rows);

    /// <summary>O fim do arquivo, o .zip fechado, o arquivo gravado no disco (`Flush(true)`) e fechado, e só então o nome `&lt;id&gt;.ready`. Devolve o tamanho final.</summary>
    Result<long, TransferFileFailure> Complete(ExportFile file);

    /// <summary>Fecha o arquivo de um trabalho que não terminou, sem completá-lo. Não falha.</summary>
    void Close(ExportFile file);

    /// <summary>
    /// Apaga o `.part` e o `.ready` do trabalho e, na importação, o `.in` que ele tomou (RN-IMPORT-017). O que não se apaga na hora (no Windows, o que o
    /// processo principal está copiando) fica para a partida seguinte. Não falha.
    /// </summary>
    void Delete(Guid id);
}

/// <summary>O arquivo temporário de uma exportação em escrita: o arquivo, o .zip quando há, e o escritor do formato por cima. Não se imprime.</summary>
internal sealed class ExportFile(Guid id, FileStream file, ZipArchive? archive, Stream? entry, ExportWriter writer)
{
    public Guid ID => id;

    public FileStream File => file;

    public ZipArchive? Archive => archive;

    public Stream? Entry => entry;

    public ExportWriter Writer => writer;

    /// <summary>O tamanho do arquivo temporário até o último lote (com o .zip, o compactado até ali).</summary>
    public long Bytes { get; set; }

    public bool Closed { get; set; }

    public override string ToString()
        => nameof(ExportFile);
}

internal sealed class TransferFileClient(TransferSettings settings, ILogger logger) : ITransferFileClient
{
    /// <summary>RN-EXPORT-018: só o dono lê e escreve a pasta e cada arquivo dela.</summary>
    private const UnixFileMode FolderMode = UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute;
    private const UnixFileMode FileMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;

    /// <summary>O `ENOSPC` do Linux e do macOS, que o .NET entrega como o `HResult` da `IOException`.</summary>
    private const int UnixDiskFull = 28;

    private readonly ILogger _logger = logger.ForContext<TransferFileClient>();

    public void Prepare()
    {
        _ = Send(nameof(Prepare), null, () =>
        {
            EnsureFolder();
            if (!OperatingSystem.IsWindows() && (File.GetUnixFileMode(settings.Directory) & ~FolderMode) != 0)
                File.SetUnixFileMode(settings.Directory, FolderMode);

            return true;
        });

        var leftovers = Send(nameof(Prepare), null, () => Directory.GetFiles(settings.Directory));
        foreach (var leftover in leftovers.IsSuccess ? leftovers.Value : [])
            _ = Send(nameof(Prepare), null, () =>
            {
                File.Delete(leftover);

                return true;
            });

        if (leftovers is { IsSuccess: true, Value.Length: > 0 })
            _logger.Information("A partida apagou {Files} arquivos que sobraram na pasta das transferências.", leftovers.Value.Length);

        // RN-EXPORT-018 e RN-DBEAVER-006: as cópias do DBeaver são pastas (`<sourceId>.dbeaver` e a `.dbeaver.part` que o processo principal não terminou), com as
        // senhas do DBeaver dentro: apagadas com o que têm, e não só os arquivos soltos.
        var folders = Send(nameof(Prepare), null, () => Directory.GetDirectories(settings.Directory));
        foreach (var folder in folders.IsSuccess ? folders.Value : [])
            _ = Send(nameof(Prepare), null, () =>
            {
                Directory.Delete(folder, recursive: true);

                return true;
            });

        if (folders is { IsSuccess: true, Value.Length: > 0 })
            _logger.Information("A partida apagou {Folders} pastas que sobraram na pasta das transferências.", folders.Value.Length);
    }

    public Result<ExportFile, TransferFileFailure> CreateExport(Guid id, string format, ExportWriterContext context, bool bom, string? zipEntryName)
        => Send(nameof(CreateExport), id, () =>
        {
            EnsureFolder();
            var options = new FileStreamOptions { Mode = System.IO.FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None };
            if (!OperatingSystem.IsWindows())
                options.UnixCreateMode = FileMode;

            var file = new FileStream(PathOf(id, "part"), options);
            ZipArchive? archive = null;
            Stream? entry = null;
            Stream target = file;

            // RN-EXPORT-014: o arquivo vai dentro do .zip com o nome dele, compactado; o BOM é do arquivo, e vai dentro da entrada.
            if (zipEntryName is not null)
            {
                archive = new ZipArchive(file, ZipArchiveMode.Create, leaveOpen: true);
                entry = target = archive.CreateEntry(zipEntryName, CompressionLevel.Optimal).Open();
            }

            if (bom)
                target.Write(ExportEncoding.Bom);

            return new ExportFile(id, file, archive, entry, ExportFormats.Create(format, context, target));
        });

    public UnitResult<TransferFileFailure> Begin(ExportFile file)
        => Send(nameof(Begin), file.ID, () =>
        {
            file.Writer.Begin();
            file.Writer.Flush();
            file.Bytes = file.File.Position;

            return true;
        });

    public UnitResult<TransferFileFailure> Append(ExportFile file, IReadOnlyList<IReadOnlyList<ExportCell>> rows)
        => Send(nameof(Append), file.ID, () =>
        {
            foreach (var row in rows)
                file.Writer.Write(row);

            file.Writer.Flush();
            file.Bytes = file.File.Position;

            return true;
        });

    public Result<long, TransferFileFailure> Complete(ExportFile file)
        => Send(nameof(Complete), file.ID, () =>
        {
            file.Writer.End();
            file.Entry?.Dispose();
            file.Archive?.Dispose();
            file.File.Flush(flushToDisk: true);
            var bytes = file.File.Length;
            file.File.Dispose();
            file.Closed = true;
            File.Move(PathOf(file.ID, "part"), PathOf(file.ID, "ready"));
            file.Bytes = bytes;

            return bytes;
        });

    public void Close(ExportFile file)
    {
        if (file.Closed)
            return;

        file.Closed = true;

        // Sem o fim do arquivo: o que estiver no buffer vai ou não vai, tanto faz, porque o arquivo será apagado. A entrada e o .zip não são fechados (fechá-los
        // escreveria o índice do .zip), só o arquivo.
        _ = Send(nameof(Close), file.ID, () =>
        {
            file.File.Dispose();

            return true;
        });
    }

    public void Delete(Guid id)
    {
        foreach (var extension in new[] { "part", "ready", "in" })
            _ = Send(nameof(Delete), id, () =>
            {
                File.Delete(PathOf(id, extension));

                return true;
            });
    }

    /// <summary>RN-EXPORT-018: o nome sai só do identificador, na forma de 36 caracteres em minúsculas com os hifens, que o processo principal confere.</summary>
    private string PathOf(Guid id, string extension)
        => Path.Combine(settings.Directory, $"{id:D}.{extension}");

    private void EnsureFolder()
    {
        if (Directory.Exists(settings.Directory))
            return;

        if (OperatingSystem.IsWindows())
            Directory.CreateDirectory(settings.Directory);
        else
            Directory.CreateDirectory(settings.Directory, FolderMode);
    }

    /// <summary>
    /// O único `try` da pasta `transfers`. O log recebe a operação, o trabalho, a classe da exceção e o `HResult`, nunca a mensagem, que traz o caminho
    /// (RN-LOG-001); a falha que não é de disco (um defeito de um escritor) leva também a pilha. O disco cheio é dito à parte.
    /// </summary>
    private Result<T, TransferFileFailure> Send<T>(string operation, Guid? id, Func<T> call)
    {
        try
        {
            return call();
        }
        catch (Exception exception)
        {
            var failure = FailureOf(exception);
            if (exception is IOException or UnauthorizedAccessException)
                _logger.Warning("O arquivo da transferência {TransferID} falhou em {Operation} ({ExceptionType}, HResult {HResult}).", id, operation, exception.GetType().Name, exception.HResult);
            else
                _logger.Error("O arquivo da transferência {TransferID} falhou em {Operation} ({ExceptionType}).{NewLine}{StackTrace}", id, operation, exception.GetType().Name, Environment.NewLine, exception.StackTrace);

            return failure;
        }
    }

    /// <summary>RN-EXPORT-018: o motivo, sem o caminho. O disco cheio é o `ENOSPC` no Linux e no macOS, e os códigos 39 e 112 do Windows.</summary>
    private static TransferFileFailure FailureOf(Exception exception)
    {
        var code = exception.HResult;
        var diskFull = exception is IOException && (OperatingSystem.IsWindows() ? (code & 0xFFFF) is 39 or 112 : code == UnixDiskFull);

        return exception switch
        {
            _ when diskFull => new TransferFileFailure(true, "não há espaço em disco"),
            UnauthorizedAccessException => new TransferFileFailure(false, "sem permissão para gravar na pasta de dados do Prism"),
            DirectoryNotFoundException => new TransferFileFailure(false, "a pasta das transferências não existe mais"),
            IOException => new TransferFileFailure(false, $"o sistema recusou a gravação (código {code})"),
            _ => new TransferFileFailure(false, $"o arquivo não pôde ser escrito ({exception.GetType().Name})")
        };
    }
}
