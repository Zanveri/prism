using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// RN-VAR-028, pela API de verdade: `PUT api/user/scripts/{id}/run-values` grava os valores lembrados no cofre, cifrados com o script; o `GET` do item os devolve em
/// `runValues`; o `PATCH` não os esquece; o mapa vazio sem conexão os esquece; excluir o script os exclui; as recusas vêm na forma do erro de campo; e a lista traz
/// o `declaresVariables`. Cada teste sobe uma API própria, com a pasta de dados própria.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class ScriptRunValuesTests
{
    private const string ScriptsPath = "/api/user/scripts";
    private const string UserName = "marina.costa";

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<ApiHost> StartWithUserAsync(string? password = null)
    {
        var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, password ?? UserFakers.RandomPassword());

        return host;
    }

    private static async Task<Guid> CreateAsync(ApiHost host, string name, string sql = "let x = 1\nSELECT @x")
    {
        var response = await host.Client.PostAsJsonAsync(ScriptsPath, new { name, sql });
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created), await response.Content.ReadAsStringAsync());

        return (await ReadJsonAsync(response)).GetProperty("id").GetGuid();
    }

    /// <summary>O corpo vai como a tela o manda: o texto do `JSON.stringify`, sem espaços.</summary>
    private static Task<HttpResponseMessage> PutAsync(ApiHost host, Guid id, string body)
        => host.Client.PutAsync($"{ScriptsPath}/{id}/run-values", new StringContent(body, Encoding.UTF8, "application/json"));

    private static async Task<JsonElement> GetAsync(ApiHost host, Guid id)
    {
        var response = await host.Client.GetAsync($"{ScriptsPath}/{id}");
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));

        return await ReadJsonAsync(response);
    }

    private static async Task<JsonElement> AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(status), body.ToString());
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));

        return body;
    }

    [Test]
    public async Task Put_Returns204_AndTheItemHasTheRunValues_WithoutChangingTheScript()
    {
        await using var host = await StartWithUserAsync();
        var id = await CreateAsync(host, "Relatório");
        var before = await GetAsync(host, id);
        Assert.That(before.GetProperty("runValues").ValueKind, Is.EqualTo(JsonValueKind.Null));
        var values = """{"x":{"type":"number","value":"7"},"status":{"type":"list","items":[{"type":"text","value":"aberta"},{"type":"null","value":null}]},"ordem":{"type":"sql","value":"nome DESC"}}""";
        var started = DateTime.UtcNow.AddSeconds(-1);

        var response = await PutAsync(host, id, $$"""{"values":{{values}}}""");

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent), await response.Content.ReadAsStringAsync());
        var after = await GetAsync(host, id);
        var runValues = after.GetProperty("runValues");
        Assert.That(runValues.EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "values", "connectionID", "database", "savedAt" }));
        Assert.That(runValues.GetProperty("values").GetRawText(), Is.EqualTo(values));
        Assert.That(runValues.GetProperty("connectionID").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(runValues.GetProperty("database").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(runValues.GetProperty("savedAt").GetString(), Does.EndWith("Z"));
        Assert.That(runValues.GetProperty("savedAt").GetDateTime().ToUniversalTime(), Is.GreaterThan(started));
        Assert.That(after.GetProperty("updatedAt").GetDateTime(), Is.EqualTo(before.GetProperty("updatedAt").GetDateTime()));
        Assert.That(after.GetProperty("sql").GetString(), Is.EqualTo("let x = 1\nSELECT @x"));
    }

    [Test]
    public async Task Put_TheGenericScriptRemembersTheConnection_AndTheDatabaseOnlyComesWithIt()
    {
        await using var host = await StartWithUserAsync();
        var id = await CreateAsync(host, "Relatório");
        var connectionID = Guid.CreateVersion7();

        Assert.That((await PutAsync(host, id, $$"""{"values":{},"connectionID":"{{connectionID}}","database":"vendas"}""")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        var withConnection = (await GetAsync(host, id)).GetProperty("runValues");
        Assert.That(withConnection.GetProperty("connectionID").GetGuid(), Is.EqualTo(connectionID));
        Assert.That(withConnection.GetProperty("database").GetString(), Is.EqualTo("vendas"));

        Assert.That((await PutAsync(host, id, """{"values":{"x":{"type":"text","value":"a"}},"database":"vendas"}""")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That((await GetAsync(host, id)).GetProperty("runValues").GetProperty("database").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    [Test]
    public async Task Patch_KeepsTheRunValues_AndTheEmptyMapForgetsThem()
    {
        await using var host = await StartWithUserAsync();
        var id = await CreateAsync(host, "Relatório");
        var values = """{"x":{"type":"number","value":"7"}}""";
        Assert.That((await PutAsync(host, id, $$"""{"values":{{values}}}""")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        var patched = await host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, ScriptsPath) { Content = JsonContent.Create(new { id, name = "Fechamento", sql = "let y = 2\nSELECT @y" }) });
        Assert.That(patched.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await GetAsync(host, id)).GetProperty("runValues").GetProperty("values").GetRawText(), Is.EqualTo(values));

        Assert.That((await PutAsync(host, id, """{"values":{}}""")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That((await GetAsync(host, id)).GetProperty("runValues").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    [Test]
    public async Task Put_Refusals_ComeOnTheField()
    {
        await using var host = await StartWithUserAsync();
        var id = await CreateAsync(host, "Relatório");

        var badType = await AssertProblemAsync(await PutAsync(host, id, """{"values":{"x":{"type":"integer","value":"7"}}}"""), HttpStatusCode.UnprocessableEntity, "SCRIPT_RUN_VALUES_INVALID");
        Assert.That(badType.GetProperty("errors").GetProperty("values.x.type")[0].GetString(), Is.EqualTo("O tipo é number, text, boolean, date, timestamp, sql, null ou list."));
        Assert.That(badType.GetProperty("errorCodes").GetProperty("values.x.type")[0].GetString(), Is.EqualTo("SCRIPT_RUN_VALUES_INVALID"));

        var proto = await AssertProblemAsync(await PutAsync(host, id, """{"values":{"__proto__":{"type":"text","value":"a"},"constructor":{"type":"text","value":"b"}}}"""), HttpStatusCode.UnprocessableEntity, "SCRIPT_RUN_VALUES_INVALID");
        Assert.That(proto.GetProperty("errors").EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "values" }));

        await AssertProblemAsync(await PutAsync(host, id, """{"values":{"l":{"type":"list","items":[{"type":"list","items":[]}]}}}"""), HttpStatusCode.UnprocessableEntity, "SCRIPT_RUN_VALUES_INVALID");
        await AssertProblemAsync(await PutAsync(host, id, """{"connectionID":null}"""), HttpStatusCode.UnprocessableEntity, "SCRIPT_RUN_VALUES_INVALID");
        var tooLarge = "{\"values\":{\"x\":{\"type\":\"text\",\"value\":\"" + new string('a', 64 * 1024) + "\"}}}";
        await AssertProblemAsync(await PutAsync(host, id, tooLarge), HttpStatusCode.UnprocessableEntity, "SCRIPT_RUN_VALUES_INVALID");

        Assert.That((await GetAsync(host, id)).GetProperty("runValues").ValueKind, Is.EqualTo(JsonValueKind.Null));
        await AssertProblemAsync(await PutAsync(host, Guid.CreateVersion7(), """{"values":{}}"""), HttpStatusCode.NotFound, "SCRIPT_NOT_FOUND");
    }

    /// <summary>RN-SCRIPT-002: os valores lembrados vão cifrados com o script, e saem com ele; com o cofre fechado, a rota responde 401 como as demais.</summary>
    [Test]
    public async Task TheValuesAreNotInTheClear_TheDeleteRemovesThem_AndTheClosedVaultIs401()
    {
        var password = UserFakers.RandomPassword();
        await using var host = await StartWithUserAsync(password);
        var id = await CreateAsync(host, "Relatório");
        var mark = Guid.NewGuid().ToString("N");
        Assert.That((await PutAsync(host, id, "{\"values\":{\"cpf\":{\"type\":\"text\",\"value\":\"valor-" + mark + "\"}}}")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();
        foreach (var path in Directory.GetFiles(Path.Combine(host.DataDirectory, "vaults")))
            Assert.That(await File.ReadAllTextAsync(path), Does.Not.Contain(mark), $"{Path.GetFileName(path)} tem o valor lembrado em claro.");
        await AssertProblemAsync(await PutAsync(host, id, """{"values":{}}"""), HttpStatusCode.Unauthorized, "VAULT_LOCKED");

        (await host.Client.PostAsJsonAsync("/api/public/sessions", new { userName = UserName, password })).EnsureSuccessStatusCode();
        Assert.That((await GetAsync(host, id)).GetProperty("runValues").GetProperty("values").GetProperty("cpf").GetProperty("value").GetString(), Is.EqualTo($"valor-{mark}"));

        Assert.That((await host.Client.DeleteAsync($"{ScriptsPath}/{id}")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        await AssertProblemAsync(await PutAsync(host, id, """{"values":{}}"""), HttpStatusCode.NotFound, "SCRIPT_NOT_FOUND");
    }

    [Test]
    public async Task List_HasDeclaresVariables_FromTheSql()
    {
        await using var host = await StartWithUserAsync();
        await CreateAsync(host, "A com variáveis", "-- filtro\nconst ids = [1, 2]\nSELECT * FROM t WHERE id IN (@ids)");
        await CreateAsync(host, "B sem variáveis", "SELECT 1;\nlet x = 1");

        var response = await host.Client.GetAsync(ScriptsPath);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var list = (await ReadJsonAsync(response)).EnumerateArray().ToList();
        Assert.That(list.Select(script => script.GetProperty("declaresVariables").GetBoolean()), Is.EqualTo(new[] { true, false }));
    }
}
