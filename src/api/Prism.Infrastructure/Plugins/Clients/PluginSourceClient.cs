using CSharpFunctionalExtensions;
using Prism.Infrastructure.Plugins.Models;
using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Plugins.Clients;

internal sealed partial class PluginSourceClient(PluginSettings settings, ILogger logger) : IPluginSourceClient
{
    private const long MaxManifestBytes = 64 * 1024;
    private const long MaxBundleBytes = 2 * 1024 * 1024;
    private static readonly TimeSpan GitTimeout = TimeSpan.FromSeconds(60);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly ILogger _logger = logger.ForContext<PluginSourceClient>();

    public Result<PluginManifest, PluginFailure> InspectLocal(string folderPath)
        => Send(nameof(InspectLocal), () =>
        {
            if (string.IsNullOrWhiteSpace(folderPath) || !Directory.Exists(folderPath))
                return Result.Failure<PluginManifest, PluginFailure>(new PluginFailure(EPluginFailure.SourceInvalid, "A pasta local informada não existe ou não está acessível."));

            return ReadAndValidatePluginDirectory(Path.GetFullPath(folderPath)).Map(inspected => inspected.Manifest);
        });

    public async Task<Result<PluginManifest, PluginFailure>> CloneFromGitAsync(string gitUrl, Func<string, bool> isAlreadyInstalled, CancellationToken cancellationToken)
    {
        var trimmed = gitUrl.Trim();
        if (!IsAllowedGitUrl(trimmed))
            return new PluginFailure(EPluginFailure.SourceInvalid, "Informe uma URL de repositório Git válida (https://, http://, ssh:// ou git@).");

        string? stagingDirectory = null;

        var cloned = await SendAsync(nameof(CloneFromGitAsync), cancellationToken, async () =>
        {
            Directory.CreateDirectory(settings.Directory);
            stagingDirectory = Path.Combine(settings.Directory, $".staging-{Guid.NewGuid():N}");

            var gitResult = await RunGitAsync(["clone", "--depth", "1", "--", trimmed, stagingDirectory], settings.Directory, cancellationToken);
            if (gitResult.IsFailure)
                return Result.Failure<PluginManifest, PluginFailure>(gitResult.Error);

            var inspected = ReadAndValidatePluginDirectory(stagingDirectory);
            if (inspected.IsFailure)
                return Result.Failure<PluginManifest, PluginFailure>(inspected.Error);

            var manifest = inspected.Value.Manifest;
            if (isAlreadyInstalled(manifest.ID))
                return Result.Failure<PluginManifest, PluginFailure>(new PluginFailure(EPluginFailure.AlreadyInstalled, $"O plugin '{manifest.Name}' ({manifest.ID}) já está instalado."));

            var targetDirectory = Path.Combine(settings.Directory, manifest.ID);
            if (Directory.Exists(targetDirectory))
                DeleteDirectorySafe(targetDirectory);

            Directory.Move(stagingDirectory, targetDirectory);
            stagingDirectory = null;

            return Result.Success<PluginManifest, PluginFailure>(manifest);
        });

        if (stagingDirectory is { } leftover)
            Send(nameof(CloneFromGitAsync), () => { DeleteDirectorySafe(leftover); return Result.Success<bool, PluginFailure>(true); });

        return cloned;
    }

