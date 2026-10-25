using CSharpFunctionalExtensions;
using Prism.Infrastructure.DbeaverSources.Models;
using Prism.Infrastructure.Transfers.Models;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.DbeaverSources.Clients;

internal sealed partial class DbeaverSourceClient(TransferSettings settings, ILogger logger) : IDbeaverSourceClient
{
    /// <summary>RN-DBEAVER-006: cada arquivo copiado tem até 5 MiB (o processo principal já recusa o que passa disso; aqui é a segunda conferência).</summary>
    public const int MaxFileBytes = 5 * 1024 * 1024;

    /// <summary>O manifesto tem uma linha por projeto, no máximo 50: 64 KiB sobram.</summary>
    public const int MaxManifestBytes = 64 * 1024;

    /// <summary>RN-DBEAVER-006: até 50 projetos, cada um numa subpasta `1` a `50`, e até 41 arquivos por projeto.</summary>
    public const int MaxProjects = 50;

    public const int MaxFilesPerProject = 41;

    /// <summary>O nome do projeto é o de uma pasta do sistema de arquivos, e o manifesto não passa de 255 unidades UTF-16 na prática; o que vem acima de 1.024 não é um nome.</summary>
    private const int MaxProjectNameLength = 1024;

    private static readonly IReadOnlySet<string> Places = new HashSet<string>(StringComparer.Ordinal) { "standard", "flatpak", "snap", "env", "chosen" };

    private readonly ILogger _logger = logger.ForContext<DbeaverSourceClient>();

    /// <summary>
    /// RN-DBEAVER-006: os cinco nomes que a API lê, e nenhum outro: `data-sources.json`, `data-sources-&lt;sufixo&gt;.json`, `credentials-config.json`,
    /// `credentials-config-&lt;sufixo&gt;.json` e `project-settings.json`, o sufixo de 1 a 64 caracteres entre letras, dígitos, `-`, `_` e `.`.
    /// </summary>
    [GeneratedRegex(@"^(?:data-sources|credentials-config)(?:-[A-Za-z0-9_.\-]{1,64})?\.json$|^project-settings\.json$", RegexOptions.CultureInvariant)]
    private static partial Regex KnownFile();

    public Result<DbeaverSource, EDbeaverSourceError> Read(Guid sourceId)
    {
        var manifestBytes = Send(nameof(Read), () => ReadBounded(Path.Combine(FolderOf(sourceId), "manifest.json"), MaxManifestBytes));
        if (manifestBytes.IsFailure)
            return manifestBytes.Error == ESendFailure.Missing ? EDbeaverSourceError.Missing : EDbeaverSourceError.Invalid;

        if (manifestBytes.Value is not { } bytes)
            return EDbeaverSourceError.Invalid;

        var manifest = Send("Manifest", () => ParseManifest(bytes));
        if (manifest.IsFailure || manifest.Value is not { } read)
            return EDbeaverSourceError.Invalid;

        var projects = new List<DbeaverProjectFiles>();
        foreach (var entry in read.Projects)
        {
            var directory = Path.Combine(FolderOf(sourceId), entry.Folder);
            var names = Send("List", () => Directory.EnumerateFiles(directory).Select(Path.GetFileName).Where(name => name is not null && KnownFile().IsMatch(name)).Select(name => name!).Order(StringComparer.Ordinal).Take(MaxFilesPerProject).ToList());
            var files = new List<DbeaverFile>();

            foreach (var name in names.IsSuccess ? names.Value : [])
            {
                var content = Send("File", () => ReadBounded(Path.Combine(directory, name), MaxFileBytes));
                files.Add(new DbeaverFile(name, content.IsSuccess ? content.Value : null));
            }

            projects.Add(new DbeaverProjectFiles(entry.Position, entry.Name, files));
        }

        return new DbeaverSource(read.Where, projects);
    }

    public Maybe<T> ReadJson<T>(byte[] content, Func<JsonElement, T> readContent)
    {
        var read = Send(nameof(ReadJson), () =>
        {
            using var document = JsonDocument.Parse(content.AsMemory(), new JsonDocumentOptions { MaxDepth = 64, CommentHandling = JsonCommentHandling.Disallow });

            return readContent(document.RootElement);
        });

        return read.IsSuccess ? Maybe.From(read.Value) : Maybe<T>.None;
    }

