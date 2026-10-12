using System.Diagnostics;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// RN-DRIVER-001 e RN-ABERTO-001: o pacote do Prism não leva driver proprietário. A API é publicada de verdade (`dotnet publish`, como
/// a pipeline faz, para as quatro plataformas da RN-ABERTO-006) e a pasta publicada não pode ter nenhum arquivo do driver da IBM: nem
/// o assembly gerenciado, nem a árvore nativa `clidriver`, nem o executável de teste do pacote, nem os arquivos de licença dele. O
/// driver continua referenciado, só para compilar; este teste é o que acusa a referência que voltar a copiar alguma coisa.
///
/// A publicação é feita numa cópia dos fontes numa pasta temporária, para não mexer no `obj` da árvore de quem roda os testes. São
/// quatro publicações completas, alguns minutos ao todo: `--filter "TestCategory!=Publish"` as deixa de fora.
/// </summary>
[TestFixture]
[Category("Publish")]
[NonParallelizable]
public sealed class PublishTests
{
    /// <summary>O que o pacote do driver punha na saída: a árvore nativa, o assembly, o `TestConn` de `tools/` e as licenças.</summary>
    private static readonly string[] IbmFilePatterns = ["clidriver", "IBM.Data.Db2*", "*db2*", "TestConn*", "Lic_en*", "REDIST*"];

    /// <summary>O que a publicação da API precisa dos fontes: os quatro projetos e os dois arquivos da raiz que valem para todos.</summary>
    private static readonly string[] Sources = ["Prism.Api", "Prism.Application", "Prism.Core", "Prism.Infrastructure", "Directory.Build.props", "nuget.config"];

    /// <summary>O `dotnet test` deixa no ambiente o MSBuild dele; o `dotnet publish` filho usa o próprio.</summary>
    private static readonly string[] InheritedBuildVariables = ["MSBuildSDKsPath", "MSBuildExtensionsPath", "MSBUILD_EXE_PATH", "MSBuildLoadMicrosoftTargetsReadOnly"];

    private string _copy = null!;

    [OneTimeSetUp]
    public void CopySources()
    {
        var api = new DirectoryInfo(AppContext.BaseDirectory);
        while (api is not null && !File.Exists(Path.Combine(api.FullName, "Prism.slnx")))
            api = api.Parent;

        Assert.That(api, Is.Not.Null, "os testes rodam de dentro da árvore dos fontes: a pasta com o Prism.slnx tem de estar acima da de saída");

        _copy = Directory.CreateTempSubdirectory("prism-tests-publish-").FullName;

        foreach (var source in Sources)
            Copy(Path.Combine(api!.FullName, source), Path.Combine(_copy, source));
    }

    [OneTimeTearDown]
    public void DeleteCopy()
        => Directory.Delete(_copy, recursive: true);

    [TestCase("win-x64")]
    [TestCase("linux-x64")]
    [TestCase("osx-x64")]
    [TestCase("osx-arm64")]
    public async Task Publish_CarriesNoFileOfTheIbmDriver(string runtime)
    {
        var output = Path.Combine(_copy, "publicado", runtime);

        var (exitCode, log) = await RunDotnetAsync("publish", "Prism.Api", "-c", "Release", "-r", runtime, "--self-contained", "true", "-p:RestoreLockedMode=true", "--disable-build-servers", "-nologo", "-o", output);

        Assert.That(exitCode, Is.Zero, log);
        Assert.That(File.Exists(Path.Combine(output, "Prism.Api.dll")), Is.True, "a API foi publicada");
        Assert.That(File.Exists(Path.Combine(output, "Npgsql.dll")), Is.True, "o driver do PostgreSQL, de licença permissiva, vai no pacote");

        var ibmFiles = IbmFilePatterns.SelectMany(pattern => Directory.EnumerateFileSystemEntries(output, pattern, new EnumerationOptions { RecurseSubdirectories = true, MatchCasing = MatchCasing.CaseInsensitive })).Select(path => Path.GetRelativePath(output, path)).ToArray();
        Assert.That(ibmFiles, Is.Empty, "nenhum arquivo do driver da IBM na pasta publicada");
        Assert.That(await File.ReadAllTextAsync(Path.Combine(output, "Prism.Api.deps.json")), Does.Not.Contain("IBM.Data.Db2").And.Not.Contain("Net.IBM").And.Not.Contain("clidriver"), "o deps.json não pode citar o pacote da IBM: um arquivo listado e ausente impediria a API de subir");
        await TestContext.Out.WriteLineAsync($"{runtime}: {Directory.EnumerateFiles(output, "*", SearchOption.AllDirectories).Count()} arquivos, {Directory.EnumerateFiles(output, "*", SearchOption.AllDirectories).Sum(file => new FileInfo(file).Length)} bytes");
    }

    private async Task<(int ExitCode, string Log)> RunDotnetAsync(params string[] arguments)
    {
        var start = new ProcessStartInfo("dotnet") { WorkingDirectory = _copy, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };

        foreach (var argument in arguments)
            start.ArgumentList.Add(argument);

        foreach (var variable in InheritedBuildVariables)
            start.Environment.Remove(variable);

        using var process = Process.Start(start)!;
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();

        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(10));
        await process.WaitForExitAsync(timeout.Token);

        return (process.ExitCode, $"{await output}{await error}");
    }

    /// <summary>Copia um arquivo ou uma pasta de fontes, sem o que o build deixa (`bin` e `obj`).</summary>
    private static void Copy(string source, string target)
    {
        if (File.Exists(source))
        {
            File.Copy(source, target);

            return;
        }

        Directory.CreateDirectory(target);

        foreach (var file in Directory.EnumerateFiles(source))
            File.Copy(file, Path.Combine(target, Path.GetFileName(file)));

        foreach (var folder in Directory.EnumerateDirectories(source).Where(folder => Path.GetFileName(folder) is not ("bin" or "obj")))
            Copy(folder, Path.Combine(target, Path.GetFileName(folder)));
    }
}
