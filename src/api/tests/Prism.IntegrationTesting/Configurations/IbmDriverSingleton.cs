using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure;
using Prism.Infrastructure.Drivers.Models;
using Prism.Infrastructure.Drivers.Services;
using Prism.IntegrationTesting.Api.Support;
using Prism.TestingCore.Extensions;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;

namespace Prism.IntegrationTesting.Configurations;

/// <summary>
/// O driver da IBM dos testes do Db2 e do Informix. A API não o leva mais (RN-DRIVER-001), então os testes o instalam como o usuário
/// instala: **pelo gerenciador de drivers**, uma vez por execução, numa pasta de drivers própria. O pacote é o que o NuGet deixou no
/// cache da máquina no restore, servido por um servidor de mentira em 127.0.0.1 (sem rede de fora), e o catálogo é o de verdade: se o
/// hash, o tamanho ou os arquivos esperados não baterem, a instalação falha aqui e nenhum teste desses bancos roda. Quem precisa do
/// driver aponta a pasta de drivers do contêiner dele para esta (`UseDriverSource(directory: ...)`): a conferência da partida a aprova,
/// e é dela que o assembly e a biblioteca nativa são carregados. É a prova de ponta a ponta de hash, extração, carga e conexão.
///
/// A pasta não é apagada no fim: o assembly carregado dela fica preso até o processo acabar. Cada execução usa a pasta do próprio
/// número de processo, e apaga antes as de execuções cujo processo não existe mais.
/// </summary>
internal static class IbmDriverSingleton
{
    private const string DriverID = "ibm-data-server";
    private const string Version = "10.0.0.300";
    private const string FolderPrefix = "prism-tests-ibm-driver-";

    private static readonly Lock CreationLock = new();
    private static Task<string>? _directory;

    /// <summary>A pasta de drivers com o driver da IBM instalado. A primeira chamada instala; as demais esperam a mesma instalação.</summary>
    public static Task<string> GetDirectoryAsync()
    {
        lock (CreationLock)
            return _directory ??= InstallAsync();
    }

    private static async Task<string> InstallAsync()
    {
        DeleteFoldersOfFinishedRuns();

        // O número do processo pode ter sido de outra execução, que já acabou: a pasta dela não tem dono.
        var directory = Path.Combine(Path.GetTempPath(), $"{FolderPrefix}{Environment.ProcessId.ToString(CultureInfo.InvariantCulture)}");
        if (Directory.Exists(directory))
            Directory.Delete(directory, recursive: true);

        var package = await File.ReadAllBytesAsync(CachedPackagePath());
        await using var server = await PackageServer.StartAsync(PackageServer.Serve(package));

        // A pasta de dados é do cofre, que a instalação não abre: nada é gravado nela.
        await using var provider = new ServiceCollection().AddInfrastructure(Path.Combine(Path.GetTempPath(), "prism-tests-sem-cofre")).UseDriverSource(server.Address, directory: directory).BuildServiceProvider();
        var drivers = provider.GetRequiredService<IDriverService>();

        var started = drivers.Install(DriverID, acceptedLicense: true);
        if (started.IsFailure)
            throw new InvalidOperationException($"O gerenciador de drivers recusou a instalação do driver da IBM: {started.Error}.");

        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(5));
        while (drivers.Find(DriverID)!.State == EDriverState.Installing)
            await Task.Delay(50, timeout.Token);

        var driver = drivers.Find(DriverID)!;
        if (driver.State != EDriverState.Installed)
            throw new InvalidOperationException($"O driver da IBM não foi instalado ({driver.State}): {driver.Error?.Detail}");

        return directory;
    }

    /// <summary>O `.nupkg` do pacote desta plataforma, onde o restore do NuGet o deixou.</summary>
    private static string CachedPackagePath()
    {
        var package = RuntimeInformation.RuntimeIdentifier switch
        {
            "win-x64" => "net.ibm.data.db2",
            "linux-x64" => "net.ibm.data.db2-lnx",
            "osx-arm64" => "net.ibm.data.db2-osx",
            var platform => throw new InvalidOperationException($"A IBM não publica o driver para {platform}: os testes do Db2 e do Informix não rodam nela.")
        };

        var path = Path.Combine(Environment.GetEnvironmentVariable("NUGET_PACKAGES") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".nuget", "packages"), package, Version, $"{package}.{Version}.nupkg");

        return File.Exists(path) ? path : throw new InvalidOperationException($"O pacote {package} {Version} não está no cache do NuGet desta máquina; rode o restore da solução.");
    }

    /// <summary>As pastas de execuções anteriores, que só puderam ser apagadas depois de o processo delas acabar.</summary>
    private static void DeleteFoldersOfFinishedRuns()
    {
        var running = Process.GetProcesses().Select(process => process.Id).ToHashSet();

        foreach (var folder in Directory.GetDirectories(Path.GetTempPath(), FolderPrefix + "*"))
            if (int.TryParse(Path.GetFileName(folder)[FolderPrefix.Length..], NumberStyles.None, CultureInfo.InvariantCulture, out var processID) && !running.Contains(processID))
                Directory.Delete(folder, recursive: true);
    }
}
