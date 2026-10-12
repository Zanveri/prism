using Prism.Infrastructure.Databases.Models;
using System.Security.Cryptography;
using Testcontainers.PostgreSql;

namespace Prism.IntegrationTesting.Configurations;

/// <summary>
/// Um PostgreSQL para a execução inteira, já com a carga de `Infrastructure/Databases/Seeds/postgres.sql`: subir o contêiner custa
/// segundos, e os fixtures dos drivers, do registro de sessões e das rotas usam o mesmo. A partida fica guardada como tarefa: um
/// contêiner que não sobe devolve a mesma falha, legível, a todo fixture, no lugar de um fixture pendurado.
/// </summary>
public static class PostgresSingleton
{
    /// <summary>A mesma linha do PostgreSQL que os projetos da casa usam em produção; a imagem já está nas máquinas de desenvolvimento.</summary>
    private const string Image = "postgres:18-alpine";

    private const string Database = "prism";
    private const string UserName = "prism";

    private static readonly Lock CreationLock = new();
    private static PostgreSqlContainer? _container;
    private static Task<ConnectionSettings>? _settings;

    /// <summary>Como conectar no contêiner: no endereço que o Testcontainers informa (<see cref="ContainerAddress"/>), com a porta mapeada.</summary>
    public static Task<ConnectionSettings> GetSettingsAsync()
    {
        lock (CreationLock)
            return _settings ??= StartAsync();
    }

    public static async Task DisposeAsync()
    {
        PostgreSqlContainer? container;

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
        // A senha é sorteada a cada execução: nenhuma credencial de banco fica escrita num teste.
        var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        var container = new PostgreSqlBuilder(Image).WithDatabase(Database).WithUsername(UserName).WithPassword(password).Build();
        _container = container;

        await container.StartAsync();

        // O psql sai com código zero mesmo quando um comando do script falha, e a falha só aparece no erro padrão: uma carga pela metade
        // viraria uma parede de testes quebrados sem relação com a causa.
        var seeded = await container.ExecScriptAsync(await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Infrastructure", "Databases", "Seeds", "postgres.sql")));
        if (seeded.ExitCode != 0 || seeded.Stderr.Contains("ERROR", StringComparison.Ordinal))
            throw new InvalidOperationException($"A carga do PostgreSQL de teste falhou: {seeded.Stderr}");

        return new ConnectionSettings(EDatabaseEngine.PostgreSql, ContainerAddress.Of(container), container.GetMappedPublicPort(PostgreSqlBuilder.PostgreSqlPort), Database, UserName, password);
    }
}