    public Task<Result<PluginManifest, PluginFailure>> PullGitAsync(string pluginID, CancellationToken cancellationToken)
        => SendAsync(nameof(PullGitAsync), cancellationToken, async () =>
        {
            if (!IsValidPluginID(pluginID))
                return Result.Failure<PluginManifest, PluginFailure>(new PluginFailure(EPluginFailure.ManifestInvalid, "O identificador do plugin é inválido."));

            var pluginDirectory = Path.Combine(settings.Directory, pluginID);
            if (!Directory.Exists(pluginDirectory))
                return Result.Failure<PluginManifest, PluginFailure>(new PluginFailure(EPluginFailure.SourceInvalid, "A pasta do plugin instalado não foi encontrada na máquina."));

            var gitResult = await RunGitAsync(["-C", pluginDirectory, "pull", "--ff-only"], pluginDirectory, cancellationToken);
            if (gitResult.IsFailure)
                return Result.Failure<PluginManifest, PluginFailure>(gitResult.Error);

            var inspected = ReadAndValidatePluginDirectory(pluginDirectory);
            if (inspected.IsFailure)
                return Result.Failure<PluginManifest, PluginFailure>(inspected.Error);

            if (!string.Equals(inspected.Value.Manifest.ID, pluginID, StringComparison.Ordinal))
                return Result.Failure<PluginManifest, PluginFailure>(new PluginFailure(EPluginFailure.ManifestInvalid, "O manifesto atualizado mudou o identificador do plugin, o que não é permitido."));

            return Result.Success<PluginManifest, PluginFailure>(inspected.Value.Manifest);
        });

    public Result<string, PluginFailure> ReadBundle(string pluginID, string sourceKind, string source)
        => Send(nameof(ReadBundle), () =>
        {
            if (!IsValidPluginID(pluginID))
                return Result.Failure<string, PluginFailure>(new PluginFailure(EPluginFailure.ManifestInvalid, "O identificador do plugin é inválido."));

            var directory = string.Equals(sourceKind, "local", StringComparison.Ordinal) ? source : Path.Combine(settings.Directory, pluginID);
            if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
                return Result.Failure<string, PluginFailure>(new PluginFailure(EPluginFailure.BundleUnavailable, $"A pasta do plugin '{pluginID}' não foi encontrada."));

            var inspected = ReadAndValidatePluginDirectory(Path.GetFullPath(directory));
            if (inspected.IsFailure)
                return Result.Failure<string, PluginFailure>(new PluginFailure(EPluginFailure.BundleUnavailable, inspected.Error.Message));

            return Result.Success<string, PluginFailure>(File.ReadAllText(inspected.Value.BundlePath, Encoding.UTF8));
        });

    public void DeleteInstalledDirectory(string pluginID)
    {
        if (!IsValidPluginID(pluginID))
            return;

        var target = Path.Combine(settings.Directory, pluginID);
        Send(nameof(DeleteInstalledDirectory), () =>
        {
            DeleteDirectorySafe(target);
            return Result.Success<bool, PluginFailure>(true);
        });
    }

    public static bool IsAllowedGitUrl(string url)
    {
        if (string.IsNullOrWhiteSpace(url) || url.StartsWith('-') || url.Any(char.IsControl) || url.Any(char.IsWhiteSpace))
            return false;

        if (url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || url.StartsWith("ssh://", StringComparison.OrdinalIgnoreCase) || url.StartsWith("file://", StringComparison.OrdinalIgnoreCase))
            return Uri.TryCreate(url, UriKind.Absolute, out var parsed) && (!string.IsNullOrWhiteSpace(parsed.Host) || (string.Equals(parsed.Scheme, "file", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(parsed.AbsolutePath)));

        // Formato SCP do Git: git@host:grupo/repo.git
        if (url.StartsWith("git@", StringComparison.OrdinalIgnoreCase))
        {
            var colon = url.IndexOf(':');
            return colon > 4 && colon < url.Length - 1;
        }

        return false;
    }

    public static bool IsValidPluginID(string id)
        => !string.IsNullOrWhiteSpace(id) && PluginIdRegex().IsMatch(id);

    private static Result<InspectedDirectory, PluginFailure> ReadAndValidatePluginDirectory(string fullDirectoryPath)
    {
        var manifestPath = Path.Combine(fullDirectoryPath, "manifest.json");
        if (!File.Exists(manifestPath))
            return new PluginFailure(EPluginFailure.ManifestInvalid, "O arquivo manifest.json não foi encontrado na raiz do plugin.");

        var manifestInfo = new FileInfo(manifestPath);
        if (manifestInfo.Length is <= 0 or > MaxManifestBytes)
            return new PluginFailure(EPluginFailure.ManifestInvalid, "O arquivo manifest.json está vazio ou excede o tamanho máximo permitido (64 KB).");

        var rawManifest = JsonSerializer.Deserialize<RawManifest>(File.ReadAllText(manifestPath, Encoding.UTF8), JsonOptions);
        if (rawManifest is null)
            return new PluginFailure(EPluginFailure.ManifestInvalid, "O arquivo manifest.json está inválido.");

        var id = rawManifest.Id?.Trim() ?? string.Empty;
        if (!IsValidPluginID(id))
            return new PluginFailure(EPluginFailure.ManifestInvalid, "O campo 'id' do manifest.json deve conter apenas letras minúsculas, números, ponto, hífen ou sublinhado (2 a 64 caracteres).");

        var name = rawManifest.Name?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(name) || name.Length > 120)
            return new PluginFailure(EPluginFailure.ManifestInvalid, "O campo 'name' do manifest.json é obrigatório e deve ter até 120 caracteres.");

        var version = rawManifest.Version?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(version) || version.Length > 40)
            return new PluginFailure(EPluginFailure.ManifestInvalid, "O campo 'version' do manifest.json é obrigatório e deve ter até 40 caracteres.");

