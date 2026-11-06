using Prism.IntegrationTesting.Api.Support;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// Os modelos do Construir (<c>api/user/build-models</c>, seção 7 da especificação): criar, listar com o corpo, ler por ID, renomear, controle de
/// concorrência por <c>expectedUpdatedAt</c> (409 <c>BUILD_MODEL_CHANGED</c>), excluir, cofre bloqueado (401 <c>VAULT_LOCKED</c>) e log sem vazar o corpo.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class BuildModelsTests
{
    private const string BuildModelsPath = "/api/user/build-models";
    private const string UserName = "marina.costa";

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

    private static async Task<ApiHost> StartWithUserAsync()
    {
        var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());

        return host;
    }

    [Test]
    public async Task CrudAndConcurrency_WorkAsSpecified()
    {
        await using var host = await StartWithUserAsync();
        const string initialBody = """{"version":1,"engine":"postgresql","tables":[]}""";

        // Criar (201) com o corpo na resposta.
        var createdResponse = await host.Client.PostAsJsonAsync(BuildModelsPath, new { name = "  manutencao  ", body = initialBody });
        Assert.That(createdResponse.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        var created = await ReadJsonAsync(createdResponse);
        var id = created.GetProperty("id").GetGuid();
        var updatedAt = created.GetProperty("updatedAt").GetString()!;
        Assert.That(created.EnumerateObject().Select(p => p.Name), Is.EqualTo(new[] { "id", "name", "body", "createdAt", "updatedAt" }));
        Assert.That(created.GetProperty("name").GetString(), Is.EqualTo("manutencao"));
        Assert.That(created.GetProperty("body").GetString(), Is.EqualTo(initialBody));

        // Listar (200) traz o corpo.
        var listResponse = await host.Client.GetAsync(BuildModelsPath);
        Assert.That(listResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var listed = (await ReadJsonAsync(listResponse)).EnumerateArray().ToList();
        Assert.That(listed, Has.Count.EqualTo(1));
        Assert.That(listed[0].GetProperty("body").GetString(), Is.EqualTo(initialBody));

        // Ler por id (200).
        var getResponse = await host.Client.GetAsync($"{BuildModelsPath}/{id}");
        Assert.That(getResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await ReadJsonAsync(getResponse)).GetProperty("name").GetString(), Is.EqualTo("manutencao"));

        // PATCH com expectedUpdatedAt atual: renomeia e atualiza o corpo.
        const string nextBody = """{"version":1,"engine":"db2","tables":[]}""";
        var patchResponse = await host.Client.PatchAsJsonAsync($"{BuildModelsPath}/{id}", new { name = "manutencao_industrial", body = nextBody, expectedUpdatedAt = updatedAt });
        Assert.That(patchResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var patched = await ReadJsonAsync(patchResponse);
        Assert.That(patched.GetProperty("name").GetString(), Is.EqualTo("manutencao_industrial"));
        Assert.That(patched.GetProperty("body").GetString(), Is.EqualTo(nextBody));

        // PATCH com expectedUpdatedAt antigo -> 409 BUILD_MODEL_CHANGED.
        var staleResponse = await host.Client.PatchAsJsonAsync($"{BuildModelsPath}/{id}", new { body = initialBody, expectedUpdatedAt = DateTime.UtcNow.AddDays(-1) });
        await AssertProblemAsync(staleResponse, HttpStatusCode.Conflict, "BUILD_MODEL_CHANGED");

        // Excluir -> 204 e depois 404 BUILD_MODEL_NOT_FOUND.
        var deleteResponse = await host.Client.DeleteAsync($"{BuildModelsPath}/{id}");
        Assert.That(deleteResponse.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        await AssertProblemAsync(await host.Client.GetAsync($"{BuildModelsPath}/{id}"), HttpStatusCode.NotFound, "BUILD_MODEL_NOT_FOUND");
    }

    [Test]
    public async Task LockedVault_Returns401VaultLocked()
    {
        await using var host = await StartWithUserAsync();
        (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();

        await AssertProblemAsync(await host.Client.GetAsync(BuildModelsPath), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    [Test]
    public async Task Logs_DoNotContainTheModelBody()
    {
        var run = Guid.NewGuid().ToString("N")[..8];
        var markedBody = $$"""{"version":1,"marker":"MODELO-MARCADO-{{run}}"}""";

        using var parent = ApiProcess.StartParentStandIn();
        using var api = await ApiProcess.StartAsync(parentProcessID: parent.Id);
        await api.Client.CreateUserAsync(UserName, $"senha-{run}-forte");

        var created = await api.Client.PostAsJsonAsync(BuildModelsPath, new { name = "manutencao", body = markedBody });
        Assert.That(created.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        var createdElement = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = createdElement.GetProperty("id").GetGuid();
        var updatedAt = createdElement.GetProperty("updatedAt").GetString()!;

        Assert.That((await api.Client.GetAsync(BuildModelsPath)).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await api.Client.GetAsync($"{BuildModelsPath}/{id}")).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await api.Client.PatchAsJsonAsync($"{BuildModelsPath}/{id}", new { body = markedBody, expectedUpdatedAt = updatedAt })).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await api.Client.DeleteAsync($"{BuildModelsPath}/{id}")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        Assert.That(await ApiProcess.StopThroughParentAsync(parent, api, TimeSpan.FromSeconds(15)), Is.Zero);
        var logs = api.ReadLogs();
        Assert.That(logs, Is.Not.Empty);
        foreach (var (file, log) in logs)
            Assert.That(log, Does.Not.Contain("MODELO-MARCADO"), $"{file} contém o corpo de um modelo.");
    }
}
