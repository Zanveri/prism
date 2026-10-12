using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure;
using Prism.Infrastructure.Drivers.Models;
using Prism.Infrastructure.Drivers.Services;
using Prism.IntegrationTesting.Api.Support;
using Prism.TestingCore.Extensions;
using Prism.TestingCore.Fakers.Drivers;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Prism.IntegrationTesting.Infrastructure.Drivers;

/// <summary>
/// O gerenciador de drivers (`IDriverService`) com o client de verdade: o download por um socket de verdade, contra um servidor HTTP de
/// mentira, e a pasta de drivers num diretório temporário. Cada teste tem o próprio contêiner de injeção, montado pelo
/// `AddInfrastructure` como na API, com a origem dos pacotes trocada pela costura de teste. "Reiniciar a API" é montar outro contêiner
/// sobre a mesma pasta de dados. Nada aqui usa a rede de fora nem um banco.
/// </summary>
[TestFixture]
[Category("Drivers")]
public sealed class DriverInstallerTests
{
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(30);

    private readonly byte[] _package = DriverPackageFakers.CreateValidPackage();

    private string _dataDirectory = null!;
    private CollectingSink _log = null!;
    private List<IAsyncDisposable> _disposables = null!;

    private string DriverDirectory => Path.Combine(_dataDirectory, "drivers", DriverPackageFakers.DriverID);

    private string InstallDirectory => Path.Combine(DriverDirectory, DriverPackageFakers.Version);

    [SetUp]
    public void CreateDataDirectory()
    {
        _dataDirectory = Directory.CreateTempSubdirectory("prism-drivers-").FullName;
        _log = new CollectingSink();
        _disposables = [];
    }

    [TearDown]
    public async Task DisposeAsync()
    {
        // Na ordem inversa da criação: os contêineres (que interrompem o download) antes dos servidores.
        foreach (var disposable in Enumerable.Reverse(_disposables))
            await disposable.DisposeAsync();

        Directory.Delete(_dataDirectory, recursive: true);
    }

    private async Task<PackageServer> StartServerAsync(Func<HttpContext, int, Task> respond)
    {
        var server = await PackageServer.StartAsync(respond);
        _disposables.Add(server);

        return server;
    }

    private Task<PackageServer> StartServerAsync(Func<HttpContext, Task> respond)
        => StartServerAsync((context, _) => respond(context));

    /// <summary>Uma "partida da API": um contêiner novo sobre a pasta de dados do teste, com o catálogo de teste e o servidor dado.</summary>
    private IDriverService Start(PackageServer server, string? catalogJson = null)
    {
        var logger = new LoggerConfiguration().MinimumLevel.Verbose().WriteTo.Sink(_log).CreateLogger();
        var provider = new ServiceCollection().AddSingleton<ILogger>(logger).AddInfrastructure(_dataDirectory).UseDriverSource(server.Address, catalogJson ?? DriverPackageFakers.CatalogJson(_package), DriverPackageFakers.Platform).BuildServiceProvider();
        _disposables.Add(provider);

        return provider.GetRequiredService<IDriverService>();
    }

    private static DriverInfo TestDriver(IDriverService service)
        => service.List().Single(driver => driver.ID == DriverPackageFakers.DriverID);

    /// <summary>Espera o driver sair de (ou chegar a) um estado olhando a lista, como a tela faz.</summary>
    private static async Task<DriverInfo> WaitAsync(IDriverService service, Func<DriverInfo, bool> ready)
    {
        using var timeout = new CancellationTokenSource(Patience);

        while (!ready(TestDriver(service)))
            await Task.Delay(20, timeout.Token);

        return TestDriver(service);
    }

    private static async Task<DriverInfo> InstallAsync(IDriverService service)
    {
        var started = service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        Assert.That(started.IsSuccess, Is.True, started.IsFailure ? started.Error.ToString() : null);

        return await WaitAsync(service, driver => driver.State != EDriverState.Installing);
    }

