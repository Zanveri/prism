using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// As rotas da edição de registros (seção 22, "Rotas e respostas") em HTTP, contra o PostgreSQL: a página com `resultID` e `editable`,
/// o `edit-target`, o "Ver SQL" e o "Salvar", com os códigos e as extensões de cada recusa. O que cada banco faz está nos testes do
/// registro de sessões (`Infrastructure/Databases/*EditTests`).
/// </summary>
[TestFixture]
[Category("Databases")]
public sealed class DatabaseSessionEditsTests
{
    private readonly string _schema = $"rotas_{Guid.NewGuid():N}"[..18];

    private ConnectionSettings _settings = null!;

    private string Pedido => $"\"{_schema}\".\"pedido\"";

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        _settings = await PostgresSingleton.GetSettingsAsync();

        await using var host = await ApiHost.StartAsync();
        var session = await StartSessionAsync(host);
        foreach (var sql in new[] { $"CREATE SCHEMA {_schema}", $"CREATE TABLE {Pedido} (id integer PRIMARY KEY, status text, total integer GENERATED ALWAYS AS (id * 2) STORED)", $"INSERT INTO {Pedido} (id, status) VALUES (1, 'aberta'), (2, 'aberta')" })
            await host.Client.ExecuteAsync(session, sql);
    }

    [OneTimeTearDown]
    public async Task StopAsync()
    {
        await using var host = await ApiHost.StartAsync();
        await host.Client.ExecuteAsync(await StartSessionAsync(host), $"DROP SCHEMA {_schema} CASCADE");
    }

    [Test]
    public async Task Edits_FromThePageToTheSave_FollowTheRoutesOfSection22()
    {
        await using var host = await ApiHost.StartAsync();
        var session = await StartSessionAsync(host);

        var page = await host.Client.ExecuteAsync(session, $"SELECT * FROM {Pedido}\nORDER BY 1");
        var resultID = page.GetProperty("resultID").GetGuid();
        Assert.That(page.GetProperty("editable").ToString(), Is.EqualTo("""{"known":false,"reason":null}"""));

        var target = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edit-target"), new { resultID }), HttpStatusCode.OK);
        Assert.That(target.ToString(), Is.EqualTo($$"""{"tables":[{"schema":"{{_schema}}","name":"pedido","key":[0],"editable":true,"reason":null}],"columns":[{"table":0,"baseColumn":"id","editable":true,"reason":null,"nullable":false,"generated":null},{"table":0,"baseColumn":"status","editable":true,"reason":null,"nullable":true,"generated":null},{"table":0,"baseColumn":"total","editable":false,"reason":"gerada pelo banco","nullable":true,"generated":"always"}],"rowOperations":true,"oneAtATime":false}"""));

        var changes = new object[] { new { kind = "update", table = 0, key = new[] { "1" }, set = new[] { new { column = 1, value = (string?)"paga" } } }, new { kind = "insert", table = 0, values = new[] { new { column = 0, value = (string?)"3" }, new { column = 1, value = (string?)null } } } };
        var preview = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits/preview"), new { resultID, changes }), HttpStatusCode.OK);
        Assert.That(preview.GetProperty("statements").EnumerateArray().Select(statement => statement.GetProperty("sql").GetString()), Is.EqualTo(new[] { $"UPDATE {Pedido} SET \"status\" = 'paga' WHERE \"id\" = 1", $"INSERT INTO {Pedido} (\"id\", \"status\") VALUES (3, NULL)" }));
        Assert.That(preview.GetProperty("statements").EnumerateArray().Select(statement => statement.GetProperty("values").GetArrayLength()), Is.All.Zero);
        Assert.That(preview.GetProperty("oneAtATime").GetBoolean(), Is.False);

        var saved = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes }), HttpStatusCode.OK);
        Assert.That(saved.ToString(), Is.EqualTo("""{"applied":2}"""));

        var rows = (await host.Client.ExecuteAsync(session, $"SELECT id, status FROM {Pedido} ORDER BY 1")).GetProperty("rows").ToString();
        Assert.That(rows, Is.EqualTo("""[["1","paga"],["2","aberta"],["3",null]]"""));
    }

    [Test]
    public async Task Edits_RefusalsCarryTheCodeAndTheExtensionsOfSection22()
    {
        await using var host = await ApiHost.StartAsync();
        var session = await StartSessionAsync(host);
        var resultID = (await host.Client.ExecuteAsync(session, $"SELECT * FROM {Pedido}\nORDER BY 1")).GetProperty("resultID").GetGuid();
        await host.Client.PostAsJsonAsync(Url(session, "/queries/edit-target"), new { resultID });

        var mismatch = await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes = new object[] { new { kind = "delete", table = 0, key = new[] { "999" } } } }), HttpStatusCode.UnprocessableEntity, "EDIT_ROW_MISMATCH");
        Assert.That((mismatch.GetProperty("change").GetInt32(), mismatch.GetProperty("rowsAffected").GetInt64()), Is.EqualTo((0, 0L)));

        var invalid = await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes = new object[] { new { kind = "update", table = 0, key = new[] { "1" }, set = new[] { new { column = 2, value = "4" } } } } }), HttpStatusCode.UnprocessableEntity, "EDIT_INVALID");
        Assert.That((invalid.GetProperty("change").GetInt32(), invalid.GetProperty("column").GetInt32()), Is.EqualTo((0, 2)));

        var failed = await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes = new object[] { new { kind = "insert", table = 0, values = new[] { new { column = 0, value = "1" } } } } }), HttpStatusCode.UnprocessableEntity, "SQL_EXECUTION_FAILED");
        Assert.That((failed.GetProperty("change").GetInt32(), failed.GetProperty("sqlState").GetString()), Is.EqualTo((0, "23505")));
        Assert.That(failed.GetProperty("detail").GetString(), Does.StartWith("duplicate key value violates unique constraint"));

        await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes = Array.Empty<object>() }), HttpStatusCode.UnprocessableEntity, "EDIT_INVALID");

        var union = (await host.Client.ExecuteAsync(session, $"SELECT id FROM {Pedido} UNION SELECT 1")).GetProperty("resultID").GetGuid();
        var readOnly = await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edit-target"), new { resultID = union }), HttpStatusCode.UnprocessableEntity, "RESULT_NOT_EDITABLE");
        Assert.That(readOnly.GetProperty("reason").GetString(), Is.EqualTo("união de consultas"));

        await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes = new object[] { new { kind = "delete", table = 0, key = new[] { "1" } } } }), HttpStatusCode.Conflict, "RESULT_CHANGED");
        await ProblemAsync(await host.Client.PostAsJsonAsync(Url(Guid.NewGuid(), "/queries/edit-target"), new { resultID }), HttpStatusCode.NotFound, "DATABASE_SESSION_NOT_FOUND");
    }

    private async Task<Guid> StartSessionAsync(ApiHost host)
    {
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        return await host.Client.OpenSessionAsync(await host.Client.CreateConnectionAsync(_settings));
    }

    private static string Url(Guid sessionID, string tail)
        => $"{PrismCalls.SessionsPath}/{sessionID}{tail}";

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response, HttpStatusCode status)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(response.StatusCode, Is.EqualTo(status), body.ToString());

        return body;
    }

    private static async Task<JsonElement> ProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await ReadAsync(response, status);
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type), body.ToString());

        return body;
    }
}
