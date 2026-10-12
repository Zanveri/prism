using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using Prism.Infrastructure.Databases.Models;
using System.Security.Cryptography;
using System.Text;

namespace Prism.IntegrationTesting.Configurations;

/// <summary>
/// Um Db2 para a execução inteira, já com a carga de `Infrastructure/Databases/Seeds/db2.sql`. A imagem leva cerca de três minutos
/// para criar o banco e só sobe como contêiner privilegiado: os fixtures que o usam levam a categoria `Db2`, que a pipeline só roda
/// onde isso é aceito. A partida fica guardada como tarefa: um contêiner que não sobe devolve a mesma falha, legível, a todo fixture.
/// </summary>
public static class Db2Singleton
{
    /// <summary>A imagem pública da IBM (Db2 Community 12.1.5.0), pelo resumo com que o driver foi conferido: ela só publica a marca `latest`.</summary>
    private const string DefaultImage = "icr.io/db2_community/db2@sha256:2de8151713c261843868c5c3411b57be6ae79d99d70a5b3022337836776bfda6";

    /// <summary>
    /// Troca a imagem, para a máquina que não alcança o `icr.io` (um proxy que o recusa) e tem outra imagem do Db2 à mão, como a
    /// `ibmcom/db2` do Docker Hub (11.5). Sem a variável vale a imagem acima, que é a da pipeline; quem a usa diz em que versão rodou.
    /// </summary>
    private const string ImageVariable = "PRISM_TEST_DB2_IMAGE";

    private static readonly string Image = Environment.GetEnvironmentVariable(ImageVariable) is { Length: > 0 } image ? image : DefaultImage;

    private const int Port = 50000;
    private const string Database = "prism";
    private const string UserName = "db2inst1";
    private const string SeedPath = "/tmp/prism-seed.sql";

    /// <summary>Uma conta comum do sistema do contêiner, sem nenhuma autoridade no banco além do que é dado a todos (`PUBLIC`): o Db2 autentica pelo sistema.</summary>
    private const string ReaderName = "prismleitor";

    private static readonly Lock CreationLock = new();
    private static IContainer? _container;
    private static Task<ConnectionSettings>? _settings;
    private static string _readerPassword = string.Empty;

    /// <summary>Como conectar no contêiner: no endereço que o Testcontainers informa (<see cref="ContainerAddress"/>), com a porta mapeada.</summary>
    public static Task<ConnectionSettings> GetSettingsAsync()
    {
        lock (CreationLock)
            return _settings ??= StartAsync();
    }

    /// <summary>Como conectar com a conta comum (<see cref="ReaderName"/>), para o que só uma conta sem autoridade mostra.</summary>
    public static async Task<ConnectionSettings> GetReaderSettingsAsync()
        => (await GetSettingsAsync()) with { UserName = ReaderName, Password = _readerPassword };

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
        // A senha é sorteada a cada execução: nenhuma credencial de banco fica escrita num teste. A imagem cria o usuário do sistema
        // com ela, e as letras da frente são para ela nunca começar por dígito.
        var password = $"Pw{Convert.ToHexString(RandomNumberGenerator.GetBytes(16))}";
        var container = new ContainerBuilder(Image)
            .WithPrivileged(true)
            .WithEnvironment("LICENSE", "accept")
            .WithEnvironment("DB2INST1_PASSWORD", password)
            .WithEnvironment("DBNAME", Database)
            .WithPortBinding(Port, true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilMessageIsLogged("Setup has completed", strategy => strategy.WithTimeout(TimeSpan.FromMinutes(10))))
            .Build();
        _container = container;

        await container.StartAsync();

        // O processador de comandos do Db2 para no primeiro erro (`-s`) e sai com 4 ou mais; 2 é aviso, e a carga tem um esperado (o
        // índice já existente que a chave primária passa a usar).
        // As quebras de linha vão como as do Linux: num clone feito no Windows o arquivo chega com retorno de carro.
        await container.CopyAsync(Encoding.UTF8.GetBytes((await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Infrastructure", "Databases", "Seeds", "db2.sql"))).ReplaceLineEndings("\n")), SeedPath);
        var seeded = await container.ExecAsync(["su", "-", UserName, "-c", $"db2 -tsf {SeedPath}"]);
        if (seeded.ExitCode >= 4)
            throw new InvalidOperationException($"A carga do Db2 de teste falhou: {seeded.Stdout}{seeded.Stderr}");

        // A senha da conta comum também é sorteada, e vai pela entrada padrão do `chpasswd`, e não na linha de comando.
        _readerPassword = $"Pw{Convert.ToHexString(RandomNumberGenerator.GetBytes(12))}";
        await container.CopyAsync(Encoding.UTF8.GetBytes($"{ReaderName}:{_readerPassword}\n"), "/tmp/prism-reader");
        var reader = await container.ExecAsync(["bash", "-c", $"useradd -m {ReaderName} && chpasswd < /tmp/prism-reader && rm /tmp/prism-reader"]);
        if (reader.ExitCode != 0)
            throw new InvalidOperationException($"A conta comum do Db2 de teste não foi criada: {reader.Stdout}{reader.Stderr}");

        return new ConnectionSettings(EDatabaseEngine.Db2, ContainerAddress.Of(container), container.GetMappedPublicPort(Port), Database, UserName, password);
    }
}
