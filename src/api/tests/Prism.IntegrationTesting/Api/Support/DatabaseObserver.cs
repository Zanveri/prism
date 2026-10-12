using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.TestingCore.Extensions;
using System.Diagnostics;

namespace Prism.IntegrationTesting.Api.Support;

/// <summary>
/// Uma conexão à parte com o PostgreSQL de teste, que não passa pela API: olha o `pg_stat_activity` e arruma o que o teste precisa fora
/// dela (um papel, por exemplo). "Esta consulta está rodando" e "esta conexão acabou" são o banco dizendo, e não a API. Quem espera por
/// um estado do banco consulta, em laço, até chegar a ele: nunca um `Task.Delay` de duração chutada.
/// </summary>
internal sealed class DatabaseObserver : IAsyncDisposable
{
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(10);

    private readonly ServiceProvider _provider;
    private readonly IDatabaseConnection _connection;

    private DatabaseObserver(ServiceProvider provider, IDatabaseConnection connection)
    {
        _provider = provider;
        _connection = connection;
    }

    public static async Task<DatabaseObserver> OpenAsync(ConnectionSettings settings)
    {
        // O cofre nunca é aberto aqui: só o client do PostgreSQL é usado, e a pasta de dados nem é criada.
        var provider = new ServiceCollection().AddInfrastructure(Path.Combine(Path.GetTempPath(), "prism-tests-sem-cofre")).BuildServiceProvider();
        var opened = await provider.GetServices<IDatabaseClient>().Single(client => client.Engine == EDatabaseEngine.PostgreSql).OpenAsync(settings, CancellationToken.None);
        Assert.That(opened.IsSuccess, Is.True, opened.IsFailure ? opened.Error.Message : null);

        return new DatabaseObserver(provider, opened.Value);
    }

    public async Task ExecuteAsync(string sql)
    {
        var outcome = await _connection.ExecuteAsync(sql, CancellationToken.None);

        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);
    }

    /// <summary>A primeira célula da primeira linha.</summary>
    public async Task<long> CountAsync(string sql)
    {
        var outcome = await _connection.ExecuteAsync(sql, CancellationToken.None);
        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);

        return long.Parse(outcome.Value.Page!.Rows[0][0]!);
    }

    /// <summary>Espera o banco chegar ao número esperado e falha com o último valor visto se ele não chegar no prazo.</summary>
    public async Task WaitForCountAsync(string sql, long expected, string because)
    {
        var watch = Stopwatch.StartNew();
        long count;

        while ((count = await CountAsync(sql)) != expected && watch.Elapsed < Patience)
            await Task.Delay(25);

        Assert.That(count, Is.EqualTo(expected), because);
    }

    /// <summary>
    /// Uma consulta com esta marca (um alias, só letras e dígitos) está rodando agora em outra conexão. `queryPrefix` separa duas conexões que
    /// rodam o mesmo texto: o banco já executa um comando inteiro enquanto o cliente lê só as primeiras linhas, e a contagem de um comando
    /// (`SELECT COUNT(*) FROM (`...) roda em outra conexão, com a mesma marca dentro.
    /// </summary>
    public Task WaitForRunningAsync(string marker, string queryPrefix = "")
        => WaitForCountAsync($"SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active' AND query LIKE '{queryPrefix}%{marker}%' AND pid <> pg_backend_pid()", 1, $"O banco não mostrou a consulta {marker} em andamento.");

    public async ValueTask DisposeAsync()
    {
        await _connection.DisposeAsync();
        await _provider.DisposeAsync();
    }
}