    public void Delete(Guid sourceId)
        => _ = Send(nameof(Delete), () =>
        {
            var folder = FolderOf(sourceId);
            if (Directory.Exists(folder))
                Directory.Delete(folder, recursive: true);

            return true;
        });

    public void DeleteAll()
    {
        var folders = Send(nameof(DeleteAll), () => Directory.Exists(settings.Directory) ? Directory.GetDirectories(settings.Directory, "*.dbeaver") : []);

        foreach (var folder in folders.IsSuccess ? folders.Value : [])
            _ = Send(nameof(DeleteAll), () =>
            {
                Directory.Delete(folder, recursive: true);

                return true;
            });
    }

    public Result<T, EDbeaverCredentialsError> Decrypt<T>(byte[] file, Func<JsonElement, T> readContent)
    {
        if (!DbeaverCrypto.HasTheShape(file))
        {
            _logger.Information("O credentials-config do DBeaver não tem a forma da cifra dele (menos de 32 bytes, ou um tamanho que não é múltiplo de 16).");

            return EDbeaverCredentialsError.Undecryptable;
        }

        var plaintext = Send(nameof(Decrypt), () => DbeaverCrypto.Decrypt(file));
        if (plaintext.IsFailure)
            return EDbeaverCredentialsError.Undecryptable;

        // O `JsonDocument` lê o buffer sem copiá-lo (o que a leitura extrai vira texto do .NET), e o buffer é zerado assim que a leitura acaba, também quando ela
        // falha: a saída do `using` o zera mesmo com uma exceção que o `Send` não trata (um defeito, que sobe).
        var read = Send("Content", () =>
        {
            using var wipe = new Wipe(plaintext.Value);
            using var document = JsonDocument.Parse(plaintext.Value.AsMemory());

            return document.RootElement.ValueKind == JsonValueKind.Object ? Maybe.From(readContent(document.RootElement)) : Maybe<T>.None;
        });

        if (read.IsFailure || read.Value.HasNoValue)
        {
            // O buffer em claro não chegou ao `using` quando a falha foi antes dele; zerar de novo não custa nada.
            CryptographicOperations.ZeroMemory(plaintext.Value);

            return EDbeaverCredentialsError.Invalid;
        }

        return read.Value.Value;
    }

    /// <summary>RN-DBEAVER-006: a pasta da cópia, montada só do `sourceId` na forma de 36 caracteres em minúsculas com os hifens que o processo principal dá.</summary>
    private string FolderOf(Guid sourceId)
        => Path.Combine(settings.Directory, $"{sourceId:D}.dbeaver");

    /// <summary>
    /// O conteúdo de um arquivo comum com até <paramref name="limit"/> bytes, ou nulo: o que não existe, o atalho (o Prism não segue atalhos, e a
    /// cópia só tem arquivos comuns), o que passa do limite e o que cresceu depois da medida. O arquivo que o sistema não deixa abrir sobe como `IOException`
    /// ou `UnauthorizedAccessException`, e o `Send` o devolve.
    /// </summary>
    private static byte[]? ReadBounded(string path, int limit)
    {
        var info = new FileInfo(path);
        if (!info.Exists)
            throw new FileNotFoundException();

        if (info.LinkTarget is not null || info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length > limit)
            return null;

        using var stream = new FileStream(path, new FileStreamOptions { Mode = FileMode.Open, Access = FileAccess.Read, Share = FileShare.ReadWrite | FileShare.Delete });
        var buffer = new byte[(int)Math.Min(info.Length, limit)];
        var filled = 0;
        while (filled < buffer.Length)
        {
            var count = stream.Read(buffer, filled, buffer.Length - filled);
            if (count == 0)
                break;

            filled += count;
        }

        // O arquivo que cresceu depois da medida passa do que foi medido: a cópia é recusada, e não lida pela metade.
        if (stream.ReadByte() >= 0)
            return null;

        return filled == buffer.Length ? buffer : buffer[..filled];
    }

