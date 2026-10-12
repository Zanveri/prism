using CSharpFunctionalExtensions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;
using Prism.IntegrationTesting.Configurations;
using Prism.Infrastructure;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Extensions;
using System.Diagnostics;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// O registro de sessões (`IDatabaseSessionService`) com o driver do PostgreSQL, contra o banco de verdade. Cada teste tem o próprio
/// contêiner de injeção — o registro, o cofre e o relógio falso dele —, montado pelo `AddInfrastructure` como na API. Uma conexão à
/// parte, a do observador, olha o `pg_stat_activity`: "não ficou sessão" é o banco dizendo que não há conexão, não o registro.
/// </summary>
[TestFixture]
[Category("Databases")]
public sealed class DatabaseSessionServiceTests
{
    private const string PedidoQuery = "SELECT numero, observacao FROM loja.pedido ORDER BY numero";
    private const string SlowQuery = "SELECT pg_sleep(30)";

    /// <summary>400 linhas, com divisão por zero na linha 300: a primeira página sai inteira, e o erro fica no fim do que o banco já mandou.</summary>
    private const string ErrorAtRow300Query = "SELECT 1 / (CASE WHEN numero = 300 THEN 0 ELSE 1 END) AS valor FROM generate_series(1, 400) AS numero";

    /// <summary>Devolve as primeiras páginas na hora e só demora da linha 1001 em diante: é rápida de executar e de paginar, e lenta de contar.</summary>
    private const string SlowToCountQuery = "SELECT numero, CASE WHEN numero > 1000 THEN pg_sleep(30) END AS espera FROM generate_series(1, 1001) AS numero";

    /// <summary>20.000 linhas largas: não cabem nos buffers da rede, e o banco fica no meio do comando depois da primeira página.</summary>
    private const string LargeReadQuery = "SELECT pedido.numero, repeat('x', 500) AS peso FROM loja.pedido CROSS JOIN generate_series(1, 20) AS copia";

    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(10);

    private ConnectionSettings _settings = null!;
    private ServiceProvider _observerProvider = null!;
    private IDatabaseConnection _observer = null!;

    private string _dataDirectory = null!;
    private FakeTimeProvider _clock = null!;
    private ServiceProvider _provider = null!;
    private IDatabaseSessionService _service = null!;
    private IVaultService _vault = null!;

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        _settings = await PostgresSingleton.GetSettingsAsync();
        _observerProvider = new ServiceCollection().AddInfrastructure(Path.Combine(Path.GetTempPath(), "prism-tests-sem-cofre")).BuildServiceProvider();

