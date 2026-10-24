using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using Prism.Infrastructure.Databases.Models;
using System.Security.Cryptography;
using System.Text;

namespace Prism.IntegrationTesting.Configurations;

/// <summary>
/// Um Informix para a execução inteira, já com a carga de `Infrastructure/Databases/Seeds/informix.sql`: o banco `prism`, com log, e
/// o `prism_sem_log`, sem. O driver fala com ele pela porta DRDA (9089), que a imagem já sobe ligada. A partida fica guardada como
/// tarefa: um contêiner que não sobe devolve a mesma falha, legível, a todo fixture.
/// </summary>
public static class InformixSingleton
{
    /// <summary>O banco sem log que a carga cria, além do `prism`.</summary>
    public const string UnloggedDatabase = "prism_sem_log";

    /// <summary>
    /// Um banco em UTF-8 (`en_us.utf8`), vazio, além do `prism`, que é Latin-1 (`en_US.819`, o da imagem). Serve ao texto que o catálogo
    /// guarda em pedaços de tamanho fixo contados em bytes (RN-CAT-006): só com caractere de mais de um byte o pedaço pode cortar um.
    /// </summary>
    public const string Utf8Database = "prism_utf8";

    private const string Utf8SeedPath = "/tmp/prism-seed-utf8.sql";

    /// <summary>A imagem pública da IBM (Informix 14.10.FC7W1DE), pelo resumo com que o driver foi conferido.</summary>
    private const string Image = "ibmcom/informix-developer-database@sha256:069febf6b08d72866ad8d7b06c1caf190df423f7b407de1ce18e3d89a8f8803d";

    private const int DrdaPort = 9089;
    private const string Database = "prism";
    private const string UserName = "informix";
    private const string SeedPath = "/tmp/prism-seed.sql";
    private const string SbspacePath = "/opt/ibm/data/spaces/sbspace.000";

    /// <summary>O ambiente do servidor, que o `exec` não tem: vem do arquivo da imagem.</summary>
    private const string ServerEnvironment = ". /usr/local/bin/informix_inf.env;";

    private static readonly Lock CreationLock = new();
    private static IContainer? _container;
    private static Task<ConnectionSettings>? _settings;

    /// <summary>Como conectar no contêiner: no endereço que o Testcontainers informa (<see cref="ContainerAddress"/>), com a porta mapeada.</summary>
    public static Task<ConnectionSettings> GetSettingsAsync()
    {
        lock (CreationLock)
            return _settings ??= StartAsync();
    }

    /// <summary>Como conectar no mesmo contêiner, mas no banco sem log (<see cref="UnloggedDatabase"/>): sem transação, o `Commit manual` não existe e cada comando grava sozinho (RN-TX-013).</summary>
    public static async Task<ConnectionSettings> GetUnloggedSettingsAsync()
        => (await GetSettingsAsync()) with { Database = UnloggedDatabase };

    public static async Task DisposeAsync()
    {
        IContainer? container;

        lock (CreationLock)
        {
            container = _container;
            _container = null;
            _settings = null;
        }

        if (container is not null)
            await container.DisposeAsync();
    }