    /// <summary>
    /// RN-DBEAVER-006: `{ "version": 1, "where": "standard"|"flatpak"|"snap"|"env"|"chosen", "projects": [{ "folder": "1", "name": "General" }] }`. Nulo quando a
    /// forma é outra. A pasta que não é `1` a `50` e a repetida são ignoradas; os projetos são os primeiros 50.
    /// </summary>
    private static DbeaverManifest? ParseManifest(byte[] bytes)
    {
        using var document = JsonDocument.Parse(bytes);
        var root = document.RootElement;

        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || version.GetRawText() != "1"
            || !root.TryGetProperty("where", out var where) || where.ValueKind != JsonValueKind.String || !Places.Contains(where.GetString()!)
            || !root.TryGetProperty("projects", out var list) || list.ValueKind != JsonValueKind.Array)
            return null;

        var projects = new List<DbeaverManifestProject>();
        var folders = new HashSet<string>(StringComparer.Ordinal);
        var names = new HashSet<string>(StringComparer.Ordinal);
        var position = 0;

        foreach (var item in list.EnumerateArray())
        {
            position++;
            if (item.ValueKind != JsonValueKind.Object
                || !item.TryGetProperty("folder", out var folder) || folder.ValueKind != JsonValueKind.String
                || !item.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String)
                continue;

            var folderName = folder.GetString()!;
            var projectName = name.GetString()!;
            if (!int.TryParse(folderName, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var number) || number is < 1 or > MaxProjects || folderName != number.ToString(System.Globalization.CultureInfo.InvariantCulture) || !folders.Add(folderName))
                continue;

            // Dois projetos com o mesmo nome não existem no disco; o manifesto que os traz não é o que o processo principal escreve, e o segundo é ignorado.
            if (projectName.Length == 0 || projectName.Length > MaxProjectNameLength || !names.Add(projectName))
                continue;

            projects.Add(new DbeaverManifestProject(folderName, position, projectName));
        }

        return new DbeaverManifest(where.GetString()!, projects);
    }

    /// <summary>
    /// O único `try` da integração. A falha volta como `Result`, e o log recebe a classe da exceção e o `HResult`, nunca a mensagem, que traz o caminho ou um pedaço
    /// do texto (RN-LOG-001 e RN-DBEAVER-008). `Missing` é o que não existe; `Unreadable`, o que o sistema não deixou ler; `Invalid`, o JSON que não lê (o
    /// `JsonException`, e o `InvalidOperationException` de um caractere UTF-16 inválido); `Undecryptable`, o preenchimento que não confere. O resto é defeito, e
    /// sobe como veio.
    /// </summary>
    private Result<T, ESendFailure> Send<T>(string operation, Func<T> call)
    {
        try
        {
            return Result.Success<T, ESendFailure>(call());
        }
        catch (Exception exception) when (exception is FileNotFoundException or DirectoryNotFoundException)
        {
            return ESendFailure.Missing;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            _logger.Warning("A cópia do DBeaver não abriu em {Operation} ({ExceptionType}, HResult {HResult}).", operation, exception.GetType().Name, exception.HResult);

            return ESendFailure.Unreadable;
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException)
        {
            _logger.Information("Um arquivo do DBeaver não é um JSON que o Prism lê, em {Operation} ({ExceptionType}).", operation, exception.GetType().Name);

            return ESendFailure.Invalid;
        }
        catch (CryptographicException exception)
        {
            _logger.Information("O credentials-config do DBeaver não decifrou ({ExceptionType}): o preenchimento não confere.", exception.GetType().Name);

            return ESendFailure.Undecryptable;
        }
    }

    private enum ESendFailure
    {
        Missing,
        Unreadable,
        Invalid,
        Undecryptable
    }

    private sealed record DbeaverManifest(string Where, IReadOnlyList<DbeaverManifestProject> Projects);

    private sealed record DbeaverManifestProject(string Folder, int Position, string Name);

    /// <summary>Zera o buffer na saída do `using`, como a fila devolve a vez no serviço: sem `try`/`finally` fora do `Send`.</summary>
    private readonly struct Wipe(byte[] buffer) : IDisposable
    {
        public void Dispose()
            => CryptographicOperations.ZeroMemory(buffer);
    }
}