        var mainRelative = string.IsNullOrWhiteSpace(rawManifest.Main) ? "main.js" : rawManifest.Main.Trim();
        if (Path.IsPathRooted(mainRelative))
            return new PluginFailure(EPluginFailure.ManifestInvalid, "O campo 'main' do manifest.json deve ser um caminho relativo dentro da pasta do plugin.");

        var normalizedRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(fullDirectoryPath)) + Path.DirectorySeparatorChar;
        var resolvedBundlePath = Path.GetFullPath(Path.Combine(fullDirectoryPath, mainRelative));
        if (!resolvedBundlePath.StartsWith(normalizedRoot, StringComparison.Ordinal))
            return new PluginFailure(EPluginFailure.ManifestInvalid, "O arquivo principal do plugin não pode sair da pasta do plugin.");

        if (!File.Exists(resolvedBundlePath))
            return new PluginFailure(EPluginFailure.ManifestInvalid, $"O arquivo principal '{mainRelative}' apontado pelo manifest.json não foi encontrado.");

        var bundleInfo = new FileInfo(resolvedBundlePath);
        if (bundleInfo.Length <= 0)
            return new PluginFailure(EPluginFailure.ManifestInvalid, $"O arquivo principal '{mainRelative}' do plugin está vazio.");

        if (bundleInfo.Length > MaxBundleBytes)
            return new PluginFailure(EPluginFailure.ManifestInvalid, $"O arquivo principal '{mainRelative}' excede o limite de 2 MB.");

        var engines = (rawManifest.Engines ?? []).Where(engine => !string.IsNullOrWhiteSpace(engine)).Select(engine => engine.Trim().ToLowerInvariant()).Distinct(StringComparer.Ordinal).ToArray();
        var description = string.IsNullOrWhiteSpace(rawManifest.Description) ? null : rawManifest.Description.Trim();
        var author = string.IsNullOrWhiteSpace(rawManifest.Author) ? null : rawManifest.Author.Trim();

        return new InspectedDirectory(new PluginManifest(id, name, version, description, author, mainRelative, engines), resolvedBundlePath);
    }

    private static async Task<UnitResult<PluginFailure>> RunGitAsync(IReadOnlyList<string> arguments, string workingDirectory, CancellationToken cancellationToken)
    {
        var startInfo = new ProcessStartInfo("git")
        {
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        foreach (var argument in arguments)
            startInfo.ArgumentList.Add(argument);

        // Impede que o Git trave esperando usuário ou senha no terminal caso o SSH ou credencial não estejam configurados.
        startInfo.Environment["GIT_TERMINAL_PROMPT"] = "0";
        startInfo.Environment["GCM_INTERACTIVE"] = "never";

        using var process = Process.Start(startInfo);
        if (process is null)
            return new PluginFailure(EPluginFailure.GitFailed, "Não foi possível iniciar o comando 'git'. Verifique se o Git está instalado na máquina.");

        process.StandardInput.Close();

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(GitTimeout);

        var stdOutTask = process.StandardOutput.ReadToEndAsync(timeoutCts.Token);
        var stdErrTask = process.StandardError.ReadToEndAsync(timeoutCts.Token);

        await process.WaitForExitAsync(timeoutCts.Token);
        var stdErr = (await stdErrTask).Trim();
        _ = await stdOutTask;

        if (process.ExitCode == 0)
            return UnitResult.Success<PluginFailure>();

        var detail = string.IsNullOrWhiteSpace(stdErr) ? $"O comando git encerrou com código {process.ExitCode}." : FirstMeaningfulGitLine(stdErr);
        return new PluginFailure(EPluginFailure.GitFailed, $"Não foi possível acessar o repositório Git. Confira a URL e suas credenciais SSH/HTTPS na máquina ({detail})");
    }

    private static string FirstMeaningfulGitLine(string stdErr)
    {
        var line = stdErr.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).LastOrDefault() ?? "falha ao executar git";
        return line.Length > 200 ? $"{line[..200]}…" : line;
    }

    /// <summary>O Git marca objetos de pacote (`.git/objects/pack`) como somente leitura no Windows; limpar o atributo antes de apagar evita `UnauthorizedAccessException`.</summary>
    private static void DeleteDirectorySafe(string directoryPath)
    {
        if (!Directory.Exists(directoryPath))
            return;

        foreach (var file in Directory.EnumerateFiles(directoryPath, "*", SearchOption.AllDirectories))
            File.SetAttributes(file, FileAttributes.Normal);

        Directory.Delete(directoryPath, recursive: true);
    }

    private Result<T, PluginFailure> Send<T>(string operation, Func<Result<T, PluginFailure>> call)
        => SendAsync(operation, CancellationToken.None, () => Task.FromResult(call())).GetAwaiter().GetResult();

    /// <summary>
    /// O único `try` da integração: exceção nenhuma sai daqui. RN-LOG-001: o log recebe apenas a operação e a classe da exceção, nunca o caminho nem a URL.
    /// </summary>
    private async Task<Result<T, PluginFailure>> SendAsync<T>(string operation, CancellationToken cancellationToken, Func<Task<Result<T, PluginFailure>>> call)
    {
        try
        {
            return await call();
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.Warning("A operação de plugin {Operation} excedeu o tempo limite.", operation);
            return new PluginFailure(EPluginFailure.GitFailed, "A operação no repositório Git excedeu o tempo limite de 60 segundos.");
        }
        catch (Win32Exception exception)
        {
            _logger.Warning("O executável do Git não pôde ser iniciado em {Operation} ({ExceptionType}, HResult {HResult}).", operation, exception.GetType().Name, exception.HResult);
            return new PluginFailure(EPluginFailure.GitFailed, "O comando 'git' não foi encontrado no sistema. Instale o Git e verifique se ele está no PATH.");
        }
        catch (JsonException exception)
        {
            _logger.Warning("O manifesto do plugin não é um JSON válido em {Operation} ({ExceptionType}).", operation, exception.GetType().Name);
            return new PluginFailure(EPluginFailure.ManifestInvalid, "O arquivo manifest.json do plugin não contém um JSON válido.");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            _logger.Warning("A operação de plugin {Operation} falhou no acesso ao disco ({ExceptionType}, HResult {HResult}).", operation, exception.GetType().Name, exception.HResult);
            return new PluginFailure(EPluginFailure.SourceInvalid, "Não foi possível ler ou gravar os arquivos do plugin no disco (verifique o caminho e as permissões).");
        }
    }

    [GeneratedRegex("^[a-z0-9][a-z0-9._-]{1,63}$", RegexOptions.CultureInvariant)]
    private static partial Regex PluginIdRegex();

    private sealed record RawManifest(string? Id, string? Name, string? Version, string? Description, string? Author, string? Main, IReadOnlyList<string>? Engines);

    private sealed record InspectedDirectory(PluginManifest Manifest, string BundlePath);
}