        var opened = await _observerProvider.GetServices<IDatabaseClient>().Single(client => client.Engine == EDatabaseEngine.PostgreSql).OpenAsync(_settings, CancellationToken.None);
        Assert.That(opened.IsSuccess, Is.True, opened.IsFailure ? opened.Error.Message : null);
        _observer = opened.Value;
    }

    [OneTimeTearDown]
    public async Task StopAsync()
    {
        await _observer.DisposeAsync();
        await _observerProvider.DisposeAsync();
    }

    [SetUp]
    public void CreateHost()
    {
        _dataDirectory = Directory.CreateTempSubdirectory("prism-sessions-").FullName;
        _clock = new FakeTimeProvider();
        _provider = BuildProvider();
        _service = _provider.GetRequiredService<IDatabaseSessionService>();
        _vault = _provider.GetRequiredService<IVaultService>();
    }

    private ServiceProvider BuildProvider()
    {
        var services = new ServiceCollection();
        services.AddInfrastructure(_dataDirectory);
        services.AddSingleton<TimeProvider>(_clock);

        // O Argon2id pequeno dos testes: a corrida com o fechamento do cofre abre o cofre dezenas de vezes.
        services.Configure<VaultOptions>(vault =>
        {
            vault.MemoryKiB = 8192;
            vault.Iterations = 1;
            vault.Parallelism = 1;
        });

        return services.BuildServiceProvider();
    }

    /// <summary>Descartar o contêiner fecha as sessões, como o desligamento da API (RN-SESSAO-004); o teste seguinte começa sem conexão de ninguém.</summary>
    [TearDown]
    public async Task DisposeHost()
    {
        await _provider.DisposeAsync();
        Directory.Delete(_dataDirectory, recursive: true);
        await WaitForConnectionsAsync(0);
    }

    private async Task<long> ObserveAsync(string sql)
    {
        var outcome = await _observer.ExecuteAsync(sql, CancellationToken.None);
        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);

        return long.Parse(outcome.Value.Page!.Rows[0][0]!);
    }

    /// <summary>As conexões de clientes no banco, fora a do observador. O `backend_type` deixa de fora o autovacuum, que também se conecta.</summary>
    private Task<long> CountConnectionsAsync()
        => ObserveAsync("SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()");

    private Task<long> CountRunningSleepsAsync()
        => ObserveAsync("SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active' AND query LIKE 'SELECT pg_sleep%' AND pid <> pg_backend_pid()");

    /// <summary>O banco leva alguns milissegundos para tirar do `pg_stat_activity` a conexão que o cliente fechou.</summary>
    private async Task WaitForConnectionsAsync(long expected)
    {
        var watch = Stopwatch.StartNew();
        long connections;

        while ((connections = await CountConnectionsAsync()) != expected && watch.Elapsed < Patience)
            await Task.Delay(25);

        Assert.That(connections, Is.EqualTo(expected));
    }

    private async Task WaitForRunningSleepAsync()
    {
        var watch = Stopwatch.StartNew();
        long sleeps;

        while ((sleeps = await CountRunningSleepsAsync()) != 1 && watch.Elapsed < Patience)
            await Task.Delay(25);

        Assert.That(sleeps, Is.EqualTo(1));
    }

    /// <summary>Abre a sessão, lê a primeira página da consulta lenta de contar e dispara a contagem; volta quando o banco já a mostra rodando.</summary>
    private async Task<(DatabaseSessionInfo Session, Task<Result<long, DatabaseFailure>> Counting)> StartSlowCountAsync()
    {
        var session = await OpenSessionAsync();
        await ExecutePageAsync(session.ID, SlowToCountQuery);
        var counting = _service.CountAsync(session.ID, CancellationToken.None);

        var watch = Stopwatch.StartNew();
        long counts;
        while ((counts = await ObserveAsync("SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active' AND query LIKE 'SELECT COUNT(*) FROM (%' AND pid <> pg_backend_pid()")) != 1 && watch.Elapsed < Patience)
            await Task.Delay(25);

        Assert.That(counts, Is.EqualTo(1));

        return (session, counting);
    }

    private async Task<DatabaseSessionInfo> OpenSessionAsync(Guid? connectionID = null)
    {
        var opened = await _service.OpenAsync(connectionID ?? Guid.NewGuid(), _settings, _vault.Generation, CancellationToken.None);
        Assert.That(opened.IsSuccess, Is.True, opened.IsFailure ? opened.Error.Message : null);

        return opened.Value;
    }

    private async Task<QueryPage> ExecutePageAsync(Guid sessionID, string sql)
    {
        var outcome = await _service.ExecuteAsync(sessionID, sql, CancellationToken.None);
        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);

        return outcome.Value.Page!;
    }

    /// <summary>Cria o usuário e deixa o cofre dele aberto: só um cofre aberto dispara `Locked` ao fechar.</summary>
    private async Task<(string UserName, string Password)> CreateVaultAsync(IVaultService? vault = null)
    {
        var userName = $"teste{Guid.NewGuid():N}"[..20];
        var password = Guid.NewGuid().ToString("N");
        var created = await (vault ?? _vault).CreateAsync(userName, password, CancellationToken.None);
        Assert.That(created.IsSuccess, Is.True);

        return (userName, password);
    }

    [Test]
    public async Task Open_ThenClose()
    {
        var connectionID = Guid.NewGuid();

        var session = await OpenSessionAsync(connectionID);
        var connectionsWhileOpen = await CountConnectionsAsync();
        var closed = await _service.CloseAsync(session.ID);
        var afterClose = await _service.GetSchemasAsync(session.ID, CancellationToken.None);

        Assert.That(session.ID, Is.Not.EqualTo(Guid.Empty));
        Assert.That(session.ConnectionID, Is.EqualTo(connectionID));
        Assert.That(session.Engine, Is.EqualTo(EDatabaseEngine.PostgreSql));
        Assert.That(session.Database, Is.EqualTo(_settings.Database));
        Assert.That(session.ServerVersion, Does.StartWith("18."));
        Assert.That(connectionsWhileOpen, Is.EqualTo(1));
        Assert.That(closed.IsSuccess, Is.True);
        Assert.That(afterClose.IsFailure, Is.True);
        Assert.That(afterClose.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionNotFound));
        await WaitForConnectionsAsync(0);
    }

    [Test]
    public async Task Close_Unknown_ReturnsSessionNotFound()
    {
        var closed = await _service.CloseAsync(Guid.NewGuid());

        Assert.That(closed.IsFailure, Is.True);
        Assert.That(closed.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionNotFound));
    }

    [Test]
    public async Task EveryOperation_OnUnknownSession_ReturnsSessionNotFound()
    {
        var unknown = Guid.NewGuid();

        var failures = new[]
        {
            (await _service.GetSchemasAsync(unknown, CancellationToken.None)).Error,
            (await _service.GetObjectsAsync(unknown, "loja", "tables", CancellationToken.None)).Error,
            (await _service.GetColumnsAsync(unknown, "loja", "pedido", CancellationToken.None)).Error,
            (await _service.GetIndexesAsync(unknown, "loja", "pedido", CancellationToken.None)).Error,
            (await _service.GetForeignKeysAsync(unknown, "loja", "pedido", CancellationToken.None)).Error,
            (await _service.ExecuteAsync(unknown, "SELECT 1", CancellationToken.None)).Error,
            (await _service.FetchNextAsync(unknown, CancellationToken.None)).Error,
            (await _service.CountAsync(unknown, CancellationToken.None)).Error,
            _service.Cancel(unknown).Error
        };

        Assert.That(failures.Select(failure => failure.Kind), Is.All.EqualTo(EDatabaseFailure.SessionNotFound));
    }

    [Test]
    public async Task Open_ForEngineWithoutDriver_ReturnsConnectionFailed()
    {
        var opened = await _service.OpenAsync(Guid.NewGuid(), _settings with { Engine = (EDatabaseEngine)99 }, _vault.Generation, CancellationToken.None);

        Assert.That(opened.IsFailure, Is.True);
        Assert.That(opened.Error.Kind, Is.EqualTo(EDatabaseFailure.ConnectionFailed));
    }

    /// <summary>RN-SESSAO-003: a mensagem é a do banco.</summary>
    [Test]
    public async Task Open_WithWrongPassword_ReturnsConnectionFailed_AndLeavesNoSession()
    {
        var opened = await _service.OpenAsync(Guid.NewGuid(), _settings with { Password = "senha-errada" }, _vault.Generation, CancellationToken.None);

        Assert.That(opened.IsFailure, Is.True);
        Assert.That(opened.Error.Kind, Is.EqualTo(EDatabaseFailure.ConnectionFailed));
        Assert.That(opened.Error.Message, Does.Contain("password authentication failed"));
        await WaitForConnectionsAsync(0);
    }

    /// <summary>A sessão que caiu no meio sai do registro: a tela recebe o erro do banco e, na execução seguinte, abre outra (seção 7 da especificação).</summary>
    [Test]
    public async Task Execute_AfterTheConnectionIsKilled_ReturnsExecutionFailed_AndRemovesTheSession()
    {
        var session = await OpenSessionAsync();
        var pid = (await ExecutePageAsync(session.ID, "SELECT pg_backend_pid()")).Rows[0][0];
        await ObserveAsync($"SELECT COUNT(*) FROM (SELECT pg_terminate_backend({pid})) AS derrubada");
        await WaitForConnectionsAsync(0);

        var afterKill = await _service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);
        var next = await _service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);

        Assert.That(afterKill.IsFailure, Is.True);
        Assert.That(afterKill.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(afterKill.Error.Message, Is.Not.Empty);
        Assert.That(next.IsFailure, Is.True);
        Assert.That(next.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionNotFound));
    }

    /// <summary>Um erro do banco que não derruba a conexão não tira a sessão do registro.</summary>
    [Test]
    public async Task Execute_SqlError_KeepsTheSession()
    {
        var session = await OpenSessionAsync();

        var failed = await _service.ExecuteAsync(session.ID, "SELEC 1", CancellationToken.None);
        var next = await _service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);

        Assert.That(failed.IsFailure, Is.True);
        Assert.That(failed.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(failed.Error.SqlState, Is.EqualTo("42601"));
        Assert.That(next.IsSuccess, Is.True);
    }

    /// <summary>RN-SESSAO-002: executar e carregar mais não esperam a vez. O segundo comando só é disparado quando o banco já mostra o primeiro rodando.</summary>
    [Test]
    public async Task Execute_WhileAnotherRuns_ReturnsSessionBusy()
    {
        var session = await OpenSessionAsync();
        var running = _service.ExecuteAsync(session.ID, SlowQuery, CancellationToken.None);
        await WaitForRunningSleepAsync();

        var second = await _service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);
        var fetch = await _service.FetchNextAsync(session.ID, CancellationToken.None);
        var canceled = _service.Cancel(session.ID);
        var first = await running;
        var afterwards = await _service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);

        Assert.That(second.IsFailure, Is.True);
        Assert.That(second.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionBusy));
        Assert.That(fetch.IsFailure, Is.True);
        Assert.That(fetch.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionBusy));
        Assert.That(canceled.IsSuccess, Is.True);
        Assert.That(first.IsFailure, Is.True);
        Assert.That(first.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(afterwards.IsSuccess, Is.True);
    }

    /// <summary>
    /// RN-SESSAO-002: as consultas de catálogo esperam a vez na sessão, porque a árvore pede vários níveis ao mesmo tempo. As cinco são
    /// disparadas com um comando ainda rodando na sessão, e todas respondem, pela mesma conexão.
    /// </summary>
    [Test]
    public async Task Catalog_WhileAnotherCatalogRuns_WaitsItsTurn()
    {
        var session = await OpenSessionAsync();
        var running = _service.ExecuteAsync(session.ID, "SELECT pg_sleep(1)", CancellationToken.None);

        var schemas = _service.GetSchemasAsync(session.ID, CancellationToken.None);
        var tables = _service.GetObjectsAsync(session.ID, "loja", "tables", CancellationToken.None);
        var columns = _service.GetColumnsAsync(session.ID, "loja", "pedido", CancellationToken.None);
        var indexes = _service.GetIndexesAsync(session.ID, "loja", "pedido", CancellationToken.None);
        var foreignKeys = _service.GetForeignKeysAsync(session.ID, "loja", "pedido", CancellationToken.None);
        await Task.WhenAll(running, schemas, tables, columns, indexes, foreignKeys);

        Assert.That((await running).IsSuccess, Is.True);
        Assert.That((await schemas).Value.Select(schema => (schema.Name, schema.IsSystem)), Has.Member(("loja", false)));
        Assert.That((await tables).Value.Select(table => (table.Name, table.Kind)), Has.Member(("pedido", "table")));
        Assert.That((await columns).Value, Has.Count.EqualTo(6));
        Assert.That((await indexes).Value.Select(index => index.Name), Has.Member("uk_pedido_numero"));
        Assert.That((await foreignKeys).Value.Select(foreignKey => foreignKey.Name), Is.EqualTo(new[] { "fk_pedido_cliente" }));
        Assert.That(await CountConnectionsAsync(), Is.EqualTo(1));
    }

    /// <summary>Quem desiste de esperar a vez (a requisição foi abortada) recebe uma recusa, e não uma exceção; a sessão continua de quem está rodando.</summary>
    [Test]
    public async Task Catalog_WaitingItsTurn_WhenTheRequestIsAborted_ReturnsExecutionFailed()
    {
        var session = await OpenSessionAsync();
        var running = _service.ExecuteAsync(session.ID, SlowQuery, CancellationToken.None);
        await WaitForRunningSleepAsync();
        using var aborted = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));

        var schemas = await _service.GetSchemasAsync(session.ID, aborted.Token);
        var stillRunning = !running.IsCompleted;
        _service.Cancel(session.ID);
        await running;

        Assert.That(schemas.IsFailure, Is.True);
        Assert.That(schemas.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(stillRunning, Is.True);
    }

    /// <summary>RN-SQL-010.</summary>
    [Test]
    public async Task Cancel_StopsTheRunningQuery_AndKeepsTheSession()
    {
        var session = await OpenSessionAsync();
        var watch = Stopwatch.StartNew();
        var running = _service.ExecuteAsync(session.ID, SlowQuery, CancellationToken.None);
        await WaitForRunningSleepAsync();

        var canceled = _service.Cancel(session.ID);
        var outcome = await running;
        watch.Stop();
        var afterwards = await _service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);

        Assert.That(canceled.IsSuccess, Is.True);
        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(outcome.Error.Message, Is.EqualTo("canceling statement due to user request"));
        Assert.That(watch.Elapsed, Is.LessThan(TimeSpan.FromSeconds(5)));
        Assert.That(afterwards.IsSuccess, Is.True);
    }

    /// <summary>RN-SESSAO-004: fechar a aba no meio de uma consulta interrompe a consulta e não deixa conexão no banco.</summary>
    [Test]
    public async Task Close_WhileAQueryRuns_StopsItAndClosesTheSession()
    {
        var session = await OpenSessionAsync();
        var watch = Stopwatch.StartNew();
        var running = _service.ExecuteAsync(session.ID, SlowQuery, CancellationToken.None);
        await WaitForRunningSleepAsync();

        var closed = await _service.CloseAsync(session.ID);
        var outcome = await running;
        watch.Stop();

        Assert.That(closed.IsSuccess, Is.True);
        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(watch.Elapsed, Is.LessThan(TimeSpan.FromSeconds(5)));
        await WaitForConnectionsAsync(0);
    }

    /// <summary>RN-SQL-006.</summary>
    [Test]
    public async Task Count_WithoutPreviousRowQuery_ReturnsNoQueryToCount()
    {
        var session = await OpenSessionAsync();
        await _service.ExecuteAsync(session.ID, "UPDATE loja.cliente SET nome = nome WHERE id = 1", CancellationToken.None);

        var total = await _service.CountAsync(session.ID, CancellationToken.None);

        Assert.That(total.IsFailure, Is.True);
        Assert.That(total.Error.Kind, Is.EqualTo(EDatabaseFailure.NoQueryToCount));
    }

    /// <summary>RN-SQL-006: conta o último comando que devolveu linhas, com o cursor já fechado e mesmo depois de um comando sem linhas.</summary>
    [Test]
    public async Task Count_AfterCursorIsExhausted_StillCounts()
    {
        var session = await OpenSessionAsync();
        var page = await ExecutePageAsync(session.ID, "SELECT id FROM loja.cliente");
        await _service.ExecuteAsync(session.ID, "UPDATE loja.cliente SET nome = nome WHERE id = 1", CancellationToken.None);

        var total = await _service.CountAsync(session.ID, CancellationToken.None);

        Assert.That(page.HasMore, Is.False);
        Assert.That(total.IsSuccess, Is.True, total.IsFailure ? total.Error.Message : null);
        Assert.That(total.Value, Is.EqualTo(10));
    }

    /// <summary>
    /// RN-SQL-006: a contagem vai por outra conexão. Na da sessão, um comando novo fecharia o cursor, e "carregar mais" não devolveria as
    /// 200 linhas seguintes; e a conexão da contagem fecha quando ela acaba.
    /// </summary>
    [Test]
    public async Task Count_WhileCursorIsOpen_UsesAnotherConnection_AndKeepsTheCursor()
    {
        var session = await OpenSessionAsync();
        var first = await ExecutePageAsync(session.ID, PedidoQuery);

        var total = await _service.CountAsync(session.ID, CancellationToken.None);
        var second = await _service.FetchNextAsync(session.ID, CancellationToken.None);

        Assert.That(first.HasMore, Is.True);
        Assert.That(total.IsSuccess, Is.True, total.IsFailure ? total.Error.Message : null);
        Assert.That(total.Value, Is.EqualTo(1000));
        Assert.That(second.IsSuccess, Is.True);
        Assert.That(second.Value.Rows[0][0], Is.EqualTo("1201"));
        Assert.That(second.Value.Rows, Has.Count.EqualTo(200));
        await WaitForConnectionsAsync(1);
    }

    /// <summary>
    /// RN-SQL-013 e RN-SQL-006: o comando que grava e devolve linhas já respondeu com o total. "Contar total" devolve esse total sem ir ao
    /// banco: contar seria executar a gravação de novo.
    /// </summary>
    [Test]
    public async Task Count_AfterAWriteThatReturnedRows_ReturnsItsTotalWithoutRunningItAgain()
    {
        var table = $"loja.escrita_{Guid.NewGuid():N}";
        var session = await OpenSessionAsync();
        await _service.ExecuteAsync(session.ID, $"CREATE TABLE {table} (numero INTEGER NOT NULL, versao INTEGER NOT NULL)", CancellationToken.None);
        await _service.ExecuteAsync(session.ID, $"INSERT INTO {table} (numero, versao) SELECT numero, 0 FROM loja.pedido", CancellationToken.None);

        var written = await ExecutePageAsync(session.ID, $"UPDATE {table} SET versao = versao + 1 RETURNING numero");
        var total = await _service.CountAsync(session.ID, CancellationToken.None);
        var writtenOnce = await ObserveAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        await _service.ExecuteAsync(session.ID, $"DROP TABLE {table}", CancellationToken.None);

        Assert.That(written.TotalRows, Is.EqualTo(1000));
        Assert.That(written.HasMore, Is.False);
        Assert.That(total.IsSuccess, Is.True, total.IsFailure ? total.Error.Message : null);
        Assert.That(total.Value, Is.EqualTo(1000));
        Assert.That(writtenOnce, Is.EqualTo(1000));
    }

    /// <summary>RN-SQL-010: "cancelar" interrompe a contagem em andamento, que roda em outra conexão; a sessão e o cursor dela ficam.</summary>
    [Test]
    public async Task Cancel_StopsARunningCount()
    {
        var (session, counting) = await StartSlowCountAsync();
        var watch = Stopwatch.StartNew();

        var canceled = _service.Cancel(session.ID);
        var total = await counting;
        watch.Stop();
        var next = await _service.FetchNextAsync(session.ID, CancellationToken.None);

        Assert.That(canceled.IsSuccess, Is.True);
        Assert.That(total.IsFailure, Is.True);
        Assert.That(total.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(watch.Elapsed, Is.LessThan(TimeSpan.FromSeconds(5)));
        Assert.That(next.IsSuccess, Is.True);
        Assert.That(next.Value.Rows[0][0], Is.EqualTo("201"));
        await WaitForConnectionsAsync(1);
    }

    /// <summary>Depois de um cancelamento a sessão conta de novo normalmente: o cancelamento valeu para a contagem que estava rodando.</summary>
    [Test]
    public async Task Count_AfterACanceledCount_WorksAgain()
    {
        var (session, counting) = await StartSlowCountAsync();
        _service.Cancel(session.ID);
        await counting;
        await ExecutePageAsync(session.ID, PedidoQuery);

        var total = await _service.CountAsync(session.ID, CancellationToken.None);

        Assert.That(total.IsSuccess, Is.True, total.IsFailure ? total.Error.Message : null);
        Assert.That(total.Value, Is.EqualTo(1000));
    }

    /// <summary>RN-SESSAO-004: fechar a sessão interrompe a contagem dela; não fica consulta rodando no banco com as credenciais da sessão.</summary>
    [Test]
    public async Task Close_StopsARunningCount()
    {
        var (session, counting) = await StartSlowCountAsync();
        var watch = Stopwatch.StartNew();

        var closed = await _service.CloseAsync(session.ID);
        var total = await counting;
        watch.Stop();

        Assert.That(closed.IsSuccess, Is.True);
        Assert.That(total.IsFailure, Is.True);
        Assert.That(watch.Elapsed, Is.LessThan(TimeSpan.FromSeconds(5)));
        await WaitForConnectionsAsync(0);
    }

    /// <summary>RN-COFRE-008: fechar o cofre interrompe também a contagem em andamento, que usa as credenciais dele.</summary>
    [Test]
    public async Task VaultLocked_StopsARunningCount()
    {
        await CreateVaultAsync();
        var (_, counting) = await StartSlowCountAsync();
        var watch = Stopwatch.StartNew();

        _vault.Lock();
        var total = await counting;
        watch.Stop();

        Assert.That(total.IsFailure, Is.True);
        Assert.That(watch.Elapsed, Is.LessThan(TimeSpan.FromSeconds(5)));
        await WaitForConnectionsAsync(0);
    }

    /// <summary>
    /// RN-SQL-010: "cancelar" não afeta um cursor aberto e parado. Depois dele o resultado continua legível até o fim, inclusive a parte
    /// que o banco ainda não tinha mandado.
    /// </summary>
    [Test]
    public async Task Cancel_WithAnIdleOpenCursor_LeavesItReadableToTheEnd()
    {
        var session = await OpenSessionAsync();
        var page = await ExecutePageAsync(session.ID, LargeReadQuery);
        long rows = page.Rows.Count;

        var canceled = _service.Cancel(session.ID);
        while (page.HasMore)
        {
            var next = await _service.FetchNextAsync(session.ID, CancellationToken.None);
            Assert.That(next.IsSuccess, Is.True, next.IsFailure ? next.Error.Message : null);
            page = next.Value;
            rows += page.Rows.Count;
        }

        Assert.That(canceled.IsSuccess, Is.True);
        Assert.That(rows, Is.EqualTo(20000));
    }

    /// <summary>
    /// RN-SQL-007, com um erro que o banco deixou no fim do resultado (divisão por zero na linha 300): o fechamento por ociosidade
    /// descarta o erro junto com o cursor e termina a transação da tentativa. A sessão volta a `idle` no banco, e não fica em
    /// `idle in transaction (aborted)` até o próximo comando.
    /// </summary>
    [Test]
    public async Task Cursor_IdleWithAnErrorStillToCome_IsClosed_AndTheSessionGoesBackToIdle()
    {
        var session = await OpenSessionAsync();
        var pid = (await ExecutePageAsync(session.ID, "SELECT pg_backend_pid()")).Rows[0][0];
        await ExecutePageAsync(session.ID, ErrorAtRow300Query);

        _clock.Advance(TimeSpan.FromMinutes(5));
        var watch = Stopwatch.StartNew();
        long idle;
        while ((idle = await ObserveAsync($"SELECT COUNT(*) FROM pg_stat_activity WHERE pid = {pid} AND state = 'idle'")) != 1 && watch.Elapsed < Patience)
            await Task.Delay(25);

        var next = await _service.FetchNextAsync(session.ID, CancellationToken.None);
        var afterwards = await _service.ExecuteAsync(session.ID, "SELECT 1", CancellationToken.None);

        Assert.That(idle, Is.EqualTo(1));
        Assert.That(next.IsFailure, Is.True);
        Assert.That(next.Error.Kind, Is.EqualTo(EDatabaseFailure.NoOpenCursor));
        Assert.That(afterwards.IsSuccess, Is.True, afterwards.IsFailure ? afterwards.Error.Message : null);
    }

    /// <summary>Fechar a sessão com um erro pendente no cursor não deixa conexão nem transação no banco.</summary>
    [Test]
    public async Task Close_WithAnErrorStillToCome_LeavesNothingInTheDatabase()
    {
        var session = await OpenSessionAsync();
        await ExecutePageAsync(session.ID, ErrorAtRow300Query);

        var closed = await _service.CloseAsync(session.ID);

        Assert.That(closed.IsSuccess, Is.True);
        await WaitForConnectionsAsync(0);
    }

    /// <summary>
    /// RN-SQL-007: cinco minutos sem leitura fecham o cursor, e cada leitura recomeça a contagem. O fechamento roda fora da chamada que
    /// avançou o relógio e ocupa a sessão por alguns milissegundos: enquanto isso "carregar mais" responde `SessionBusy`.
    /// </summary>
    [Test]
    public async Task Cursor_IdleForFiveMinutes_IsClosed()
    {
        var session = await OpenSessionAsync();
        await ExecutePageAsync(session.ID, PedidoQuery);

        _clock.Advance(TimeSpan.FromSeconds(299));
        var beforeTimeout = await _service.FetchNextAsync(session.ID, CancellationToken.None);
        _clock.Advance(TimeSpan.FromSeconds(299));
        var afterAnotherRead = await _service.FetchNextAsync(session.ID, CancellationToken.None);
        _clock.Advance(TimeSpan.FromMinutes(5));

        var watch = Stopwatch.StartNew();
        var afterTimeout = await _service.FetchNextAsync(session.ID, CancellationToken.None);
        while (afterTimeout.IsFailure && afterTimeout.Error.Kind == EDatabaseFailure.SessionBusy && watch.Elapsed < Patience)
        {
            await Task.Delay(25);
            afterTimeout = await _service.FetchNextAsync(session.ID, CancellationToken.None);
        }

        var executedAgain = await ExecutePageAsync(session.ID, PedidoQuery);

        Assert.That(beforeTimeout.IsSuccess, Is.True);
        Assert.That(beforeTimeout.Value.Rows[0][0], Is.EqualTo("1201"));
        Assert.That(afterAnotherRead.IsSuccess, Is.True);
        Assert.That(afterAnotherRead.Value.Rows[0][0], Is.EqualTo("1401"));
        Assert.That(afterTimeout.IsFailure, Is.True);
        Assert.That(afterTimeout.Error.Kind, Is.EqualTo(EDatabaseFailure.NoOpenCursor));
        Assert.That(executedAgain.Rows[0][0], Is.EqualTo("1001"));
    }

    /// <summary>RN-CONN-014.</summary>
    [Test]
    public async Task CloseByConnection_ClosesOnlyThatConnectionsSessions()
    {
        var removed = Guid.NewGuid();
        var first = await OpenSessionAsync(removed);
        var second = await OpenSessionAsync(removed);
        var other = await OpenSessionAsync(Guid.NewGuid());

        await _service.CloseByConnectionAsync(removed);

        var fromFirst = await _service.GetSchemasAsync(first.ID, CancellationToken.None);
        var fromSecond = await _service.GetSchemasAsync(second.ID, CancellationToken.None);
        var fromOther = await _service.GetSchemasAsync(other.ID, CancellationToken.None);

        Assert.That(fromFirst.IsFailure && fromSecond.IsFailure, Is.True);
        Assert.That(fromFirst.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionNotFound));
        Assert.That(fromSecond.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionNotFound));
        Assert.That(fromOther.IsSuccess, Is.True);
        await WaitForConnectionsAsync(1);
    }

    [Test]
    public async Task CloseAll_ClosesEverySession()
    {
        var first = await OpenSessionAsync();
        var second = await OpenSessionAsync();

        await _service.CloseAllAsync();

        var fromFirst = await _service.GetSchemasAsync(first.ID, CancellationToken.None);
        var fromSecond = await _service.GetSchemasAsync(second.ID, CancellationToken.None);

        Assert.That(fromFirst.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionNotFound));
        Assert.That(fromSecond.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionNotFound));
        await WaitForConnectionsAsync(0);
    }

    /// <summary>
    /// RN-COFRE-008: fechar o cofre encerra todas as sessões, inclusive a que está no meio de uma consulta. Quando o `Lock` volta as sessões
    /// já não existem no registro; as conexões fecham em seguida, fora da chamada que fechou o cofre.
    /// </summary>
    [Test]
    public async Task VaultLocked_ClosesEverySession()
    {
        await CreateVaultAsync();
        var idle = await OpenSessionAsync();
        var busy = await OpenSessionAsync();
        var running = _service.ExecuteAsync(busy.ID, SlowQuery, CancellationToken.None);
        await WaitForRunningSleepAsync();
        var watch = Stopwatch.StartNew();

        _vault.Lock();
        var lockTook = watch.Elapsed;
        var fromIdle = await _service.GetSchemasAsync(idle.ID, CancellationToken.None);
        var fromBusy = await _service.ExecuteAsync(busy.ID, "SELECT 1", CancellationToken.None);
        var interrupted = await running;

        Assert.That(fromIdle.IsFailure, Is.True);
        Assert.That(fromIdle.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionNotFound));
        Assert.That(fromBusy.IsFailure, Is.True);
        Assert.That(fromBusy.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionNotFound));
        Assert.That(interrupted.IsFailure, Is.True);
        Assert.That(lockTook, Is.LessThan(TimeSpan.FromSeconds(1)));
        await WaitForConnectionsAsync(0);
    }

    /// <summary>RN-COFRE-007: a entrada de outro usuário fecha as sessões abertas com as credenciais do cofre anterior.</summary>
    [Test]
    public async Task VaultSwitchedToAnotherUser_ClosesThePreviousUsersSessions()
    {
        await CreateVaultAsync();
        var previous = await OpenSessionAsync();

        await CreateVaultAsync();
        var current = await OpenSessionAsync();

        var fromPrevious = await _service.GetSchemasAsync(previous.ID, CancellationToken.None);
        var fromCurrent = await _service.GetSchemasAsync(current.ID, CancellationToken.None);

        Assert.That(fromPrevious.IsFailure, Is.True);
        Assert.That(fromPrevious.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionNotFound));
        Assert.That(fromCurrent.IsSuccess, Is.True);
        await WaitForConnectionsAsync(1);
    }

    /// <summary>
    /// Na troca de usuário o aviso `Locked` do cofre anterior chega com o cofre novo já aberto. Uma sessão do cofre novo registrada antes
    /// de o aviso chegar não dependia do cofre que fechou, e fica. Para forçar essa ordem, o teste assina o aviso antes de o registro de
    /// sessões existir: o assinante dele roda primeiro e abre a sessão do cofre novo.
    /// </summary>
    [Test]
    public async Task VaultLocked_ArrivingAfterTheNextVaultOpened_KeepsTheNextVaultsSessions()
    {
        await using var provider = BuildProvider();
        var vault = provider.GetRequiredService<IVaultService>();
        IDatabaseSessionService service = null!;
        DatabaseSessionInfo? openedDuringTheEvent = null;

        // Só no primeiro aviso, o da troca: o descarte do contêiner fecha o cofre e avisa de novo, com o registro já descartado.
        vault.Locked += () => openedDuringTheEvent ??= Task.Run(() => service.OpenAsync(Guid.NewGuid(), _settings, vault.Generation, CancellationToken.None)).GetAwaiter().GetResult().Value;
        service = provider.GetRequiredService<IDatabaseSessionService>();
        await CreateVaultAsync(vault);
        var previous = await service.OpenAsync(Guid.NewGuid(), _settings, vault.Generation, CancellationToken.None);

        await CreateVaultAsync(vault);

        var fromPrevious = await service.GetSchemasAsync(previous.Value.ID, CancellationToken.None);
        var fromNext = await service.GetSchemasAsync(openedDuringTheEvent!.ID, CancellationToken.None);

        Assert.That(fromPrevious.IsFailure, Is.True);
        Assert.That(fromPrevious.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionNotFound));
        Assert.That(fromNext.IsSuccess, Is.True);
        await WaitForConnectionsAsync(1);
    }

    /// <summary>As credenciais foram lidas de um cofre que já não é o aberto: a conexão recém-aberta fecha e nenhuma sessão é registrada.</summary>
    [Test]
    public async Task Open_WhenTheVaultChangedMeanwhile_ReturnsVaultChangedAndLeavesNoSession()
    {
        var generation = _vault.Generation;
        await CreateVaultAsync();

        var opened = await _service.OpenAsync(Guid.NewGuid(), _settings, generation, CancellationToken.None);

        Assert.That(opened.IsFailure, Is.True);
        Assert.That(opened.Error.Kind, Is.EqualTo(EDatabaseFailure.VaultChanged));
        await WaitForConnectionsAsync(0);
    }

    /// <summary>
    /// O cofre fecha enquanto a sessão abre, em instantes diferentes a cada volta: de imediato até o dobro do tempo que uma conexão leva
    /// para ficar pronta nesta máquina, ou seja, antes, durante e depois do registro. Qualquer que seja a ordem, não sobra sessão: ou a
    /// abertura é recusada com `VaultChanged`, ou a sessão foi registrada e o fechamento do cofre a levou, e o identificador devolvido já
    /// não existe. O banco confirma: nenhuma conexão fica.
    /// </summary>
    [Test]
    public async Task Open_RacingWithVaultLock_NeverLeavesASession()
    {
        const int Rounds = 40;

        var (userName, password) = await CreateVaultAsync();
        var connecting = Stopwatch.StartNew();
        await _service.CloseAsync((await OpenSessionAsync()).ID);
        var connectTime = connecting.Elapsed;
        var refused = 0;

        for (var round = 0; round < Rounds; round++)
        {
            Assert.That((await _vault.UnlockAsync(userName, password, CancellationToken.None)).IsSuccess, Is.True);
            var generation = _vault.Generation;
            var delay = connectTime * 2 * round / Rounds;

            var opening = _service.OpenAsync(Guid.NewGuid(), _settings, generation, CancellationToken.None);
            var locking = Task.Run(() =>
            {
                // O Task.Delay do Windows anda de 15 em 15 ms: o giro acerta o milissegundo.
                var spin = Stopwatch.StartNew();
                while (spin.Elapsed < delay)
                    Thread.SpinWait(100);

                _vault.Lock();
            });

            await Task.WhenAll(opening, locking);
            var opened = await opening;

            if (opened.IsFailure)
            {
                Assert.That(opened.Error.Kind, Is.EqualTo(EDatabaseFailure.VaultChanged));
                refused++;
            }
            else
            {
                var closed = await _service.CloseAsync(opened.Value.ID);
                Assert.That(closed.IsFailure, Is.True);
                Assert.That(closed.Error.Kind, Is.EqualTo(EDatabaseFailure.SessionNotFound));
            }

            await WaitForConnectionsAsync(0);
        }

        // As duas ordens aconteceram: a corrida foi de verdade, e não quarenta voltas do mesmo caso.
        Assert.That(refused, Is.InRange(1, Rounds - 1));
    }

    /// <summary>RN-CONN-013.</summary>
    [Test]
    public async Task Test_Succeeds_AndLeavesNoSession()
    {
        var tested = await _service.TestAsync(_settings, CancellationToken.None);

        Assert.That(tested.IsSuccess, Is.True, tested.IsFailure ? tested.Error.Message : null);
        await WaitForConnectionsAsync(0);
    }

    [Test]
    public async Task Test_WithWrongPassword_ReturnsConnectionFailed()
    {
        var tested = await _service.TestAsync(_settings with { Password = "senha-errada" }, CancellationToken.None);

        Assert.That(tested.IsFailure, Is.True);
        Assert.That(tested.Error.Kind, Is.EqualTo(EDatabaseFailure.ConnectionFailed));
        Assert.That(tested.Error.Message, Does.Contain("password authentication failed"));
    }
}
