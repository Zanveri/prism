using System.Diagnostics;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;

namespace Prism.IntegrationTesting.Api.Support;

/// <summary>
/// A Prism.Api.dll iniciada como processo, como o Electron a inicia: variáveis PRISM_*, a linha `PRISM_API_READY &lt;porta&gt;` na saída
/// padrão, uma pasta de dados temporária e um token próprios. Sem token, espera a saída; com token, espera a linha de pronto e lê a
/// porta dela. É a única forma de ver o que a API grava em `logs/` e o que ela faz ao encerrar: o `ApiHost` não liga o Serilog.
/// </summary>
internal sealed class ApiProcess : IDisposable
{
    private static readonly TimeSpan StartTimeout = TimeSpan.FromSeconds(30);

    private readonly StringBuilder _errorOutput = new();
    private HttpClient? _client;

    public Process Process { get; }
    public string DataDirectory { get; } = Directory.CreateTempSubdirectory("prism-tests-").FullName;
    public string Token { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    public int Port { get; private set; }
    public string ErrorOutput => _errorOutput.ToString();

    /// <summary>Já leva o token de lançamento em `Authorization`; o endereço é o de loopback em que a API escuta.</summary>
    public HttpClient Client => _client ??= new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{Port}"), DefaultRequestHeaders = { Authorization = new AuthenticationHeaderValue("Bearer", Token) } };

    private ApiProcess(int? parentProcessID, bool withToken)
    {
        // A dotnet CLI deixa o caminho do próprio executável nesta variável; fora dela (um IDE, por exemplo), vale o PATH.
        var dotnet = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet";
        var info = new ProcessStartInfo(dotnet) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        info.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "Prism.Api.dll"));
        info.Environment.Remove("PRISM_API_TOKEN");
        info.Environment.Remove("PRISM_PARENT_PID");
        if (withToken)
            info.Environment["PRISM_API_TOKEN"] = Token;
        info.Environment["PRISM_DATA_DIR"] = DataDirectory;
        info.Environment["PRISM_ALLOWED_ORIGIN"] = ApiHost.AllowedOrigin;
        if (parentProcessID is { } parent)
            info.Environment["PRISM_PARENT_PID"] = parent.ToString();

        Process = new Process { StartInfo = info };
        Process.ErrorDataReceived += (_, e) => _errorOutput.AppendLine(e.Data);
        Process.Start();
        Process.BeginErrorReadLine();
    }

    public static async Task<ApiProcess> StartAsync(int? parentProcessID = null, bool withToken = true)
    {
        var api = new ApiProcess(parentProcessID, withToken);
        using var timeout = new CancellationTokenSource(StartTimeout);

        if (!withToken)
        {
            await api.Process.WaitForExitAsync(timeout.Token);

            return api;
        }

        var line = await api.Process.StandardOutput.ReadLineAsync(timeout.Token);
        Assert.That(line, Does.Match(@"^PRISM_API_READY \d+$"), $"Saída de erro da API: {api.ErrorOutput}");
        api.Port = int.Parse(line![(line.LastIndexOf(' ') + 1)..]);

        return api;
    }

    /// <summary>Um processo qualquer que fica vivo até o teste matá-lo: o PID dele faz o papel do Electron.</summary>
    public static Process StartParentStandIn()
    {
        var info = OperatingSystem.IsWindows() ? new ProcessStartInfo("ping", "-n 60 127.0.0.1") : new ProcessStartInfo("sleep", "60");
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardOutput = true;

        return Process.Start(info)!;
    }

    /// <summary>
    /// Encerra o pai de mentira e espera a API sair sozinha (RN-API-004), que é o desligamento de verdade: o host é descartado e o log
    /// é gravado até o fim. Falha se ela não sair no prazo, e devolve o código de saída.
    /// </summary>
    public static async Task<int> StopThroughParentAsync(Process parent, ApiProcess api, TimeSpan timeout)
    {
        parent.Kill();
        await parent.WaitForExitAsync();
        var exit = api.Process.WaitForExitAsync();
        var finished = await Task.WhenAny(exit, Task.Delay(timeout));

        Assert.That(finished, Is.SameAs(exit), $"A API não saiu em até {timeout.TotalSeconds} s depois do processo pai.");

        return api.Process.ExitCode;
    }

    /// <summary>Todos os arquivos de `logs/`, lidos com o compartilhamento aberto: o Serilog pode ainda ter o arquivo do dia aberto.</summary>
    public IReadOnlyDictionary<string, string> ReadLogs()
    {
        var logs = Path.Combine(DataDirectory, "logs");
        if (!Directory.Exists(logs))
            return new Dictionary<string, string>();

        return Directory.GetFiles(logs).ToDictionary(file => Path.GetFileName(file), file =>
        {
            using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var reader = new StreamReader(stream);

            return reader.ReadToEnd();
        });
    }

    /// <summary>Espera, em laço, o texto aparecer em algum arquivo de `logs/` (o Serilog grava a cada linha, mas depois do fato que ela conta).</summary>
    public async Task<bool> WaitForLogAsync(string text, TimeSpan timeout)
    {
        var watch = System.Diagnostics.Stopwatch.StartNew();

        while (!ReadLogs().Values.Any(log => log.Contains(text, StringComparison.Ordinal)))
        {
            if (watch.Elapsed >= timeout)
                return false;

            await Task.Delay(25);
        }

        return true;
    }

    public void Dispose()
    {
        _client?.Dispose();

        if (!Process.HasExited)
            Process.Kill(entireProcessTree: true);
        // Sem esperar a saída, o log ainda aberto da API impediria apagar a pasta no Windows.
        Process.WaitForExit();
        Process.Dispose();
        Directory.Delete(DataDirectory, recursive: true);
    }
}
