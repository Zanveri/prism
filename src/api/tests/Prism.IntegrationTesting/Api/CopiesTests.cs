using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// A cópia de dados para outro banco (seção 36, RN-IMPORT-022 a 027, rotas `POST api/user/transfers/copies/preview` e `copies`), pela API de verdade
/// contra o PostgreSQL de teste com a carga `loja`: a origem é lida numa conexão do cofre e gravada pela outra, que aponta para o mesmo banco; o destino é
/// uma tabela num esquema do fixture, que ele mesmo apaga no fim. Cada teste cria a sua tabela.
/// </summary>
[TestFixture]
[Category("Api")]
public sealed class CopiesTests
{
    private const string UserName = "marina.costa";
    private const string CopiesPath = "/api/user/transfers/copies";
    private const string PreviewPath = "/api/user/transfers/copies/preview";
    private const string TransfersPath = "/api/user/transfers";

    private readonly string _schema = $"copia_{Guid.NewGuid():N}"[..18];

    private ConnectionSettings _settings = null!;

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        _settings = await PostgresSingleton.GetSettingsAsync();

        await using var host = await ApiHost.StartAsync();
        var (_, _, session) = await StartUserAsync(host);
        await host.Client.ExecuteAsync(session, $"CREATE SCHEMA {_schema}");
    }

    [OneTimeTearDown]
    public async Task StopAsync()
    {
        await using var host = await ApiHost.StartAsync();
        var (_, _, session) = await StartUserAsync(host);
        await host.Client.ExecuteAsync(session, $"DROP SCHEMA {_schema} CASCADE");
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<JsonElement> AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(status), body.ToString());
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));

        return body;
    }

    /// <summary>O usuário, a conexão de origem, a de destino (outra conexão do cofre para o mesmo banco) e uma sessão na de destino, para o arranjo.</summary>
    private async Task<(Guid Source, Guid Target, Guid Session)> StartUserAsync(ApiHost host)
    {
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var source = await host.Client.CreateConnectionAsync(_settings, "Origem");
        var target = await host.Client.CreateConnectionAsync(_settings, "Destino");

        return (source, target, await host.Client.OpenSessionAsync(target));
    }

    private static object TableSource(Guid connectionID, string table = "cliente")
        => new { kind = "table", connectionID, schema = "loja", table };

    private static object[] Columns()
        => [new { position = 0, name = "id" }, new { position = 1, name = "nome" }];

    private object Copy(object source, Guid targetID, string table, object load, string schema = "", object? mapping = null)
        => new
        {
            source,
            columns = Columns(),
            count = true,
            target = new { connectionID = targetID, schema = schema.Length == 0 ? _schema : schema, table },
            mapping = mapping ?? new[] { new { source = 0, target = "id" }, new { source = 1, target = "nome" } },
            load,
            windowID = 1
        };

    private static async Task<JsonElement> WaitForEndAsync(ApiHost host, Guid id)
    {
        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (true)
        {
            var response = await host.Client.GetAsync($"{TransfersPath}/{id}");
            var body = await ReadJsonAsync(response);
            Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());

            if (body.GetProperty("state").GetString() != "running")
                return body;

            Assert.That(DateTime.UtcNow, Is.LessThan(deadline), "A cópia não terminou em 60 segundos.");
            await Task.Delay(100);
        }
    }

    private static async Task<Guid> StartCopyAsync(ApiHost host, object request)
    {
        var response = await host.Client.PostAsJsonAsync(CopiesPath, request);
        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Accepted), body.ToString());

        return body.GetProperty("id").GetGuid();
    }

    /// <summary>RN-API-005: as rotas novas ficam atrás da barreira do cofre.</summary>
    [Test]
    public async Task Routes_WithVaultLocked_Return401VaultLocked()
    {
        await using var host = await ApiHost.StartAsync();

        foreach (var path in new[] { PreviewPath, CopiesPath })
            await AssertProblemAsync(await host.Client.PostAsJsonAsync(path, new { }), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    /// <summary>RN-IMPORT-024: a prévia lê só a tabela de destino, numa conexão à parte, e sugere o mapeamento pelo nome; a origem não é lida.</summary>
    [Test]
    public async Task Preview_ReadsTheTargetAndMapsByName()
    {
        await using var host = await ApiHost.StartAsync();
        var (source, target, session) = await StartUserAsync(host);
        await host.Client.ExecuteAsync(session, $"CREATE TABLE {_schema}.prevista (id integer PRIMARY KEY, extra text, nome varchar(80))");

        var response = await host.Client.PostAsJsonAsync(PreviewPath, new { source = TableSource(source), columns = Columns(), target = new { connectionID = target, schema = _schema, table = "prevista" } });
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        var table = body.GetProperty("table");
        Assert.That(table.GetProperty("columns").EnumerateArray().Select(column => column.GetProperty("name").GetString()), Is.EqualTo(new[] { "id", "extra", "nome" }));
        var mapping = body.GetProperty("mapping").EnumerateArray().Select(entry => (entry.GetProperty("source").GetInt32(), entry.GetProperty("target").GetString())).ToList();
        Assert.That(mapping, Is.EqualTo(new[] { (0, "id"), (1, "nome") }));
    }

    /// <summary>
    /// RN-IMPORT-023, 026 e 027: a tabela `loja.cliente` copiada para outra tabela pela outra conexão, com a contagem e a confirmação a cada 4 linhas; o item
    /// diz as duas conexões, as linhas lidas e as confirmadas, sem bytes.
    /// </summary>
    [Test]
    public async Task Copy_Table_ToAnotherConnection_EndsDone()
    {
        await using var host = await ApiHost.StartAsync();
        var (source, target, session) = await StartUserAsync(host);
        await host.Client.ExecuteAsync(session, $"CREATE TABLE {_schema}.copiada (id integer PRIMARY KEY, nome varchar(80) NOT NULL)");

        var id = await StartCopyAsync(host, Copy(TableSource(source), target, "copiada", new { empty = false, commitEvery = 4 }));
        var done = await WaitForEndAsync(host, id);

        Assert.That(done.GetProperty("state").GetString(), Is.EqualTo("done"), done.ToString());
        Assert.That(done.GetProperty("kind").GetString(), Is.EqualTo("copy"));
        Assert.That(done.GetProperty("connectionID").GetGuid(), Is.EqualTo(source));
        Assert.That(done.GetProperty("targetConnectionID").GetGuid(), Is.EqualTo(target));
        Assert.That(done.GetProperty("rows").GetInt64(), Is.EqualTo(10));
        Assert.That(done.GetProperty("total").GetInt64(), Is.EqualTo(10));
        Assert.That(done.GetProperty("committed").GetInt64(), Is.EqualTo(10));
        Assert.That(done.GetProperty("bytes").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(done.GetProperty("size").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(done.GetProperty("summary").GetProperty("committed").GetInt64(), Is.EqualTo(10));

        var rows = (await host.Client.ExecuteAsync(session, $"SELECT id, nome FROM {_schema}.copiada WHERE id IN (1, 10) ORDER BY id")).GetProperty("rows").ToString();
        Assert.That(rows, Is.EqualTo("""[["1","Cliente 1"],["10","Cliente 10"]]"""));
    }

    /// <summary>
    /// RN-IMPORT-016 e 026: no PostgreSQL de destino o texto vai como veio, e o banco recusa o nome longo demais na décima linha da leitura: o erro dele, do
    /// lado do destino, com as 8 linhas das confirmações anteriores na tabela.
    /// </summary>
    [Test]
    public async Task Copy_TargetRefusal_StopsAtTheReadRow_AndKeepsWhatWasCommitted()
    {
        await using var host = await ApiHost.StartAsync();
        var (source, target, session) = await StartUserAsync(host);
        await host.Client.ExecuteAsync(session, $"CREATE TABLE {_schema}.curta (id integer PRIMARY KEY, nome varchar(9) NOT NULL)");
        var query = new { kind = "query", connectionID = source, sql = "SELECT id, nome FROM loja.cliente ORDER BY id", name = "clientes" };

        var id = await StartCopyAsync(host, Copy(query, target, "curta", new { empty = false, commitEvery = 4 }));
        var failed = await WaitForEndAsync(host, id);

        Assert.That(failed.GetProperty("state").GetString(), Is.EqualTo("failed"), failed.ToString());
        Assert.That(failed.GetProperty("committed").GetInt64(), Is.EqualTo(8));
        var error = failed.GetProperty("error");
        Assert.That(error.GetProperty("code").GetString(), Is.EqualTo("SQL_EXECUTION_FAILED"));
        Assert.That(error.GetProperty("sqlState").GetString(), Is.EqualTo("22001"));
        Assert.That(error.GetProperty("line").GetInt64(), Is.EqualTo(10));
        Assert.That(error.GetProperty("side").GetString(), Is.EqualTo("target"));
        Assert.That(error.GetProperty("committed").GetInt64(), Is.EqualTo(8));

        var count = (await host.Client.ExecuteAsync(session, $"SELECT count(*) FROM {_schema}.curta")).GetProperty("rows")[0][0].GetString();
        Assert.That(count, Is.EqualTo("8"));
    }

    /// <summary>
    /// RN-IMPORT-023 e 027: as recusas antes do trabalho: a tabela de destino que é a própria origem por outra conexão para o mesmo banco, na prévia e no
    /// começo; o mapeamento além das colunas pedidas; e a conferência do arquivo, que a cópia não tem.
    /// </summary>
    [Test]
    public async Task Copy_Refusals_ComeBeforeTheJob()
    {
        await using var host = await ApiHost.StartAsync();
        var (source, target, _) = await StartUserAsync(host);
        var load = new { empty = false, commitEvery = 4 };

        var preview = await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { source = TableSource(source), columns = Columns(), target = new { connectionID = target, schema = "loja", table = "cliente" } }), HttpStatusCode.UnprocessableEntity, "IMPORT_TARGET_IS_SOURCE");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(CopiesPath, Copy(TableSource(source), target, "cliente", load, schema: "loja")), HttpStatusCode.UnprocessableEntity, "IMPORT_TARGET_IS_SOURCE");
        var mapping = await AssertProblemAsync(await host.Client.PostAsJsonAsync(CopiesPath, Copy(TableSource(source), target, "qualquer", load, mapping: new[] { new { source = 5, target = "id" } })), HttpStatusCode.UnprocessableEntity, "IMPORT_MAPPING_INVALID");
        var check = await AssertProblemAsync(await host.Client.PostAsJsonAsync(CopiesPath, Copy(TableSource(source), target, "qualquer", new { check = true })), HttpStatusCode.UnprocessableEntity, "IMPORT_OPTIONS_INVALID");

        Assert.That(preview.GetProperty("detail").GetString(), Is.EqualTo("A tabela de destino é a própria origem. Escolha outra tabela."));
        Assert.That(mapping.GetProperty("errors").EnumerateObject().Select(field => field.Name), Does.Contain("mapping[0].source"));
        Assert.That(check.GetProperty("errors").EnumerateObject().Select(field => field.Name), Does.Contain("load.check"));
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync(TransfersPath))).GetArrayLength(), Is.Zero);
    }
}