    /// <summary>Tudo o que há sob a pasta de dados, relativo a ela: é como um teste diz "nada ficou" e "nada saiu do lugar".</summary>
    private string[] FilesUnderDataDirectory()
        => [.. Directory.EnumerateFiles(_dataDirectory, "*", SearchOption.AllDirectories).Select(file => Path.GetRelativePath(_dataDirectory, file).Replace('\\', '/')).Order(StringComparer.Ordinal)];

    private static byte[] WithOneByteChanged(byte[] bytes)
    {
        var changed = (byte[])bytes.Clone();
        changed[changed.Length / 2] ^= 0x01;

        return changed;
    }

    /// <summary>RN-DRIVER-003, de ponta a ponta: endereço montado do catálogo, hash conferido, só as entradas esperadas, registro com o aceite.</summary>
    [Test]
    public async Task Install_DownloadsVerifiesExtractsAndRecordsTheAcceptance()
    {
        //Arrange
        var server = await StartServerAsync(PackageServer.Serve(_package));
        var service = Start(server);

        //Act
        var driver = await InstallAsync(service);

        //Assert
        Assert.That(driver.State, Is.EqualTo(EDriverState.Installed));
        Assert.That(driver.RestartRequired, Is.True);
        Assert.That(driver.Error, Is.Null);
        Assert.That(driver.Progress, Is.Null);
        Assert.That(server.Requests, Is.EqualTo(new[] { $"GET {DriverPackageFakers.RequestPath}" }));
        Assert.That(FilesUnderDataDirectory(), Is.EqualTo(new[]
        {
            $"drivers/{DriverPackageFakers.DriverID}/{DriverPackageFakers.Version}/Driver.Teste.dll",
            $"drivers/{DriverPackageFakers.DriverID}/{DriverPackageFakers.Version}/Licenca.txt",
            $"drivers/{DriverPackageFakers.DriverID}/{DriverPackageFakers.Version}/install.json",
            $"drivers/{DriverPackageFakers.DriverID}/{DriverPackageFakers.Version}/nativo/bin/teste.bin",
            $"drivers/{DriverPackageFakers.DriverID}/{DriverPackageFakers.Version}/nativo/msg/pt_BR/mensagens.txt"
        }));
        Assert.That(Directory.EnumerateFileSystemEntries(DriverDirectory), Is.EqualTo(new[] { InstallDirectory }), "não pode sobrar pasta nem arquivo temporário");

        // RN-DRIVER-003 e 009: o aceite fica na pasta do driver, com a licença, a versão, a data e o hash do pacote.
        using var record = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(InstallDirectory, "install.json")));
        Assert.That(record.RootElement.GetProperty("driverID").GetString(), Is.EqualTo(DriverPackageFakers.DriverID));
        Assert.That(record.RootElement.GetProperty("version").GetString(), Is.EqualTo(DriverPackageFakers.Version));
        Assert.That(record.RootElement.GetProperty("packageSha512").GetString(), Is.EqualTo(DriverPackageFakers.Sha512(_package)));
        Assert.That(record.RootElement.GetProperty("license").GetProperty("name").GetString(), Is.EqualTo(DriverPackageFakers.LicenseName));
        Assert.That(record.RootElement.GetProperty("license").GetProperty("url").GetString(), Is.EqualTo(DriverPackageFakers.LicenseUrl));
        Assert.That(record.RootElement.GetProperty("acceptedAt").GetDateTimeOffset(), Is.EqualTo(DateTimeOffset.UtcNow).Within(TimeSpan.FromMinutes(5)));
    }

    /// <summary>RN-DRIVER-005: o que foi instalado numa execução é o driver em uso na seguinte, sem reinício pendente.</summary>
    [Test]
    public async Task Install_ThenRestart_IsInstalledWithoutRestartRequired()
    {
        //Arrange
        var server = await StartServerAsync(PackageServer.Serve(_package));
        await InstallAsync(Start(server));

        //Act
        var driver = TestDriver(Start(server));

        //Assert
        Assert.That(driver.State, Is.EqualTo(EDriverState.Installed));
        Assert.That(driver.RestartRequired, Is.False);
        Assert.That(server.Requests, Has.Count.EqualTo(1), "a partida não baixa nada");
    }

    /// <summary>RN-DRIVER-003: se o SHA-512 não bate, nada é extraído e o estado vira `failed` com `DRIVER_INTEGRITY_FAILED`.</summary>
    [Test]
    public async Task Install_PackageWithOneByteChanged_IsIntegrityFailed_AndNothingIsLeft()
    {
        //Arrange
        var server = await StartServerAsync(PackageServer.Serve(WithOneByteChanged(_package)));
        var service = Start(server);

        //Act
        var driver = await InstallAsync(service);

        //Assert
        Assert.That(driver.State, Is.EqualTo(EDriverState.Failed));
        Assert.That(driver.Error?.Kind, Is.EqualTo(EDriverInstallFailure.IntegrityFailed));
        Assert.That(driver.Error?.Detail, Is.Not.Empty);
        Assert.That(driver.RestartRequired, Is.False);
        Assert.That(FilesUnderDataDirectory(), Is.Empty);
        Assert.That(Directory.EnumerateFileSystemEntries(DriverDirectory), Is.Empty);
        Assert.That(TestDriver(Start(server)).State, Is.EqualTo(EDriverState.Available), "depois do reinício o driver não está instalado");
    }

    /// <summary>
    /// A segunda barreira, para o pacote que tem o hash "certo" (o catálogo de teste aponta para ele) e uma entrada cujo nome sai da pasta
    /// de destino: é recusado inteiro, e nada é gravado, nem dentro nem fora da pasta de drivers.
    /// </summary>
    [TestCase("../fora.txt")]
    [TestCase("nativo-origem/../../../fora.txt")]
    [TestCase("/fora-absoluto.txt")]
    [TestCase("C:/fora-unidade.txt")]
    [TestCase("nativo-origem\\..\\..\\fora.txt")]
    public async Task Install_PackageWithAnEntryThatLeavesTheFolder_IsRefused_AndNothingIsWritten(string entryName)
    {
        //Arrange
        var malicious = DriverPackageFakers.CreatePackage([.. DriverPackageFakers.ValidEntries(), (entryName, Encoding.UTF8.GetBytes("fora"))]);
        var server = await StartServerAsync(PackageServer.Serve(malicious));
        var service = Start(server, DriverPackageFakers.CatalogJson(malicious));

        //Act
        var driver = await InstallAsync(service);

        //Assert
        Assert.That(driver.State, Is.EqualTo(EDriverState.Failed));
        Assert.That(driver.Error?.Kind, Is.EqualTo(EDriverInstallFailure.IntegrityFailed));
        Assert.That(FilesUnderDataDirectory(), Is.Empty);
        Assert.That(Directory.EnumerateFiles(Path.GetDirectoryName(_dataDirectory)!, "fora*.txt"), Is.Empty);
        Assert.That(File.Exists(Path.Combine(Path.GetPathRoot(_dataDirectory)!, "fora-absoluto.txt")), Is.False);
        Assert.That(File.Exists(Path.Combine(Path.GetPathRoot(_dataDirectory)!, "fora-unidade.txt")), Is.False);
    }

    /// <summary>RN-DRIVER-004: falha de rede deixa `failed` com `DRIVER_DOWNLOAD_FAILED` e a causa, e o usuário pode tentar de novo.</summary>
    [Test]
    public async Task Install_WhenTheConnectionDropsHalfway_IsDownloadFailed_AndTheRetryInstalls()
    {
        //Arrange
        var server = await StartServerAsync((context, request) => request == 1 ? PackageServer.DropAfter(_package, _package.Length / 2)(context) : PackageServer.Serve(_package)(context));
        var service = Start(server);

        //Act
        var failed = await InstallAsync(service);
        var leftAfterFailure = FilesUnderDataDirectory();
        var retried = await InstallAsync(service);

        //Assert
        Assert.That(failed.State, Is.EqualTo(EDriverState.Failed));
        Assert.That(failed.Error?.Kind, Is.EqualTo(EDriverInstallFailure.DownloadFailed));
        Assert.That(failed.Error?.Detail, Is.EqualTo("A conexão caiu durante o download."));
        Assert.That(leftAfterFailure, Is.Empty);
        Assert.That(retried.State, Is.EqualTo(EDriverState.Installed));
        Assert.That(retried.Error, Is.Null);
        Assert.That(server.Requests, Has.Count.EqualTo(2));
    }

    /// <summary>RN-DRIVER-004: o download é cancelável; cancelar devolve o driver a `available`, sem erro e sem sobra no disco.</summary>
    [Test]
    public async Task Install_SlowDownload_ShowsProgress_AndCanBeCanceled()
    {
        //Arrange
        var never = new TaskCompletionSource();
        var server = await StartServerAsync(PackageServer.ServeSlowly(_package, 1024, never.Task));
        var service = Start(server);
        service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);

        //Act
        var downloading = await WaitAsync(service, driver => driver.Progress?.ReceivedBytes == 1024);
        var canceled = await service.CancelInstallAsync(DriverPackageFakers.DriverID);
        var driver = TestDriver(service);

        //Assert
        Assert.That(downloading.State, Is.EqualTo(EDriverState.Installing));
        Assert.That(downloading.Progress, Is.EqualTo(new DriverProgress(1024, _package.Length)));
        Assert.That(canceled.IsSuccess, Is.True);
        Assert.That(driver.State, Is.EqualTo(EDriverState.Available));
        Assert.That(driver.Error, Is.Null);
        Assert.That(driver.Progress, Is.Null);
        Assert.That(driver.RestartRequired, Is.False);
        Assert.That(FilesUnderDataDirectory(), Is.Empty);
        Assert.That(Directory.EnumerateFileSystemEntries(DriverDirectory), Is.Empty);
    }

    /// <summary>RN-DRIVER-008: o download só vem do endereço montado pela API. Um redirecionamento é falha, e o outro servidor nem recebe requisição.</summary>
    [Test]
    public async Task Install_WhenTheServerRedirectsToAnotherHost_IsRefused_AndTheOtherHostIsNeverCalled()
    {
        //Arrange
        var other = await StartServerAsync(PackageServer.Serve(_package));
        var server = await StartServerAsync(context =>
        {
            context.Response.Redirect(new Uri(other.Address, DriverPackageFakers.RequestPath.TrimStart('/')).ToString());

            return Task.CompletedTask;
        });
        var service = Start(server);

        //Act
        var driver = await InstallAsync(service);

        //Assert
        Assert.That(driver.State, Is.EqualTo(EDriverState.Failed));
        Assert.That(driver.Error?.Kind, Is.EqualTo(EDriverInstallFailure.DownloadFailed));
        Assert.That(driver.Error?.Detail, Does.Contain("redirecion"));
        Assert.That(server.Requests, Has.Count.EqualTo(1));
        Assert.That(other.Requests, Is.Empty);
        Assert.That(FilesUnderDataDirectory(), Is.Empty);
    }

    /// <summary>O tamanho do catálogo é o teto: a resposta que anuncia mais é recusada antes de o corpo ser lido.</summary>
    [Test]
    public async Task Install_WhenContentLengthIsLargerThanTheCatalogSize_IsRefused()
    {
        //Arrange
        var larger = _package.Concat(new byte[4096]).ToArray();
        var server = await StartServerAsync(PackageServer.Serve(larger));
        var service = Start(server);

        //Act
        var driver = await InstallAsync(service);

        //Assert
        Assert.That(driver.State, Is.EqualTo(EDriverState.Failed));
        Assert.That(driver.Error?.Kind, Is.EqualTo(EDriverInstallFailure.IntegrityFailed));
        Assert.That(FilesUnderDataDirectory(), Is.Empty);
    }

    /// <summary>Sem tamanho anunciado (resposta em pedaços), a leitura para no primeiro byte além do tamanho do catálogo.</summary>
    [Test]
    public async Task Install_WhenTheBodyIsLongerThanTheCatalogSize_IsRefused()
    {
        //Arrange
        var server = await StartServerAsync(async context =>
        {
            await context.Response.Body.WriteAsync(_package, context.RequestAborted);
            await context.Response.Body.WriteAsync(new byte[64 * 1024], context.RequestAborted);
        });
        var service = Start(server);

        //Act
        var driver = await InstallAsync(service);

        //Assert
        Assert.That(driver.State, Is.EqualTo(EDriverState.Failed));
        Assert.That(driver.Error?.Kind, Is.EqualTo(EDriverInstallFailure.IntegrityFailed));
        Assert.That(FilesUnderDataDirectory(), Is.Empty);
    }

    [Test]
    public async Task Install_WhenTheBodyEndsBeforeTheCatalogSize_IsDownloadFailed()
    {
        //Arrange
        var server = await StartServerAsync(context => context.Response.Body.WriteAsync(_package.AsMemory(0, _package.Length - 10), context.RequestAborted).AsTask());
        var service = Start(server);

        //Act
        var driver = await InstallAsync(service);

        //Assert
        Assert.That(driver.State, Is.EqualTo(EDriverState.Failed));
        Assert.That(driver.Error?.Kind, Is.EqualTo(EDriverInstallFailure.DownloadFailed));
        Assert.That(FilesUnderDataDirectory(), Is.Empty);
    }

    /// <summary>
    /// RN-LOG-001: a recusa do servidor chega à tela com o status, e nada do corpo nem dos cabeçalhos da resposta vai para a tela ou para
    /// o log. O log diz o driver, a versão e a causa, e não traz o caminho da pasta de dados.
    /// </summary>
    [Test]
    public async Task Install_WhenTheServerRefuses_SaysTheStatus_AndNeitherScreenNorLogGetTheBodyOrTheHeaders()
    {
        //Arrange
        const string bodyMark = "corpo-marcado-7f3a";
        const string headerMark = "cabecalho-marcado-91bc";
        var server = await StartServerAsync(async context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.Headers["X-Motivo"] = headerMark;
            await context.Response.WriteAsync(bodyMark, context.RequestAborted);
        });
        var service = Start(server);

        //Act
        var driver = await InstallAsync(service);

        //Assert
        Assert.That(driver.State, Is.EqualTo(EDriverState.Failed));
        Assert.That(driver.Error?.Kind, Is.EqualTo(EDriverInstallFailure.DownloadFailed));
        Assert.That(driver.Error?.Detail, Does.Contain("403").And.Not.Contain(bodyMark).And.Not.Contain(headerMark));

        var log = _log.Lines;
        Assert.That(log.Any(line => line.Contains(DriverPackageFakers.DriverID) && line.Contains(DriverPackageFakers.Version) && line.Contains("403")), Is.True, "o log diz o driver, a versão e a causa");
        Assert.That(log, Has.None.Contains(bodyMark));
        Assert.That(log, Has.None.Contains(headerMark));
        Assert.That(log, Has.None.Contains(_dataDirectory));
        Assert.That(log, Has.None.Contains(Path.GetFileName(_dataDirectory)));
    }

    [Test]
    public async Task Install_WhenTheServerIsUnreachable_IsDownloadFailed()
    {
        //Arrange
        var server = await PackageServer.StartAsync(PackageServer.Serve(_package));
        var service = Start(server);
        await server.DisposeAsync();

        //Act
        var driver = await InstallAsync(service);

        //Assert
        Assert.That(driver.State, Is.EqualTo(EDriverState.Failed));
        Assert.That(driver.Error?.Kind, Is.EqualTo(EDriverInstallFailure.DownloadFailed));
        Assert.That(driver.Error?.Detail, Is.EqualTo("Não foi possível conectar no nuget.org."));
        Assert.That(FilesUnderDataDirectory(), Is.Empty);
    }

    /// <summary>O catálogo de teste aponta para um arquivo que não é zip: o hash confere, e a abertura falha sem deixar nada.</summary>
    [Test]
    public async Task Install_WhenThePackageIsNotAZip_IsIntegrityFailed()
    {
        //Arrange
        var notAZip = RandomNumberGenerator.GetBytes(2048);
        var server = await StartServerAsync(PackageServer.Serve(notAZip));
        var service = Start(server, DriverPackageFakers.CatalogJson(notAZip));

        //Act
        var driver = await InstallAsync(service);

        //Assert
        Assert.That(driver.State, Is.EqualTo(EDriverState.Failed));
        Assert.That(driver.Error?.Kind, Is.EqualTo(EDriverInstallFailure.IntegrityFailed));
        Assert.That(FilesUnderDataDirectory(), Is.Empty);
    }

    /// <summary>
    /// Uma exceção no meio da extração (o disco recusa a segunda entrada: `a` já é arquivo quando `a/b` pede que seja pasta), depois de
    /// parte dos arquivos já estar gravada: o driver não fica instalado, a pasta temporária some, e a partida seguinte acha tudo limpo.
    /// </summary>
    [Test]
    public async Task Install_WhenExtractionFailsHalfway_LeavesNothing_AndTheNextStartIsClean()
    {
        //Arrange
        var broken = DriverPackageFakers.CreatePackage([.. DriverPackageFakers.ValidEntries(), ("nativo-origem/a", [1]), ("nativo-origem/a/b", [2])]);
        var server = await StartServerAsync(PackageServer.Serve(broken));
        var service = Start(server, DriverPackageFakers.CatalogJson(broken));

        //Act
        var driver = await InstallAsync(service);
        var afterRestart = TestDriver(Start(server, DriverPackageFakers.CatalogJson(broken)));

        //Assert
        Assert.That(driver.State, Is.EqualTo(EDriverState.Failed));
        Assert.That(driver.Error?.Kind, Is.EqualTo(EDriverInstallFailure.DownloadFailed));
        Assert.That(FilesUnderDataDirectory(), Is.Empty);
        Assert.That(Directory.EnumerateFileSystemEntries(DriverDirectory), Is.Empty);
        Assert.That(afterRestart.State, Is.EqualTo(EDriverState.Available));
    }

    /// <summary>
    /// O processo morreu no meio de uma instalação, sem chance de limpar: ficaram a pasta temporária com parte dos arquivos e o pacote
    /// baixado. Na partida seguinte o driver não está instalado, a sobra foi apagada, e a instalação funciona.
    /// </summary>
    [Test]
    public async Task Start_AfterAnInstallThatWasKilled_CleansTheLeftovers_AndTheDriverIsNotInstalled()
    {
        //Arrange
        var leftover = Directory.CreateDirectory(Path.Combine(DriverDirectory, ".tmp-0123456789abcdef")).FullName;
        await File.WriteAllBytesAsync(Path.Combine(leftover, DriverPackageFakers.ManagedAssembly), RandomNumberGenerator.GetBytes(1024));
        await File.WriteAllBytesAsync(Path.Combine(DriverDirectory, ".tmp-fedcba9876543210.nupkg"), _package.AsMemory(0, 100).ToArray());
        var server = await StartServerAsync(PackageServer.Serve(_package));

        //Act
        var service = Start(server);
        var atStart = TestDriver(service);
        var leftAtStart = Directory.EnumerateFileSystemEntries(DriverDirectory).ToArray();
        var installed = await InstallAsync(service);

        //Assert
        Assert.That(atStart.State, Is.EqualTo(EDriverState.Available));
        Assert.That(atStart.RestartRequired, Is.False);
        Assert.That(leftAtStart, Is.Empty);
        Assert.That(installed.State, Is.EqualTo(EDriverState.Installed));
    }

    /// <summary>
    /// O arquivo do driver foi alterado depois de instalado: na partida o driver vale como não instalado, o motivo vai para o log, e uma
    /// instalação nova toma o lugar da pasta que não passou na conferência.
    /// </summary>
    [TestCase("Driver.Teste.dll")]
    [TestCase("nativo/bin/teste.bin")]
    public async Task Start_WhenAnInstalledFileWasTampered_TheDriverIsNotInstalled_AndCanBeInstalledAgain(string file)
    {
        //Arrange
        var server = await StartServerAsync(PackageServer.Serve(_package));
        await InstallAsync(Start(server));
        var path = Path.Combine(InstallDirectory, file);
        var original = await File.ReadAllBytesAsync(path);
        await File.WriteAllBytesAsync(path, WithOneByteChanged(original));

        //Act
        var service = Start(server);
        var atStart = TestDriver(service);
        var installed = await InstallAsync(service);

        //Assert
        Assert.That(atStart.State, Is.EqualTo(EDriverState.Available));
        Assert.That(_log.Lines.Any(line => line.Contains(DriverPackageFakers.DriverID) && line.Contains(DriverPackageFakers.Version) && line.Contains("não passou na conferência")), Is.True, "o motivo vai para o log");
        Assert.That(installed.State, Is.EqualTo(EDriverState.Installed));
        Assert.That(await File.ReadAllBytesAsync(path), Is.EqualTo(original), "a instalação nova pôs de volta o arquivo do pacote");
        Assert.That(TestDriver(Start(server)).State, Is.EqualTo(EDriverState.Installed));
    }

    /// <summary>RN-DRIVER-007: a remoção só é marcada; a pasta sai na partida seguinte, e até lá o driver aparece `available` com reinício pendente.</summary>
    [Test]
    public async Task Remove_MarksTheRemoval_AndTheNextStartDeletesTheDriver()
    {
        //Arrange
        var server = await StartServerAsync(PackageServer.Serve(_package));
        await InstallAsync(Start(server));
        var service = Start(server);

        //Act
        var removed = service.Remove(DriverPackageFakers.DriverID);
        var afterRemove = TestDriver(service);
        var stillOnDisk = Directory.Exists(InstallDirectory);
        var afterRestart = TestDriver(Start(server));

        //Assert
        Assert.That(removed.IsSuccess, Is.True);
        Assert.That(afterRemove.State, Is.EqualTo(EDriverState.Available));
        Assert.That(afterRemove.RestartRequired, Is.True);
        Assert.That(stillOnDisk, Is.True, "um assembly carregado não se apaga: a pasta só sai no reinício");
        Assert.That(afterRestart.State, Is.EqualTo(EDriverState.Available));
        Assert.That(afterRestart.RestartRequired, Is.False);
        Assert.That(FilesUnderDataDirectory(), Is.Empty);
        Assert.That(_log.Lines.Any(line => line.Contains("remoção") && line.Contains(DriverPackageFakers.DriverID) && line.Contains(DriverPackageFakers.Version)), Is.True, "a remoção fica no log, com o driver e a versão");
    }

    /// <summary>
    /// O catálogo de verdade contra o pacote de verdade, o que o NuGet deixou no cache da máquina no restore (sem rede): o endereço que a
    /// API monta, o tamanho e o SHA-512 do catálogo, e a extração de cada plataforma, inclusive as que esta máquina não roda. O pacote do
    /// cache é o que o NuGet conferiu contra o `.nupkg.sha512` ao lado dele, e o teste confere de novo.
    /// </summary>
    [TestCase("win-x64", "net.ibm.data.db2", "clidriver/bin/db2app64.dll")]
    [TestCase("linux-x64", "net.ibm.data.db2-lnx", "clidriver/lib/libdb2.so")]
    [TestCase("osx-arm64", "net.ibm.data.db2-osx", "clidriver/lib/libdb2.dylib")]
    public async Task Install_TheRealIbmPackageFromTheNuGetCache_MatchesTheRealCatalog(string platform, string packageName, string nativeLibrary)
    {
        //Arrange
        const string version = "10.0.0.300";
        var cached = Path.Combine(Environment.GetEnvironmentVariable("NUGET_PACKAGES") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".nuget", "packages"), packageName, version, $"{packageName}.{version}.nupkg");
        if (!File.Exists(cached))
            Assert.Ignore($"O pacote {packageName} {version} não está no cache do NuGet desta máquina.");

        var package = await File.ReadAllBytesAsync(cached);
        Assert.That(DriverPackageFakers.Sha512(package), Is.EqualTo((await File.ReadAllTextAsync(cached + ".sha512")).Trim()), "o pacote do cache não é o que o NuGet conferiu");

        var server = await StartServerAsync(PackageServer.Serve(package));
        var provider = new ServiceCollection().AddInfrastructure(_dataDirectory).UseDriverSource(server.Address, platform: platform).BuildServiceProvider();
        _disposables.Add(provider);
        var service = provider.GetRequiredService<IDriverService>();

        //Act
        var started = service.Install("ibm-data-server", acceptedLicense: true);
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(2));
        while (service.List().Single(driver => driver.ID == "ibm-data-server").State == EDriverState.Installing)
            await Task.Delay(50, timeout.Token);
        var ibm = service.List().Single(driver => driver.ID == "ibm-data-server");

        //Assert
        var installDirectory = Path.Combine(_dataDirectory, "drivers", "ibm-data-server", version);
        Assert.That(started.IsSuccess, Is.True);
        Assert.That(ibm.Error, Is.Null, ibm.Error?.Detail);
        Assert.That(ibm.State, Is.EqualTo(EDriverState.Installed));
        Assert.That(ibm.Version, Is.EqualTo(version));
        Assert.That(ibm.SizeBytes, Is.EqualTo(package.LongLength));
        Assert.That(server.Requests, Is.EqualTo(new[] { $"GET /{packageName}/{version}/{packageName}.{version}.nupkg" }));
        Assert.That(File.Exists(Path.Combine(installDirectory, "IBM.Data.Db2.dll")), Is.True);
        Assert.That(File.Exists(Path.Combine(installDirectory, nativeLibrary)), Is.True);
        Assert.That(File.Exists(Path.Combine(installDirectory, "Lic_en.txt")), Is.True);
        Assert.That(File.Exists(Path.Combine(installDirectory, "install.json")), Is.True);
        Assert.That(Directory.EnumerateFiles(installDirectory, "TestConn*", SearchOption.AllDirectories), Is.Empty, "o executável de teste da IBM não é extraído");
        Assert.That(Directory.EnumerateFileSystemEntries(installDirectory).Select(Path.GetFileName), Is.EquivalentTo(new[] { "IBM.Data.Db2.dll", "Lic_en.txt", "REDIST.txt", "clidriver", "install.json" }));
    }

    /// <summary>O que o Serilog recebeu, já com os valores no texto.</summary>
    private sealed class CollectingSink : ILogEventSink
    {
        private readonly List<string> _lines = [];

        public IReadOnlyList<string> Lines
        {
            get
            {
                lock (_lines)
                    return [.. _lines];
            }
        }

        public void Emit(LogEvent logEvent)
        {
            lock (_lines)
                _lines.Add($"{logEvent.Level} {logEvent.RenderMessage()}");
        }
    }
}
