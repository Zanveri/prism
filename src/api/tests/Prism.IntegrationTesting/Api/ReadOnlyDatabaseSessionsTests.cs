using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// A conexão somente leitura e a verificação periódica em HTTP, contra o PostgreSQL de teste (seção 32 da especificação): o que não é leitura
/// recusado antes de ir ao banco (RN-PROT-002 e 005), a recusa do banco na transação só de leitura e no modo da sessão (RN-PROT-006), a edição
/// recusada, a regra nova valendo no comando seguinte da sessão aberta, e a verificação numa sessão aberta (RN-VERIF-002). Precisa do Docker.
/// </summary>
[TestFixture]
[Category("Databases")]
public sealed class ReadOnlyDatabaseSessionsTests
{
    private const string UserName = "marina.costa";
    private const string ConnectionsPath = "/api/user/connections";

    private readonly string _schema = $"somente_{Guid.NewGuid():N}"[..20];

    private ConnectionSettings _settings = null!;
    private DatabaseObserver _observer = null!;

    private string Tabela => $"\"{_schema}\".\"pedido\"";

    private string Grava => $"\"{_schema}\".\"grava\"()";

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        _settings = await PostgresSingleton.GetSettingsAsync();
        _observer = await DatabaseObserver.OpenAsync(_settings);
        await _observer.ExecuteAsync($"CREATE SCHEMA {_schema}");
        await _observer.ExecuteAsync($"CREATE TABLE {Tabela} (id integer PRIMARY KEY, status text)");
        await _observer.ExecuteAsync($"INSERT INTO {Tabela} VALUES (1, 'aberta'), (2, 'aberta')");
        await _observer.ExecuteAsync($"CREATE FUNCTION {Grava} RETURNS integer LANGUAGE sql AS $$ INSERT INTO {Tabela} VALUES (99, 'gravada pela função') RETURNING 1 $$");
    }

    [OneTimeTearDown]
    public async Task StopAsync()
    {
        await _observer.ExecuteAsync($"DROP SCHEMA {_schema} CASCADE");
        await _observer.DisposeAsync();
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<JsonElement> AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(status), body.ToString());
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));

        return body;
    }

    /// <summary>Cria o usuário e a conexão com o contêiner, com o somente leitura pedido; devolve a conexão e a senha do usuário.</summary>
    private async Task<(Guid ConnectionID, string Password)> CreateConnectionAsync(ApiHost host, bool readOnly, string? verificationQuery = null)
    {
        var password = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, password);
        var response = await host.Client.PostAsJsonAsync(ConnectionsPath, ConnectionBody(readOnly, verificationQuery));
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created), await response.Content.ReadAsStringAsync());

        return ((await ReadJsonAsync(response)).GetProperty("id").GetGuid(), password);
    }

    private Dictionary<string, object?> ConnectionBody(bool readOnly, string? verificationQuery = null, string? userPassword = null)
        => new() { ["folderID"] = null, ["name"] = "Banco de teste", ["engine"] = (int)_settings.Engine, ["host"] = _settings.Host, ["port"] = _settings.Port, ["database"] = _settings.Database, ["userName"] = _settings.UserName, ["password"] = _settings.Password, ["readOnly"] = readOnly, ["verificationQuery"] = verificationQuery, ["userPassword"] = userPassword };

    private Task<long> CountWrittenByTheFunctionAsync()
        => _observer.CountAsync($"SELECT COUNT(*) FROM {Tabela} WHERE id = 99");

    /// <summary>RN-PROT-002: a leitura roda e o resultado inteiro é só leitura; o que não é leitura é recusado sem ir ao banco, e o resultado anterior fica.</summary>
    [Test]
    public async Task ReadOnlyConnection_RunsReads_AndRefusesTheRestBeforeTheDatabase()
    {
        await using var host = await ApiHost.StartAsync();
        var (connectionID, _) = await CreateConnectionAsync(host, readOnly: true);
        var session = await host.Client.OpenSessionAsync(connectionID);

        var page = await host.Client.ExecuteAsync(session, $"SELECT * FROM {Tabela} ORDER BY id");
        var resultID = page.GetProperty("resultID").GetGuid();
        var refused = await AssertProblemAsync(await host.Client.ExecuteRawAsync(session, $"DELETE FROM {Tabela}"), HttpStatusCode.UnprocessableEntity, "CONNECTION_READ_ONLY");
        var editTarget = await host.Client.PostAsJsonAsync($"{PrismCalls.SessionsPath}/{session}/queries/edit-target", new { resultID });
        var cells = await host.Client.PostAsJsonAsync($"{PrismCalls.SessionsPath}/{session}/results/{resultID}/cells", new { cells = new[] { new { row = 0, column = 1 } } });

        Assert.That(page.GetProperty("editable").ToString(), Is.EqualTo("""{"known":true,"reason":"a conexão é somente leitura"}"""));
        Assert.That(refused.GetProperty("detail").GetString(), Is.EqualTo("A conexão é somente leitura, e só leituras são executadas nela: um DELETE não é leitura. Nada foi enviado ao banco."));
        Assert.That(refused.TryGetProperty("executed", out _), Is.False);
        await AssertProblemAsync(editTarget, HttpStatusCode.UnprocessableEntity, "CONNECTION_READ_ONLY");
        Assert.That(cells.StatusCode, Is.EqualTo(HttpStatusCode.OK), "o resultado de antes continua o da sessão");
        Assert.That(await _observer.CountAsync($"SELECT COUNT(*) FROM {Tabela}"), Is.EqualTo(2));
    }

    /// <summary>
    /// RN-PROT-002 e 006: a função que grava, chamada pelo `SELECT`, é recusada pelo banco na transação só de leitura (25006), e o comando não roda
    /// de novo fora dela; numa conexão comum, a mesma leitura grava (RN-SQL-013). A sessão fica no modo só de leitura do banco.
    /// </summary>
    [Test]
    public async Task ReadOnlyConnection_TheDatabaseRefusesAFunctionThatWrites()
    {
        await using var host = await ApiHost.StartAsync();
        var (connectionID, _) = await CreateConnectionAsync(host, readOnly: true);
        var session = await host.Client.OpenSessionAsync(connectionID);

        var refused = await AssertProblemAsync(await host.Client.ExecuteRawAsync(session, $"SELECT {Grava}"), HttpStatusCode.UnprocessableEntity, "SQL_EXECUTION_FAILED");
        var mode = await host.Client.ExecuteAsync(session, "SHOW default_transaction_read_only");

        Assert.That(refused.GetProperty("sqlState").GetString(), Is.EqualTo("25006"));
        Assert.That(await CountWrittenByTheFunctionAsync(), Is.Zero);
        Assert.That(mode.GetProperty("rows")[0][0].GetString(), Is.EqualTo("on"));
    }

    /// <summary>
    /// RN-PROT-003 e 006: desmarcar o somente leitura (com a senha do usuário) vale para o comando seguinte da sessão aberta, sem fechá-la: a
    /// sessão sai do modo só de leitura do banco e grava. E marcar de novo volta a recusar.
    /// </summary>
    [Test]
    public async Task ChangingTheProtection_AppliesToTheNextCommandOfTheOpenSession()
    {
        await using var host = await ApiHost.StartAsync();
        var (connectionID, password) = await CreateConnectionAsync(host, readOnly: true);
        var session = await host.Client.OpenSessionAsync(connectionID);
        await host.Client.ExecuteAsync(session, "SELECT 1");

        var unmarked = await host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, ConnectionsPath) { Content = JsonContent.Create(new Dictionary<string, object?>(ConnectionBody(readOnly: false, userPassword: password)) { ["id"] = connectionID }) });
        var update = await host.Client.ExecuteAsync(session, $"UPDATE {Tabela} SET status = 'paga' WHERE id = 2");
        var mode = await host.Client.ExecuteAsync(session, "SHOW default_transaction_read_only");
        var marked = await host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, ConnectionsPath) { Content = JsonContent.Create(new Dictionary<string, object?>(ConnectionBody(readOnly: true, userPassword: password)) { ["id"] = connectionID }) });
        var refused = await host.Client.ExecuteRawAsync(session, $"UPDATE {Tabela} SET status = 'aberta' WHERE id = 2");

        Assert.That(unmarked.StatusCode, Is.EqualTo(HttpStatusCode.OK), await unmarked.Content.ReadAsStringAsync());
        Assert.That(update.GetProperty("rowsAffected").GetInt32(), Is.EqualTo(1));
        Assert.That(mode.GetProperty("rows")[0][0].GetString(), Is.EqualTo("off"));
        Assert.That(marked.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        await AssertProblemAsync(refused, HttpStatusCode.UnprocessableEntity, "CONNECTION_READ_ONLY");
        Assert.That(await _observer.CountAsync($"SELECT COUNT(*) FROM {Tabela} WHERE status = 'paga'"), Is.EqualTo(1));
        await _observer.ExecuteAsync($"UPDATE {Tabela} SET status = 'aberta' WHERE id = 2");
    }

    /// <summary>RN-VERIF-002: com uma sessão aberta e livre, a verificação responde ok; a consulta própria que falha é failed, com a mensagem do banco.</summary>
    [Test]
    public async Task Verification_WithAnOpenSession_RunsTheQuery()
    {
        await using var host = await ApiHost.StartAsync();
        var (connectionID, _) = await CreateConnectionAsync(host, readOnly: false);
        await host.Client.OpenSessionAsync(connectionID);

        var ok = await ReadJsonAsync(await host.Client.PostAsync($"{ConnectionsPath}/{connectionID}/verification", null));
        var changed = await host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, ConnectionsPath) { Content = JsonContent.Create(new Dictionary<string, object?>(ConnectionBody(readOnly: false, verificationQuery: "SELECT * FROM tabela_que_nao_existe")) { ["id"] = connectionID }) });
        var failed = await ReadJsonAsync(await host.Client.PostAsync($"{ConnectionsPath}/{connectionID}/verification", null));

        Assert.That(ok.GetProperty("status").GetString(), Is.EqualTo("ok"), ok.ToString());
        Assert.That(ok.GetProperty("elapsedMs").GetInt64(), Is.GreaterThanOrEqualTo(0));
        Assert.That(changed.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(failed.GetProperty("status").GetString(), Is.EqualTo("failed"), failed.ToString());
        Assert.That(failed.GetProperty("sqlState").GetString(), Is.EqualTo("42P01"));
        Assert.That(failed.GetProperty("message").GetString(), Does.Contain("tabela_que_nao_existe"));
    }

    /// <summary>RN-VERIF-002 e RN-SQL-007: a única sessão tem um cursor aberto, que a consulta fecharia: busy, e o "carregar mais" continua.</summary>
    [Test]
    public async Task Verification_DoesNotCloseTheCursorOfTheSession()
    {
        await using var host = await ApiHost.StartAsync();
        var (connectionID, _) = await CreateConnectionAsync(host, readOnly: false);
        var session = await host.Client.OpenSessionAsync(connectionID);
        var page = await host.Client.ExecuteAsync(session, "SELECT generate_series(1, 1000)");

        var verified = await ReadJsonAsync(await host.Client.PostAsync($"{ConnectionsPath}/{connectionID}/verification", null));
        var next = await host.Client.PostAsync($"{PrismCalls.SessionsPath}/{session}/queries/next", null);

        Assert.That(page.GetProperty("hasMore").GetBoolean(), Is.True);
        Assert.That(verified.GetProperty("status").GetString(), Is.EqualTo("busy"));
        Assert.That(next.StatusCode, Is.EqualTo(HttpStatusCode.OK), await next.Content.ReadAsStringAsync());
    }
}
