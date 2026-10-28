using Prism.Infrastructure.Plugins.Clients;
using Prism.Infrastructure.Plugins.Models;
using Serilog.Core;
using System.Diagnostics;
using System.Text;

namespace Prism.UnitTesting.Plugins;

public sealed class PluginSourceClientTests : IDisposable
{
    private readonly string _rootDirectory = Directory.CreateTempSubdirectory("prism-plugin-tests-").FullName;
    private readonly string _pluginsDirectory;
    private readonly PluginSourceClient _client;

    public PluginSourceClientTests()
    {
        _pluginsDirectory = Path.Combine(_rootDirectory, "installed");
        _client = new PluginSourceClient(new PluginSettings(_pluginsDirectory), Logger.None);
    }

    public void Dispose()
    {
        if (!Directory.Exists(_rootDirectory))
            return;

        foreach (var file in Directory.EnumerateFiles(_rootDirectory, "*", SearchOption.AllDirectories))
            File.SetAttributes(file, FileAttributes.Normal);

        Directory.Delete(_rootDirectory, recursive: true);
    }

    [Trait("PluginSourceClient", "InspectLocal")]
    [Fact(DisplayName = "OK inspeciona uma pasta local válida e lê o bundle principal")]
    public void InspectLocal_ValidDirectory_ReturnsManifestAndBundle()
    {
        // Arrange
        var localPlugin = CreateSamplePluginFolder("local-plugin", "sit-descriptions", "Descrições SIT", "1.0.0", "prism.ui.registerTableStructureEnricher({});");

        // Act
        var inspected = _client.InspectLocal(localPlugin);
        var bundle = _client.ReadBundle("sit-descriptions", "local", localPlugin);

        // Assert
        Assert.True(inspected.IsSuccess);
        Assert.Equal("sit-descriptions", inspected.Value.ID);
        Assert.Equal("Descrições SIT", inspected.Value.Name);
        Assert.Equal("1.0.0", inspected.Value.Version);
        Assert.Equal(["informix"], inspected.Value.Engines);
        Assert.True(bundle.IsSuccess);
        Assert.Equal("prism.ui.registerTableStructureEnricher({});", bundle.Value);
    }

    [Trait("PluginSourceClient", "InspectLocal")]
    [Fact(DisplayName = "ERR recusa manifesto com tentativa de path traversal no arquivo principal")]
    public void InspectLocal_MainPathTraversal_ReturnsManifestInvalid()
    {
        // Arrange
        var localPlugin = Path.Combine(_rootDirectory, "traversal-plugin");
        Directory.CreateDirectory(localPlugin);
        File.WriteAllText(Path.Combine(_rootDirectory, "outside.js"), "console.log('outside');", Encoding.UTF8);
        File.WriteAllText(
            Path.Combine(localPlugin, "manifest.json"),
            """{"id":"bad-plugin","name":"Bad","version":"1.0.0","main":"../outside.js"}""",
            Encoding.UTF8);

        // Act
        var inspected = _client.InspectLocal(localPlugin);

        // Assert
        Assert.True(inspected.IsFailure);
        Assert.Equal(EPluginFailure.ManifestInvalid, inspected.Error.Kind);
    }

    [Trait("PluginSourceClient", "IsAllowedGitUrl")]
    [Theory(DisplayName = "Valida URLs Git permitidas e recusa opções de linha de comando ou esquemas inválidos")]
    [InlineData("https://gitlab.empresa.local/equipe/sit-descriptions.git", true)]
    [InlineData("http://git.interno/plugin.git", true)]
    [InlineData("ssh://git@gitlab.empresa.local/equipe/sit-descriptions.git", true)]
    [InlineData("git@gitlab.empresa.local:equipe/sit-descriptions.git", true)]
    [InlineData("--upload-pack=touch", false)]
    [InlineData("-u", false)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("https://gitlab.empresa.local/com espaco.git", false)]
    public void IsAllowedGitUrl_ValidatesExpectedFormats(string url, bool expected)
        => Assert.Equal(expected, PluginSourceClient.IsAllowedGitUrl(url));

    [Trait("PluginSourceClient", "CloneAndPullGit")]
    [Fact(DisplayName = "OK clona um repositório Git, atualiza via pull e remove a pasta instalada")]
    public async Task CloneAndPullGit_ValidGitRepository_ClonesUpdatesAndDeletes()
    {
        // Arrange
        var originRepo = CreateSamplePluginFolder("origin-repo", "sit-descriptions", "Descrições SIT", "1.0.0", "console.log('v1');");
        RunGit(originRepo, "init");
        RunGit(originRepo, "config", "user.email", "dev@prism.local");
        RunGit(originRepo, "config", "user.name", "Prism Test");
        RunGit(originRepo, "add", ".");
        RunGit(originRepo, "commit", "-m", "v1");

        var gitFileUri = new Uri(originRepo).AbsoluteUri;

        // Act — Clone v1
        var cloned = await _client.CloneFromGitAsync(gitFileUri, _ => false, CancellationToken.None);
        var bundleV1 = _client.ReadBundle("sit-descriptions", "git", gitFileUri);

        // Atualiza o repositório de origem para v1.1.0
        File.WriteAllText(
            Path.Combine(originRepo, "manifest.json"),
            """{"id":"sit-descriptions","name":"Descrições SIT","version":"1.1.0","main":"main.js","engines":["informix"]}""",
            Encoding.UTF8);
        File.WriteAllText(Path.Combine(originRepo, "main.js"), "console.log('v2');", Encoding.UTF8);
        RunGit(originRepo, "add", ".");
        RunGit(originRepo, "commit", "-m", "v2");

        // Act — Pull v1.1.0
        var pulled = await _client.PullGitAsync("sit-descriptions", CancellationToken.None);
        var bundleV2 = _client.ReadBundle("sit-descriptions", "git", gitFileUri);

        // Act — Delete
        _client.DeleteInstalledDirectory("sit-descriptions");

        // Assert
        Assert.True(cloned.IsSuccess, cloned.IsFailure ? cloned.Error.Message : string.Empty);
        Assert.Equal("1.0.0", cloned.Value.Version);
        Assert.True(bundleV1.IsSuccess);
        Assert.Equal("console.log('v1');", bundleV1.Value);

        Assert.True(pulled.IsSuccess, pulled.IsFailure ? pulled.Error.Message : string.Empty);
        Assert.Equal("1.1.0", pulled.Value.Version);
        Assert.True(bundleV2.IsSuccess);
        Assert.Equal("console.log('v2');", bundleV2.Value);

        Assert.False(Directory.Exists(Path.Combine(_pluginsDirectory, "sit-descriptions")));
    }

    private string CreateSamplePluginFolder(string folderName, string id, string name, string version, string code)
    {
        var path = Path.Combine(_rootDirectory, folderName);
        Directory.CreateDirectory(path);
        File.WriteAllText(
            Path.Combine(path, "manifest.json"),
            $$"""{"id":"{{id}}","name":"{{name}}","version":"{{version}}","description":"Plugin de teste","author":"Empresa","main":"main.js","engines":["informix"]}""",
            Encoding.UTF8);
        File.WriteAllText(Path.Combine(path, "main.js"), code, Encoding.UTF8);
        return path;
    }

    private static void RunGit(string workingDirectory, params string[] args)
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
}
