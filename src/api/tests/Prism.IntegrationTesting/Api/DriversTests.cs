using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Extensions;
using Prism.TestingCore.Fakers.Drivers;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// As rotas de `api/user/drivers` pela API de verdade (seção 16 da especificação): a tabela de rotas, o formato do item e o bloco "O que
/// a lista garante", que é o contrato com a tela (`drivers.schema.ts`). O nuget.org é um servidor de mentira em 127.0.0.1, e o catálogo
/// é o de teste, com um driver em cada situação; nada usa a rede de fora nem um banco. Cada teste escreve na saída o corpo que a API
/// devolveu em cada estado (`--logger "console;verbosity=detailed"`).
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class DriversTests
{
    private const string DriversPath = "/api/user/drivers";
    private const string InstallPath = $"{DriversPath}/{DriverPackageFakers.DriverID}/install";
    private const string DriverPath = $"{DriversPath}/{DriverPackageFakers.DriverID}";

    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(30);

    /// <summary>As chaves do `driverSchema` da tela, na ordem da especificação.</summary>
    private static readonly string[] ItemKeys = ["id", "name", "vendor", "engines", "state", "version", "sizeBytes", "license", "platformNote", "progress", "error", "restartRequired"];

    private static readonly byte[] Package = DriverPackageFakers.CreateValidPackage();

    /// <summary>A API com o cofre aberto, o catálogo de teste e o servidor de mentira no lugar do nuget.org.</summary>
    private static async Task<ApiHost> StartAsync(PackageServer server, string? directory = null)
    {
        var host = await ApiHost.StartAsync(services => services.UseDriverSource(server.Address, DriverPackageFakers.CatalogJson(Package), DriverPackageFakers.Platform, directory));
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        return host;
    }

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.That(response.StatusCode, Is.EqualTo(status), body.ToString());
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));
        Assert.That(body.GetProperty("detail").GetString(), Is.Not.Empty);
    }

    private static Task<HttpResponseMessage> InstallAsync(ApiHost host, object? body)
        => body is null ? host.Client.PostAsync(InstallPath, null) : host.Client.PostAsJsonAsync(InstallPath, body);

    private static Task<HttpResponseMessage> AcceptAndInstallAsync(ApiHost host)
        => InstallAsync(host, new { acceptedLicense = true });

    /// <summary>O item do driver de teste, como a API o escreveu, e o corpo dele na saída do teste.</summary>
    private static async Task<JsonElement> GetTestDriverAsync(ApiHost host, string? label = null)
    {
        var response = await host.Client.GetAsync(DriversPath);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));

        var driver = (await response.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().Single(item => item.GetProperty("id").GetString() == DriverPackageFakers.DriverID);
        Assert.That(driver.EnumerateObject().Select(property => property.Name), Is.EqualTo(ItemKeys), "toda chave do item vem sempre");

        if (label is not null)
            await TestContext.Out.WriteLineAsync($"{label}: {driver.GetRawText()}");

        return driver;
    }

    /// <summary>Consulta a lista até o driver chegar ao estado esperado, como a tela faz a cada segundo.</summary>
    private static async Task<JsonElement> WaitForAsync(ApiHost host, Func<JsonElement, bool> ready, string? label = null)
    {
        using var timeout = new CancellationTokenSource(Patience);

        while (!ready(await GetTestDriverAsync(host)))
            await Task.Delay(20, timeout.Token);

        return await GetTestDriverAsync(host, label);
    }

    private static string? StateOf(JsonElement driver)
        => driver.GetProperty("state").GetString();

    private static bool IsNull(JsonElement driver, string property)
        => driver.GetProperty(property).ValueKind == JsonValueKind.Null;

    [Test]
    public async Task Routes_NeedTheTokenAndTheUnlockedVault()
    {
        await using var server = await PackageServer.StartAsync(PackageServer.Serve(Package));
        await using var host = await ApiHost.StartAsync(services => services.UseDriverSource(server.Address, DriverPackageFakers.CatalogJson(Package), DriverPackageFakers.Platform));

        var withoutToken = await host.ClientWithoutToken.GetAsync(DriversPath);
        var list = await host.Client.GetAsync(DriversPath);
        var install = await AcceptAndInstallAsync(host);
        var cancel = await host.Client.DeleteAsync(InstallPath);
        var remove = await host.Client.DeleteAsync(DriverPath);

        // Os drivers são da máquina (RN-DRIVER-009), mas as rotas são `api/user/...`: sem o cofre aberto, nada responde nem começa.
        await AssertProblemAsync(withoutToken, HttpStatusCode.Unauthorized, "AUTHENTICATION_REQUIRED");
        await AssertProblemAsync(list, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(install, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(cancel, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(remove, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        Assert.That(server.Requests, Is.Empty);
    }

    /// <summary>O formato do item e o que a lista garante: toda chave sempre presente, `null` onde não se aplica, bancos em número, estado em texto.</summary>
    [Test]
    public async Task GetDrivers_ReturnsTheCatalogInOrder_WithEveryKeyOfTheScreenSchema()
    {
        await using var server = await PackageServer.StartAsync(PackageServer.Serve(Package));
        await using var host = await StartAsync(server);

        var response = await host.Client.GetAsync(DriversPath);
        var text = await response.Content.ReadAsStringAsync();
        var drivers = JsonDocument.Parse(text).RootElement.EnumerateArray().ToList();
        await TestContext.Out.WriteLineAsync($"lista: {text}");

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(drivers.Select(driver => driver.GetProperty("id").GetString()), Is.EqualTo(new[] { DriverPackageFakers.BundledDriverID, DriverPackageFakers.DriverID, DriverPackageFakers.UnavailableDriverID, DriverPackageFakers.ComingSoonDriverID }));
        Assert.That(drivers.Select(StateOf), Is.EqualTo(new[] { "bundled", "available", "unavailable", "comingSoon" }));
        Assert.That(drivers, Has.All.Matches<JsonElement>(driver => driver.EnumerateObject().Select(property => property.Name).SequenceEqual(ItemKeys)));

        var bundled = drivers[0];
        Assert.That(bundled.GetProperty("engines").GetRawText(), Is.EqualTo("[1]"));
        Assert.That(bundled.GetProperty("version").GetString(), Is.EqualTo("1.0.0"));
        Assert.That(IsNull(bundled, "sizeBytes"), Is.True);
        Assert.That(bundled.GetProperty("license").GetProperty("url").GetString(), Does.StartWith("https://"));

        var available = drivers[1];
        Assert.That(available.GetProperty("name").GetString(), Is.EqualTo(DriverPackageFakers.DriverName));
        Assert.That(available.GetProperty("vendor").GetString(), Is.EqualTo("Fabricante B"));
        Assert.That(available.GetProperty("engines").GetRawText(), Is.EqualTo("[2]"));
        Assert.That(available.GetProperty("version").GetString(), Is.EqualTo(DriverPackageFakers.Version));
        Assert.That(available.GetProperty("sizeBytes").GetInt64(), Is.EqualTo(Package.LongLength));
        Assert.That(available.GetProperty("license").GetProperty("name").GetString(), Is.EqualTo(DriverPackageFakers.LicenseName));
        Assert.That(available.GetProperty("license").GetProperty("url").GetString(), Is.EqualTo(DriverPackageFakers.LicenseUrl));
        Assert.That(available.GetProperty("platformNote").GetString(), Is.EqualTo(DriverPackageFakers.PlatformNote));
        Assert.That(IsNull(available, "progress"), Is.True);
        Assert.That(IsNull(available, "error"), Is.True);
        Assert.That(available.GetProperty("restartRequired").GetBoolean(), Is.False);

        var unavailable = drivers[2];
        Assert.That(unavailable.GetProperty("engines").GetRawText(), Is.EqualTo("[3]"));
        Assert.That(unavailable.GetProperty("platformNote").GetString(), Is.EqualTo(DriverPackageFakers.UnavailableNote));
        Assert.That(IsNull(unavailable, "sizeBytes"), Is.True);
        Assert.That(IsNull(unavailable, "license"), Is.True);

        // "Um driver `comingSoon` tem `engines` vazio e `version` nulo", e o resto vai como `null`, escrito.
        Assert.That(drivers[3].GetRawText(), Is.EqualTo($$"""{"id":"{{DriverPackageFakers.ComingSoonDriverID}}","name":"Em Breve","vendor":"Fabricante D","engines":[],"state":"comingSoon","version":null,"sizeBytes":null,"license":null,"platformNote":null,"progress":null,"error":null,"restartRequired":false}"""));
        Assert.That(server.Requests, Is.Empty, "consultar a lista não baixa nada (RN-DRIVER-008)");
    }

    /// <summary>As recusas do `POST …/install` que não começam nada: 404, 422 sem o aceite, 422 indisponível, 409 embutido.</summary>
    [Test]
    public async Task Install_RefusesUnknownUnacceptedUnavailableAndBundled_WithoutDownloading()
    {
        await using var server = await PackageServer.StartAsync(PackageServer.Serve(Package));
        await using var host = await StartAsync(server);

        var unknown = await host.Client.PostAsJsonAsync($"{DriversPath}/nao-existe/install", new { acceptedLicense = true });
        var withoutBody = await InstallAsync(host, null);
        var emptyBody = await InstallAsync(host, new { });
        var refusedLicense = await InstallAsync(host, new { acceptedLicense = false });
        var otherDriverInBody = await host.Client.PostAsJsonAsync($"{DriversPath}/{DriverPackageFakers.ComingSoonDriverID}/install", new { id = DriverPackageFakers.DriverID, acceptedLicense = true });
        var unavailable = await host.Client.PostAsJsonAsync($"{DriversPath}/{DriverPackageFakers.UnavailableDriverID}/install", new { acceptedLicense = true });
        var bundled = await host.Client.PostAsJsonAsync($"{DriversPath}/{DriverPackageFakers.BundledDriverID}/install", new { acceptedLicense = true });

        await AssertProblemAsync(unknown, HttpStatusCode.NotFound, "DRIVER_NOT_FOUND");

        // RN-DRIVER-003: sem o aceite, 422, com o corpo ausente, vazio ou dizendo "não".
        await AssertProblemAsync(withoutBody, HttpStatusCode.UnprocessableEntity, "DRIVER_LICENSE_NOT_ACCEPTED");
        await AssertProblemAsync(emptyBody, HttpStatusCode.UnprocessableEntity, "DRIVER_LICENSE_NOT_ACCEPTED");
        await AssertProblemAsync(refusedLicense, HttpStatusCode.UnprocessableEntity, "DRIVER_LICENSE_NOT_ACCEPTED");

        // O driver é o da rota: o `id` do corpo não instala outro.
        await AssertProblemAsync(otherDriverInBody, HttpStatusCode.UnprocessableEntity, "DRIVER_UNAVAILABLE");
        await AssertProblemAsync(unavailable, HttpStatusCode.UnprocessableEntity, "DRIVER_UNAVAILABLE");
        await AssertProblemAsync(bundled, HttpStatusCode.Conflict, "DRIVER_ALREADY_INSTALLED");
        Assert.That(StateOf(await GetTestDriverAsync(host)), Is.EqualTo("available"));
        Assert.That(server.Requests, Is.Empty, "nenhuma recusa chegou a pedir o pacote");
    }

    /// <summary>
    /// O caminho inteiro de uma instalação, no ritmo que o teste dita: 202 sem corpo; a lista já em `installing` com `progress` nulo; o
    /// progresso a partir do primeiro byte, com o tamanho do catálogo como total; as recusas de quem tenta de novo no meio; e o fim,
    /// `installed` com `restartRequired`.
    /// </summary>
    [Test]
    public async Task Install_Returns202_TheListShowsInstallingAtOnce_ThenProgress_ThenInstalledWithRestartRequired()
    {
        var firstByte = new TaskCompletionSource();
        var rest = new TaskCompletionSource();
        await using var server = await PackageServer.StartAsync(PackageServer.ServeSlowly(Package, 2048, rest.Task, firstByte.Task));
        await using var host = await StartAsync(server);

        // "Quando o `POST …/install` responde 202, a lista já mostra o driver como `installing`. `progress` é nulo até o primeiro byte chegar."
        var accepted = await AcceptAndInstallAsync(host);
        var installing = await GetTestDriverAsync(host, "installing, antes do primeiro byte");

        Assert.That(accepted.StatusCode, Is.EqualTo(HttpStatusCode.Accepted));
        Assert.That(await accepted.Content.ReadAsStringAsync(), Is.Empty, "a tela não lê corpo no 202");
        Assert.That(StateOf(installing), Is.EqualTo("installing"));
        Assert.That(IsNull(installing, "progress"), Is.True);
        Assert.That(IsNull(installing, "error"), Is.True);
        Assert.That(installing.GetProperty("restartRequired").GetBoolean(), Is.False);

        // "`totalBytes` é o tamanho do catálogo."
        firstByte.SetResult();
        var downloading = await WaitForAsync(host, driver => !IsNull(driver, "progress") && driver.GetProperty("progress").GetProperty("receivedBytes").GetInt64() == 2048, "installing, com progresso");

        Assert.That(StateOf(downloading), Is.EqualTo("installing"));
        Assert.That(downloading.GetProperty("progress").GetRawText(), Is.EqualTo($$"""{"receivedBytes":2048,"totalBytes":{{Package.Length}}}"""));

        // RN-DRIVER-004: uma instalação por driver de cada vez; e o que está instalando ainda não está instalado para ser removido.
        await AssertProblemAsync(await AcceptAndInstallAsync(host), HttpStatusCode.Conflict, "DRIVER_INSTALL_IN_PROGRESS");
        await AssertProblemAsync(await host.Client.DeleteAsync(DriverPath), HttpStatusCode.Conflict, "DRIVER_NOT_INSTALLED");

        // RN-DRIVER-005: terminada a instalação, o driver só vale depois do reinício.
        rest.SetResult();
        var installed = await WaitForAsync(host, driver => StateOf(driver) != "installing", "installed, antes do reinício");

        Assert.That(StateOf(installed), Is.EqualTo("installed"));
        Assert.That(installed.GetProperty("restartRequired").GetBoolean(), Is.True);
        Assert.That(IsNull(installed, "progress"), Is.True);
        Assert.That(IsNull(installed, "error"), Is.True);
        Assert.That(server.Requests, Is.EqualTo(new[] { $"GET {DriverPackageFakers.RequestPath}" }));

        // A suposição da tela: cancelar uma instalação que já acabou é 409 `DRIVER_NOT_INSTALLING`. E instalar o que já está instalado, 409.
        await AssertProblemAsync(await host.Client.DeleteAsync(InstallPath), HttpStatusCode.Conflict, "DRIVER_NOT_INSTALLING");
        await AssertProblemAsync(await AcceptAndInstallAsync(host), HttpStatusCode.Conflict, "DRIVER_ALREADY_INSTALLED");
    }

    /// <summary>"Cancelar a instalação (`DELETE …/install`) devolve o driver a `available`, sem `error`."</summary>
    [Test]
    public async Task CancelInstall_Returns204_AndTheDriverIsAvailableAgainWithoutError()
    {
        var never = new TaskCompletionSource();
        await using var server = await PackageServer.StartAsync(PackageServer.ServeSlowly(Package, 1024, never.Task));
        await using var host = await StartAsync(server);

        var unknown = await host.Client.DeleteAsync($"{DriversPath}/nao-existe/install");
        var idle = await host.Client.DeleteAsync(InstallPath);
        await AcceptAndInstallAsync(host);
        await WaitForAsync(host, driver => !IsNull(driver, "progress"));

        var canceled = await host.Client.DeleteAsync(InstallPath);
        var driver = await GetTestDriverAsync(host, "available, depois de cancelar");
        var again = await host.Client.DeleteAsync(InstallPath);

        await AssertProblemAsync(unknown, HttpStatusCode.NotFound, "DRIVER_NOT_FOUND");
        await AssertProblemAsync(idle, HttpStatusCode.Conflict, "DRIVER_NOT_INSTALLING");
        Assert.That(canceled.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(StateOf(driver), Is.EqualTo("available"));
        Assert.That(IsNull(driver, "error"), Is.True);
        Assert.That(IsNull(driver, "progress"), Is.True);
        Assert.That(driver.GetProperty("restartRequired").GetBoolean(), Is.False);
        await AssertProblemAsync(again, HttpStatusCode.Conflict, "DRIVER_NOT_INSTALLING");
    }

    /// <summary>
    /// "`failed` fica até uma nova tentativa, e o `POST …/install` é aceito a partir de `failed`": a queda no meio (RN-DRIVER-004,
    /// `DRIVER_DOWNLOAD_FAILED`), o pacote que não confere (RN-DRIVER-003, `DRIVER_INTEGRITY_FAILED`) e a terceira tentativa, que instala.
    /// </summary>
    [Test]
    public async Task Install_WhenItFails_TheListShowsFailedWithTheCodeAndTheCause_AndARetryIsAccepted()
    {
        var tampered = (byte[])Package.Clone();
        tampered[^1] ^= 0xFF;
        await using var server = await PackageServer.StartAsync((context, request) => request switch
        {
            1 => PackageServer.DropAfter(Package, Package.Length / 2)(context),
            2 => PackageServer.Serve(tampered)(context),
            _ => PackageServer.Serve(Package)(context)
        });
        await using var host = await StartAsync(server);

        await AcceptAndInstallAsync(host);
        var downloadFailed = await WaitForAsync(host, driver => StateOf(driver) != "installing", "failed, download");
        var stillFailed = await GetTestDriverAsync(host);
        var secondAccepted = await AcceptAndInstallAsync(host);
        var integrityFailed = await WaitForAsync(host, driver => StateOf(driver) != "installing", "failed, integridade");
        var thirdAccepted = await AcceptAndInstallAsync(host);
        var installed = await WaitForAsync(host, driver => StateOf(driver) != "installing");

        Assert.That(StateOf(downloadFailed), Is.EqualTo("failed"));
        Assert.That(downloadFailed.GetProperty("error").GetProperty("code").GetString(), Is.EqualTo("DRIVER_DOWNLOAD_FAILED"));
        Assert.That(downloadFailed.GetProperty("error").GetProperty("detail").GetString(), Is.EqualTo("A conexão caiu durante o download."));
        Assert.That(downloadFailed.GetProperty("restartRequired").GetBoolean(), Is.False);
        Assert.That(IsNull(downloadFailed, "progress"), Is.True);
        Assert.That(StateOf(stillFailed), Is.EqualTo("failed"), "a falha fica à vista até uma nova tentativa");
        Assert.That(secondAccepted.StatusCode, Is.EqualTo(HttpStatusCode.Accepted));
        Assert.That(StateOf(integrityFailed), Is.EqualTo("failed"));
        Assert.That(integrityFailed.GetProperty("error").GetProperty("code").GetString(), Is.EqualTo("DRIVER_INTEGRITY_FAILED"));
        Assert.That(integrityFailed.GetProperty("error").GetProperty("detail").GetString(), Is.Not.Empty);
        Assert.That(thirdAccepted.StatusCode, Is.EqualTo(HttpStatusCode.Accepted));
        Assert.That(StateOf(installed), Is.EqualTo("installed"));
        Assert.That(IsNull(installed, "error"), Is.True);
        Assert.That(server.Requests, Has.Count.EqualTo(3));
    }

    /// <summary>RN-DRIVER-007: remover responde 204 e vale no reinício; até lá, "`available` com `restartRequired` verdadeiro".</summary>
    [Test]
    public async Task Remove_Returns204_AndTheDriverIsAvailableWithRestartRequired()
    {
        await using var server = await PackageServer.StartAsync(PackageServer.Serve(Package));
        await using var host = await StartAsync(server);

        var unknown = await host.Client.DeleteAsync($"{DriversPath}/nao-existe");
        var notInstalled = await host.Client.DeleteAsync(DriverPath);
        var bundled = await host.Client.DeleteAsync($"{DriversPath}/{DriverPackageFakers.BundledDriverID}");
        await AcceptAndInstallAsync(host);
        await WaitForAsync(host, driver => StateOf(driver) == "installed");

        var removed = await host.Client.DeleteAsync(DriverPath);
        var driver = await GetTestDriverAsync(host, "available, removido e à espera do reinício");
        var removedAgain = await host.Client.DeleteAsync(DriverPath);
        var installedAgain = await AcceptAndInstallAsync(host);

        await AssertProblemAsync(unknown, HttpStatusCode.NotFound, "DRIVER_NOT_FOUND");
        await AssertProblemAsync(notInstalled, HttpStatusCode.Conflict, "DRIVER_NOT_INSTALLED");
        await AssertProblemAsync(bundled, HttpStatusCode.Conflict, "DRIVER_NOT_INSTALLED");
        Assert.That(removed.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(StateOf(driver), Is.EqualTo("available"));
        Assert.That(driver.GetProperty("restartRequired").GetBoolean(), Is.True);
        Assert.That(IsNull(driver, "error"), Is.True);

        // Até o reinício a pasta do driver continua no disco: não há o que remover de novo, nem como instalar por cima.
        await AssertProblemAsync(removedAgain, HttpStatusCode.Conflict, "DRIVER_NOT_INSTALLED");
        await AssertProblemAsync(installedAgain, HttpStatusCode.Conflict, "DRIVER_ALREADY_INSTALLED");
    }

    /// <summary>
    /// RN-DRIVER-005, 007 e 009, com três execuções da API sobre a mesma pasta de drivers: o que uma instala, a seguinte usa, sem
    /// reinício pendente (a suposição da tela: `restartRequired` volta a falso depois do reinício); o que uma remove, a seguinte não tem
    /// mais. A pasta é da máquina: cada execução aqui tem um cofre e um usuário próprios.
    /// </summary>
    [Test]
    public async Task Restart_AppliesTheInstallAndTheRemoval_AndRestartRequiredGoesBackToFalse()
    {
        using var folder = new TemporaryFolder();
        var drivers = folder.Path;
        await using var server = await PackageServer.StartAsync(PackageServer.Serve(Package));

        await using (var first = await StartAsync(server, drivers))
        {
            await AcceptAndInstallAsync(first);
            await WaitForAsync(first, driver => StateOf(driver) == "installed");
        }

        JsonElement afterInstall, afterRemove;
        HttpResponseMessage removed;
        await using (var second = await StartAsync(server, drivers))
        {
            afterInstall = await GetTestDriverAsync(second, "installed, depois do reinício");
            removed = await second.Client.DeleteAsync(DriverPath);
            afterRemove = await GetTestDriverAsync(second);
        }

        JsonElement afterRestart;
        await using (var third = await StartAsync(server, drivers))
            afterRestart = await GetTestDriverAsync(third, "available, depois do reinício que removeu");

        Assert.That(StateOf(afterInstall), Is.EqualTo("installed"));
        Assert.That(afterInstall.GetProperty("restartRequired").GetBoolean(), Is.False);
        Assert.That(removed.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(StateOf(afterRemove), Is.EqualTo("available"));
        Assert.That(afterRemove.GetProperty("restartRequired").GetBoolean(), Is.True);
        Assert.That(StateOf(afterRestart), Is.EqualTo("available"));
        Assert.That(afterRestart.GetProperty("restartRequired").GetBoolean(), Is.False);
        Assert.That(Directory.EnumerateFiles(drivers, "*", SearchOption.AllDirectories), Is.Empty, "o driver removido saiu do disco");
        Assert.That(server.Requests, Has.Count.EqualTo(1));
    }

    /// <summary>
    /// RN-DRIVER-006, com o catálogo e a plataforma de verdade e nenhum driver instalado: testar conexão e abrir sessão de Db2 e de
    /// Informix respondem 422 `DRIVER_NOT_INSTALLED`, com o nome do driver no detalhe e `driverID` como extensão, e a API nem tenta
    /// conectar (o servidor de mentira posto como banco não vê ninguém). O PostgreSQL, que vem embutido, segue pelo caminho normal.
    /// </summary>
    [Test]
    public async Task ConnectionTestAndOpenSession_OfDb2AndInformix_WithoutTheDriver_Return422DriverNotInstalled_WithDriverID()
    {
        // Sem pacote da IBM para a plataforma, ou com a API compilada sem os clients dela (`-p:IbmDriverRuntime=osx-x64`), não há driver a instalar.
        if (RuntimeInformation.RuntimeIdentifier is not ("win-x64" or "linux-x64" or "osx-arm64") || !typeof(Prism.Infrastructure.DependencyInjection).Assembly.GetReferencedAssemblies().Any(assembly => assembly.Name == "IBM.Data.Db2"))
            Assert.Ignore("Esta API não tem driver da IBM a instalar nesta plataforma: a resposta aqui é DATABASE_CONNECTION_FAILED, conferida no teste de unidade.");

        using var database = new ConnectionCounter();
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        foreach (var engine in new[] { EDatabaseEngine.Db2, EDatabaseEngine.Informix })
        {
            var settings = new ConnectionSettings(engine, "127.0.0.1", database.Port, "banco", "usuario", $"senha-{Guid.NewGuid():N}");

            var tested = await host.Client.PostAsJsonAsync("/api/user/connections/test", new { engine = (int)engine, host = settings.Host, port = settings.Port, database = settings.Database, userName = settings.UserName, password = settings.Password });
            var opened = await host.Client.OpenSessionRawAsync(await host.Client.CreateConnectionAsync(settings, name: $"Banco {engine}"));

            foreach (var response in new[] { tested, opened })
            {
                var body = await response.Content.ReadFromJsonAsync<JsonElement>();
                await TestContext.Out.WriteLineAsync($"{engine}: {(int)response.StatusCode} {body.GetRawText()}");

                Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity), body.ToString());
                Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
                Assert.That(body.GetProperty("type").GetString(), Is.EqualTo("DRIVER_NOT_INSTALLED"));
                Assert.That(body.GetProperty("detail").GetString(), Does.Contain("IBM Data Server"));
                Assert.That(body.GetProperty("driverID").GetString(), Is.EqualTo("ibm-data-server"));
            }
        }

        Assert.That(database.Accepted, Is.Zero, "sem o driver a API não chega a conectar");

        // O `driverID` do erro é o identificador de uma linha da lista, que é para onde o "Instalar driver" da tela leva.
        var drivers = await (await host.Client.GetAsync(DriversPath)).Content.ReadFromJsonAsync<JsonElement>();
        var ibm = drivers.EnumerateArray().Single(driver => driver.GetProperty("id").GetString() == "ibm-data-server");
        Assert.That(StateOf(ibm), Is.EqualTo("available"));
        Assert.That(ibm.GetProperty("engines").GetRawText(), Is.EqualTo("[2,3]"));
    }

    /// <summary>
    /// RN-DRIVER-005: a conferência da partida roda na subida da API, e não na primeira requisição que usa o gerenciador. A pasta de
    /// drivers começa com a sobra de uma instalação interrompida e com um driver marcado para remoção; quando a API termina de subir,
    /// sem nenhuma requisição, as duas coisas já foram resolvidas.
    /// </summary>
    [Test]
    public async Task Startup_RunsTheDriverCheck_BeforeAnyRequest()
    {
        using var folder = new TemporaryFolder();
        var drivers = folder.Path;
        var driverDirectory = Path.Combine(drivers, DriverPackageFakers.DriverID);
        await using var server = await PackageServer.StartAsync(PackageServer.Serve(Package));

        await using (var first = await StartAsync(server, drivers))
        {
            await AcceptAndInstallAsync(first);
            await WaitForAsync(first, driver => StateOf(driver) == "installed");
        }

        await using (var second = await StartAsync(server, drivers))
            Assert.That((await second.Client.DeleteAsync(DriverPath)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        Directory.CreateDirectory(Path.Combine(driverDirectory, ".tmp-0123456789abcdef"));
        var before = Directory.EnumerateFileSystemEntries(driverDirectory).Select(Path.GetFileName).Order().ToArray();

        await using (await ApiHost.StartAsync(services => services.UseDriverSource(server.Address, DriverPackageFakers.CatalogJson(Package), DriverPackageFakers.Platform, drivers)))
            Assert.That(Directory.EnumerateFileSystemEntries(driverDirectory), Is.Empty, "a API subiu, e ninguém pediu nada ainda");

        Assert.That(before, Is.EqualTo(new[] { ".tmp-0123456789abcdef", DriverPackageFakers.Version, $"{DriverPackageFakers.Version}.remove" }));
    }

    /// <summary>
    /// RN-DRIVER-007: "remover um driver só é aceito sem sessão aberta de um banco que ele atende (senão 409 `DRIVER_IN_USE`)". A
    /// sessão é de verdade, com o PostgreSQL em contêiner: o catálogo deste teste diz que o driver de teste atende o PostgreSQL. O
    /// driver embutido não se remove, com ou sem sessão.
    /// </summary>
    [Test]
    public async Task Remove_WithAnOpenSessionOfAnEngineTheDriverServes_Returns409DriverInUse_AndWorksAfterTheSessionCloses()
    {
        var settings = await PostgresSingleton.GetSettingsAsync();
        using var folder = new TemporaryFolder();
        var drivers = folder.Path;
        var catalog = DriverPackageFakers.CatalogJsonServingPostgres(Package);
        await using var server = await PackageServer.StartAsync(PackageServer.Serve(Package));

        await using (var first = await ApiHost.StartAsync(services => services.UseDriverSource(server.Address, catalog, DriverPackageFakers.Platform, drivers)))
        {
            await first.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
            await AcceptAndInstallAsync(first);
            await WaitForAsync(first, driver => StateOf(driver) == "installed");
        }

        await using var host = await ApiHost.StartAsync(services => services.UseDriverSource(server.Address, catalog, DriverPackageFakers.Platform, drivers));
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var sessionID = await host.Client.OpenSessionAsync(await host.Client.CreateConnectionAsync(settings));

        var inUse = await host.Client.DeleteAsync(DriverPath);
        var stillInstalled = await GetTestDriverAsync(host);
        var bundled = await host.Client.DeleteAsync($"{DriversPath}/{DriverPackageFakers.BundledDriverID}");
        var closed = await host.Client.DeleteAsync($"{PrismCalls.SessionsPath}/{sessionID}");
        var removed = await host.Client.DeleteAsync(DriverPath);
        var afterRemove = await GetTestDriverAsync(host);

        await AssertProblemAsync(inUse, HttpStatusCode.Conflict, "DRIVER_IN_USE");
        Assert.That(StateOf(stillInstalled), Is.EqualTo("installed"));
        Assert.That(stillInstalled.GetProperty("restartRequired").GetBoolean(), Is.False);
        await AssertProblemAsync(bundled, HttpStatusCode.Conflict, "DRIVER_NOT_INSTALLED");
        Assert.That(closed.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(removed.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(StateOf(afterRemove), Is.EqualTo("available"));
        Assert.That(afterRemove.GetProperty("restartRequired").GetBoolean(), Is.True);
    }

    /// <summary>
    /// Uma pasta de drivers que mais de uma execução da API usa no mesmo teste (o "reinício"). Declarada antes dos hosts, é descartada
    /// depois deles, passe o teste ou não.
    /// </summary>
    private sealed class TemporaryFolder : IDisposable
    {
        public string Path { get; } = Directory.CreateTempSubdirectory("prism-tests-pasta-de-drivers-").FullName;

        public void Dispose()
            => Directory.Delete(Path, recursive: true);
    }
}
