using Prism.TestingCore.Fakers.Users;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class PluginsTests
{
    private const string PluginsPath = "/api/user/plugins";
    private const string InstallPath = "/api/user/plugins/install";
    private const string BundlesPath = "/api/user/plugins/bundles";
    private const string ConsentPath = "/api/user/plugins/consent";

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.That(response.StatusCode, Is.EqualTo(status), body.ToString());
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));
        Assert.That(body.GetProperty("detail").GetString(), Is.Not.Empty);
    }

    [Test]
    public async Task Routes_NeedTheTokenAndTheUnlockedVault()
    {
        await using var host = await ApiHost.StartAsync();

        var withoutToken = await host.ClientWithoutToken.GetAsync(PluginsPath);
        var list = await host.Client.GetAsync(PluginsPath);
        var bundles = await host.Client.GetAsync(BundlesPath);
        var consent = await host.Client.PutAsJsonAsync(ConsentPath, new { consented = true });
        var install = await host.Client.PostAsJsonAsync(InstallPath, new { sourceKind = "local", source = "C:\\temp" });

        await AssertProblemAsync(withoutToken, HttpStatusCode.Unauthorized, "AUTHENTICATION_REQUIRED");
        await AssertProblemAsync(list, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(bundles, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(consent, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(install, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    [Test]
    public async Task InstallAndManageLocalPlugin_RequiresExplicitConsent_ServesBundles_AndRevokingConsentDisablesAll()
    {
        using var folder = new TemporaryPluginFolder();
        var pluginDirectory = folder.CreatePlugin("sit-descriptions", "Descrições SIT", "1.0.0", "prism.ui.registerTableStructureEnricher({});");

        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        // 1. Estado inicial: modo restrito ativo (consented = false)
        var initial = await (await host.Client.GetAsync(PluginsPath)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(initial.GetProperty("consented").GetBoolean(), Is.False);
        Assert.That(initial.GetProperty("consentedAt").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(initial.GetProperty("items").GetArrayLength(), Is.Zero);

        // 2. Sem consentimento explícito, instalar recusa com 422 PLUGIN_CONSENT_REQUIRED
        var installWithoutConsent = await host.Client.PostAsJsonAsync(InstallPath, new { sourceKind = "local", source = pluginDirectory });
        await AssertProblemAsync(installWithoutConsent, HttpStatusCode.UnprocessableEntity, "PLUGIN_CONSENT_REQUIRED");

        // 3. Aceita o termo de responsabilidade
        var consentedResponse = await host.Client.PutAsJsonAsync(ConsentPath, new { consented = true });
        Assert.That(consentedResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var consentedState = await consentedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(consentedState.GetProperty("consented").GetBoolean(), Is.True);
        Assert.That(consentedState.GetProperty("consentedAt").GetString(), Is.Not.Empty);

        // 4. Instala o plugin local
        var installedResponse = await host.Client.PostAsJsonAsync(InstallPath, new { sourceKind = "local", source = pluginDirectory });
        Assert.That(installedResponse.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        var installed = await installedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(installed.GetProperty("id").GetString(), Is.EqualTo("sit-descriptions"));
        Assert.That(installed.GetProperty("name").GetString(), Is.EqualTo("Descrições SIT"));
        Assert.That(installed.GetProperty("enabled").GetBoolean(), Is.True);

        // Duplicado retorna 409 PLUGIN_ALREADY_INSTALLED
        var duplicateResponse = await host.Client.PostAsJsonAsync(InstallPath, new { sourceKind = "local", source = pluginDirectory });
        await AssertProblemAsync(duplicateResponse, HttpStatusCode.Conflict, "PLUGIN_ALREADY_INSTALLED");

        // 5. Bundles retorna o código do plugin ativo
        var bundles = await (await host.Client.GetAsync(BundlesPath)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(bundles.GetArrayLength(), Is.EqualTo(1));
        Assert.That(bundles[0].GetProperty("id").GetString(), Is.EqualTo("sit-descriptions"));
        Assert.That(bundles[0].GetProperty("code").GetString(), Is.EqualTo("prism.ui.registerTableStructureEnricher({});"));

        // 6. Desativar o plugin remove-o dos bundles ativos
        var disabledResponse = await host.Client.PutAsJsonAsync($"{PluginsPath}/sit-descriptions/enabled", new { enabled = false });
        Assert.That(disabledResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var bundlesAfterDisable = await (await host.Client.GetAsync(BundlesPath)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(bundlesAfterDisable.GetArrayLength(), Is.Zero);

        // Reativar o plugin
        await host.Client.PutAsJsonAsync($"{PluginsPath}/sit-descriptions/enabled", new { enabled = true });

        // 7. Revogar o consentimento desativa todos os plugins imediatamente
        var revokedResponse = await host.Client.PutAsJsonAsync(ConsentPath, new { consented = false });
        var revokedState = await revokedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(revokedState.GetProperty("consented").GetBoolean(), Is.False);
        Assert.That(revokedState.GetProperty("items")[0].GetProperty("enabled").GetBoolean(), Is.False);

        var bundlesAfterRevoke = await (await host.Client.GetAsync(BundlesPath)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(bundlesAfterRevoke.GetArrayLength(), Is.Zero);

        // 8. Remover o plugin responde 204
        var removedResponse = await host.Client.DeleteAsync($"{PluginsPath}/sit-descriptions");
        Assert.That(removedResponse.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
    }

    [Test]
    public async Task InstallAndUpdateGitPlugin_ClonesAndPullsUsingMachineGit()
    {
        using var folder = new TemporaryPluginFolder();
        var repoDirectory = folder.CreatePlugin("git-sit-plugin", "Plugin Git", "1.0.0", "console.log('v1');");
        TemporaryPluginFolder.RunGit(repoDirectory, "init");
        TemporaryPluginFolder.RunGit(repoDirectory, "config", "user.email", "dev@prism.local");
        TemporaryPluginFolder.RunGit(repoDirectory, "config", "user.name", "Prism Test");
        TemporaryPluginFolder.RunGit(repoDirectory, "add", ".");
        TemporaryPluginFolder.RunGit(repoDirectory, "commit", "-m", "v1");

        var gitUri = new Uri(repoDirectory).AbsoluteUri;

        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        await host.Client.PutAsJsonAsync(ConsentPath, new { consented = true });

        var installedResponse = await host.Client.PostAsJsonAsync(InstallPath, new { sourceKind = "git", source = gitUri });
        Assert.That(installedResponse.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        var installed = await installedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(installed.GetProperty("version").GetString(), Is.EqualTo("1.0.0"));

        // Atualiza o repositório Git para 1.2.0
        File.WriteAllText(
            Path.Combine(repoDirectory, "manifest.json"),
            """{"id":"git-sit-plugin","name":"Plugin Git","version":"1.2.0","main":"main.js","engines":["informix"]}""",
            Encoding.UTF8);
        File.WriteAllText(Path.Combine(repoDirectory, "main.js"), "console.log('v1.2.0');", Encoding.UTF8);
        TemporaryPluginFolder.RunGit(repoDirectory, "add", ".");
        TemporaryPluginFolder.RunGit(repoDirectory, "commit", "-m", "v1.2.0");

        var updatedResponse = await host.Client.PostAsync($"{PluginsPath}/git-sit-plugin/update", null);
        Assert.That(updatedResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var updated = await updatedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(updated.GetProperty("version").GetString(), Is.EqualTo("1.2.0"));

        var removedResponse = await host.Client.DeleteAsync($"{PluginsPath}/git-sit-plugin");
        Assert.That(removedResponse.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
    }

    private sealed class TemporaryPluginFolder : IDisposable
    {
        public string RootPath { get; } = Directory.CreateTempSubdirectory("prism-api-plugins-").FullName;

        public string CreatePlugin(string id, string name, string version, string code)
        {
            var directory = Path.Combine(RootPath, id);
            Directory.CreateDirectory(directory);
            File.WriteAllText(
                Path.Combine(directory, "manifest.json"),
                $$"""{"id":"{{id}}","name":"{{name}}","version":"{{version}}","description":"Plugin de teste","author":"Empresa","main":"main.js","engines":["informix"]}""",
                Encoding.UTF8);
            File.WriteAllText(Path.Combine(directory, "main.js"), code, Encoding.UTF8);
            return directory;
        }

        public static void RunGit(string workingDirectory, params string[] args)
        {
            var startInfo = new ProcessStartInfo("git")
            {
                WorkingDirectory = workingDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            foreach (var arg in args)
                startInfo.ArgumentList.Add(arg);

            using var process = Process.Start(startInfo)!;
            process.WaitForExit();
            if (process.ExitCode != 0)
                throw new InvalidOperationException($"git {string.Join(' ', args)} falhou: {process.StandardError.ReadToEnd()}");
        }

        public void Dispose()
        {
            if (!Directory.Exists(RootPath))
                return;

            foreach (var file in Directory.EnumerateFiles(RootPath, "*", SearchOption.AllDirectories))
                File.SetAttributes(file, FileAttributes.Normal);

            Directory.Delete(RootPath, recursive: true);
        }
    }
}
