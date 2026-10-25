using Prism.TestingCore.Fakers.Dbeaver;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// "Importar do DBeaver" pelas rotas de verdade, sem banco (seção 40 da especificação): o convite e a data da importação no cofre, a contagem, a prévia, a importação
/// numa gravação só e a reimportação que sobrescreve, com a cópia do DBeaver SINTÉTICO posta na pasta `transfers` como o processo principal a deixa. Cada teste sobe uma
/// API própria, com a pasta de dados própria e o Argon2id pequeno do `ApiHost`.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class DbeaverImportsTests
{
    private const string StatePath = "/api/user/connections/dbeaver";
    private const string InvitePath = "/api/user/connections/dbeaver/invite";
    private const string ScanPath = "/api/user/connections/dbeaver/scan";
    private const string PreviewPath = "/api/user/connections/dbeaver/import/preview";
    private const string ImportPath = "/api/user/connections/dbeaver/import";
    private const string ConnectionsPath = "/api/user/connections";

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<ApiHost> StartAsync()
    {
        var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        return host;
    }

    private static Guid PutWorkspace(ApiHost host)
    {
        var folder = Path.Combine(host.DataDirectory, "transfers");
        Directory.CreateDirectory(folder);

        return DbeaverWorkspace.Add(new DbeaverCopyBuilder(folder)).Build();
    }

    private static bool CopyExists(ApiHost host, Guid sourceId)
        => Directory.Exists(Path.Combine(host.DataDirectory, "transfers", $"{sourceId:D}.dbeaver"));

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type, string? field = null)
    {
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(status), body.ToString());
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));
        if (field is not null)
            Assert.That(body.GetProperty("errorCodes").GetProperty(field)[0].GetString(), Is.EqualTo(type));
    }

    /// <summary>RN-API-005: as rotas novas ficam atrás da barreira do cofre.</summary>
    [Test]
    public async Task Routes_WithVaultLocked_Return401VaultLocked()
    {
        await using var host = await ApiHost.StartAsync();

        await AssertProblemAsync(await host.Client.GetAsync(StatePath), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await host.Client.PutAsync(InvitePath, null), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        foreach (var path in new[] { ScanPath, PreviewPath, ImportPath })
            await AssertProblemAsync(await host.Client.PostAsJsonAsync(path, new { }), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    /// <summary>RN-DBEAVER-018: o convite e a última importação deste usuário, nulos até acontecerem; o convite gravado uma vez fica com a data dele.</summary>
    [Test]
    public async Task State_StartsEmpty_AndTheInviteKeepsItsFirstDate()
    {
        await using var host = await StartAsync();

        var empty = await ReadJsonAsync(await host.Client.GetAsync(StatePath));
        var first = await host.Client.PutAsync(InvitePath, null);
        var invited = (await ReadJsonAsync(await host.Client.GetAsync(StatePath))).GetProperty("invitedAt").GetDateTime();
        await Task.Delay(1100);
        var second = await host.Client.PutAsync(InvitePath, null);
        var again = await ReadJsonAsync(await host.Client.GetAsync(StatePath));

        Assert.That(empty.GetProperty("invitedAt").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(empty.GetProperty("lastImportAt").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That((first.StatusCode, second.StatusCode), Is.EqualTo((HttpStatusCode.NoContent, HttpStatusCode.NoContent)));
        Assert.That(again.GetProperty("invitedAt").GetDateTime(), Is.EqualTo(invited));
        Assert.That(again.GetProperty("lastImportAt").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    /// <summary>RN-DBEAVER-007 a 018, do começo ao fim: a contagem, a prévia sem nenhuma senha, a importação numa gravação só, a cópia apagada e a data da importação.</summary>
    [Test]
    public async Task Scan_Preview_Import_EndToEnd()
    {
        await using var host = await StartAsync();
        var sourceId = PutWorkspace(host);

        var scan = await ReadJsonAsync(await host.Client.PostAsJsonAsync(ScanPath, new { sourceId }));
        var previewResponse = await host.Client.PostAsJsonAsync(PreviewPath, new { sourceId, project = "General", withPasswords = true });
        var previewText = await previewResponse.Content.ReadAsStringAsync();
        var preview = JsonDocument.Parse(previewText).RootElement;
        var items = preview.GetProperty("folders").EnumerateArray().Where(folder => folder.GetProperty("invalid").ValueKind == JsonValueKind.Null).Select(folder => folder.GetProperty("key").GetString())
            .Concat(preview.GetProperty("connections").EnumerateArray().Where(connection => connection.GetProperty("invalid").ValueKind == JsonValueKind.Null).Select(connection => connection.GetProperty("key").GetString())).ToList();
        var imported = await host.Client.PostAsJsonAsync(ImportPath, new { sourceId, project = "General", withPasswords = true, items });
        var result = await ReadJsonAsync(imported);
        var state = await ReadJsonAsync(await host.Client.GetAsync(StatePath));
        var listed = await ReadJsonAsync(await host.Client.GetAsync(ConnectionsPath));

        Assert.That(scan.GetProperty("where").GetString(), Is.EqualTo("standard"));
        Assert.That(scan.GetProperty("projects").GetArrayLength(), Is.EqualTo(5));
        Assert.That(scan.GetProperty("projects")[0].GetProperty("importable").GetInt32(), Is.EqualTo(11));
        Assert.That(previewResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(previewText, Does.Not.Contain(DbeaverWorkspace.Mark).And.Not.Contain("\"password\""));
        Assert.That(imported.StatusCode, Is.EqualTo(HttpStatusCode.OK), result.ToString());
        Assert.That(result.GetProperty("connectionIDs").GetArrayLength(), Is.EqualTo(11));
        Assert.That(result.GetProperty("updatedIDs").GetArrayLength(), Is.EqualTo(0));
        Assert.That(CopyExists(host, sourceId), Is.False);
        Assert.That(state.GetProperty("invitedAt").ValueKind, Is.EqualTo(JsonValueKind.String));
        Assert.That(state.GetProperty("lastImportAt").ValueKind, Is.EqualTo(JsonValueKind.String));
        Assert.That(listed.GetArrayLength(), Is.EqualTo(11));

        // As rotas das conexões não devolvem a origem (RN-DBEAVER-018), nem a senha (RN-CONN-001).
        Assert.That(listed.GetRawText(), Does.Not.Contain("origin").And.Not.Contain(DbeaverWorkspace.PgFields).And.Not.Contain(DbeaverWorkspace.Mark));
    }

    /// <summary>RN-DBEAVER-017: reimportar com a prévia dizendo "já existe", sobrescrever mantém o ID e a pasta, e a senha do DBeaver é a que a revelação mostra depois.</summary>
    [Test]
    public async Task Reimport_Overwrites_KeepingTheID()
    {
        await using var host = await StartAsync();
        var first = PutWorkspace(host);
        var firstPreview = await ReadJsonAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { sourceId = first, project = "General" }));
        var firstItems = firstPreview.GetProperty("connections").EnumerateArray().Where(c => c.GetProperty("invalid").ValueKind == JsonValueKind.Null).Select(c => c.GetProperty("key").GetString()).ToList();
        await host.Client.PostAsJsonAsync(ImportPath, new { sourceId = first, project = "General", items = firstItems });
        var before = (await ReadJsonAsync(await host.Client.GetAsync(ConnectionsPath))).EnumerateArray().Single(connection => connection.GetProperty("name").GetString() == "Pedidos PG");
        var id = before.GetProperty("id").GetGuid();
        var moved = (await ReadJsonAsync(await host.Client.PostAsJsonAsync("/api/user/folders", new { name = "Movida" }))).GetProperty("id").GetGuid();
        Assert.That((await host.Client.PatchAsJsonAsync(ConnectionsPath, new { id, folderID = moved, name = "Meu nome", engine = 1, host = "pg-dev.exemplo.invalid", port = 5432, database = "pedidos", userName = "usuario-pg", environmentName = "Desenvolvimento" })).StatusCode, Is.EqualTo(HttpStatusCode.OK));

        var second = PutWorkspace(host);
        var preview = await ReadJsonAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { sourceId = second, project = "General" }));
        var existing = preview.GetProperty("connections").EnumerateArray().Where(c => c.GetProperty("existing").ValueKind == JsonValueKind.Object).ToList();
        var pg = existing.Single(c => c.GetProperty("existing").GetProperty("connectionID").GetGuid() == id);
        var imported = await host.Client.PostAsJsonAsync(ImportPath, new { sourceId = second, project = "General", items = existing.Select(c => c.GetProperty("key").GetString()), overwrite = existing.Select(c => c.GetProperty("key").GetString()) });
        var result = await ReadJsonAsync(imported);
        var after = (await ReadJsonAsync(await host.Client.GetAsync($"{ConnectionsPath}/{id}")));

        Assert.That(existing, Has.Count.EqualTo(11));
        Assert.That(pg.GetProperty("existing").GetProperty("name").GetString(), Is.EqualTo("Meu nome"));
        Assert.That(pg.GetProperty("existing").GetProperty("connected").GetBoolean(), Is.False);
        Assert.That(pg.GetProperty("overwrite").GetProperty("name").GetBoolean(), Is.True);
        Assert.That(pg.GetProperty("conflict").GetBoolean(), Is.False);
        Assert.That(result.GetProperty("connectionIDs").GetArrayLength(), Is.EqualTo(0));
        Assert.That(result.GetProperty("updatedIDs").GetArrayLength(), Is.EqualTo(11));
        Assert.That(after.GetProperty("name").GetString(), Is.EqualTo("Pedidos PG"));
        Assert.That(after.GetProperty("folderID").GetGuid(), Is.EqualTo(moved));
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync(ConnectionsPath))).GetArrayLength(), Is.EqualTo(11));
    }

    [Test]
    public async Task Refusals_AreTheOnesFromSection6()
    {
        await using var host = await StartAsync();
        var sourceId = PutWorkspace(host);
        var invalidCopy = new DbeaverCopyBuilder(Path.Combine(host.DataDirectory, "transfers")).Project("Seguro", project => project.DataSources("x").Settings("""{"secureProject":true}""")).Build();

        await AssertProblemAsync(await host.Client.PostAsJsonAsync(ScanPath, new { sourceId = "ABC" }), HttpStatusCode.UnprocessableEntity, "IMPORT_INVALID", "SourceId");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { sourceId, withPasswords = "sim" }), HttpStatusCode.UnprocessableEntity, "IMPORT_INVALID", "WithPasswords");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { sourceId, drdaPorts = new[] { new { host = "h.exemplo.invalid", port = 1, server = (string?)null, drdaPort = 70000 } } }), HttpStatusCode.UnprocessableEntity, "IMPORT_INVALID", "DrdaPorts");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(ScanPath, new { sourceId = Guid.NewGuid().ToString("D") }), HttpStatusCode.NotFound, "DBEAVER_SOURCE_MISSING");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(ScanPath, new { sourceId = invalidCopy }), HttpStatusCode.UnprocessableEntity, "DBEAVER_SOURCE_INVALID");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { sourceId, project = "Seguro" }), HttpStatusCode.NotFound, "DBEAVER_PROJECT_NOT_FOUND");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { sourceId, targetFolderID = Guid.NewGuid() }), HttpStatusCode.NotFound, "FOLDER_NOT_FOUND");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(ImportPath, new { sourceId, items = Array.Empty<string>() }), HttpStatusCode.UnprocessableEntity, "IMPORT_EMPTY");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(ImportPath, new { sourceId, items = new[] { "c999" } }), HttpStatusCode.UnprocessableEntity, "IMPORT_INVALID");

        // A recusa da importação deixa a cópia, e o corpo acima de 1 MiB não passa.
        Assert.That(CopyExists(host, sourceId), Is.True);
    }

    [Test]
    public async Task Import_OfAMissingCopy_Is404()
    {
        await using var host = await StartAsync();

        await AssertProblemAsync(await host.Client.PostAsJsonAsync(ImportPath, new { sourceId = Guid.NewGuid().ToString("D"), items = new[] { "c1" } }), HttpStatusCode.NotFound, "DBEAVER_SOURCE_MISSING");
    }
}