    private static async Task<ConnectionSettings> StartAsync()
    {
        // A senha é sorteada a cada execução: nenhuma credencial de banco fica escrita num teste. A imagem a aceita em
        // INFORMIX_PASSWORD, no lugar da padrão dela.
        var password = $"Pw{Convert.ToHexString(RandomNumberGenerator.GetBytes(16))}";
        var container = new ContainerBuilder(Image)
            .WithEnvironment("LICENSE", "accept")
            .WithEnvironment("INFORMIX_PASSWORD", password)
            .WithPortBinding(DrdaPort, true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilMessageIsLogged("Informix container login information", strategy => strategy.WithTimeout(TimeSpan.FromMinutes(5))))
            .Build();
        _container = container;

        await container.StartAsync();

        // O `dbaccess` não está no caminho de um `exec`: o ambiente do servidor vem do arquivo da imagem. DELIMIDENT faz das aspas
        // duplas identificador, como na sessão do driver, e DBACCNOIGN faz o `dbaccess` parar e sair com erro no primeiro comando
        // que o banco recusa.
        // As quebras de linha vão como as do Linux: num clone feito no Windows o arquivo chega com retorno de carro.
        await container.CopyAsync(Encoding.UTF8.GetBytes((await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Infrastructure", "Databases", "Seeds", "informix.sql"))).ReplaceLineEndings("\n")), SeedPath);
        var seeded = await container.ExecAsync(["bash", "-c", $". /usr/local/bin/informix_inf.env; export DELIMIDENT=y DBACCNOIGN=1; dbaccess - {SeedPath}"]);
        if (seeded.ExitCode != 0)
            throw new InvalidOperationException($"A carga do Informix de teste falhou: {seeded.Stdout}{seeded.Stderr}");

        // A localidade do banco é a do ambiente de quem o cria, e não uma opção do comando.
        await container.CopyAsync(Encoding.UTF8.GetBytes($"CREATE DATABASE {Utf8Database} WITH LOG;\n"), Utf8SeedPath);
        var utf8 = await container.ExecAsync(["bash", "-c", $". /usr/local/bin/informix_inf.env; export DELIMIDENT=y DBACCNOIGN=1 DB_LOCALE=en_us.utf8 CLIENT_LOCALE=en_us.utf8; dbaccess - {Utf8SeedPath}"]);
        if (utf8.ExitCode != 0)
            throw new InvalidOperationException($"O banco em UTF-8 do Informix de teste não foi criado: {utf8.Stdout}{utf8.Stderr}");

        // RN-SQL-017: o `CLOB` precisa do espaço de objetos grandes que a configuração da imagem nomeia (`SBSPACENAME sbspace`) e a imagem
        // não cria. Um segundo e meio, uma vez por execução.
        var sbspace = await container.ExecAsync(["bash", "-c", $"{ServerEnvironment} touch {SbspacePath} && chmod 660 {SbspacePath} && onspaces -c -S sbspace -p {SbspacePath} -o 0 -s 20000"]);
        if (sbspace.ExitCode != 0)
            throw new InvalidOperationException($"O espaço de objetos grandes do Informix de teste não foi criado: {sbspace.Stdout}{sbspace.Stderr}");

        return new ConnectionSettings(EDatabaseEngine.Informix, ContainerAddress.Of(container), container.GetMappedPublicPort(DrdaPort), Database, UserName, password);
    }

    /// <summary>
    /// Roda um script no `dbaccess` do contêiner, no banco `prism`, com os arquivos que ele lê (`LOAD`, `FILETOCLOB`) já copiados para
    /// lá. É como o teste grava o que um comando só pelo driver não grava (o `TEXT`, que só entra por parâmetro ou pelo `LOAD`, e o
    /// `CLOB` acima dos 32 KB de um literal), sem passar pelo driver que está sendo testado.
    /// </summary>
    public static async Task RunScriptAsync(string script, IReadOnlyDictionary<string, byte[]> files)
    {
        await GetSettingsAsync();
        var container = _container!;
        var path = $"/tmp/prism-script-{Guid.NewGuid():N}.sql";

        foreach (var (file, content) in files)
            await container.CopyAsync(content, file);

        await container.CopyAsync(Encoding.UTF8.GetBytes($"DATABASE {Database};\n{script.ReplaceLineEndings("\n")}\n"), path);
        var ran = await container.ExecAsync(["bash", "-c", $"{ServerEnvironment} export DELIMIDENT=y DBACCNOIGN=1; dbaccess - {path}"]);
        if (ran.ExitCode != 0)
            throw new InvalidOperationException($"O script no Informix de teste falhou: {ran.Stdout}{ran.Stderr}");
    }
}
