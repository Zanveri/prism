using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// Os scripts salvos do usuário (`api/user/scripts`, seção 23: RN-SCRIPT-001 a 004), pela API de verdade: as rotas da tabela, com as recusas dela, o cofre
/// fechado (RN-API-005), o arquivo do cofre sem o SQL em claro (RN-SCRIPT-002) e o cofre do formato 1 migrado na entrada (RN-VERSAO-005). Cada teste sobe uma
/// API própria, com a pasta de dados própria.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class ScriptsTests
{
    private const string ScriptsPath = "/api/user/scripts";
    private const string UserName = "marina.costa";
    private const int OneMegabyte = 1024 * 1024;

    /// <summary>
    /// A senha do cofre de exemplo do formato 1 (`Prism.UnitTesting/Vault/Samples/vault-format-1.json`): uma constante fictícia, de um cofre com dados
    /// inventados, a mesma do `VaultFormatOneSampleTests`. Não protege nada de ninguém.
    /// </summary>
    private const string SamplePassword = "senha-ficticia-do-cofre-de-exemplo";
    private const string SampleUserName = "exemplo.formato1";

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    /// <summary>Confere o problema e devolve o corpo dele (o conteúdo da resposta só se lê uma vez).</summary>
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

    private static Task<HttpResponseMessage> PostAsync(ApiHost host, string name, string sql, Guid? connectionID = null, string? database = null)
        => host.Client.PostAsJsonAsync(ScriptsPath, new { name, sql, connectionID, database });

    /// <summary>Cria pela rota e confere o 201: um teste que arruma estado não segue adiante com uma criação recusada.</summary>
    private static async Task<Guid> CreateAsync(ApiHost host, string name, string sql = "SELECT 1", Guid? connectionID = null, string? database = null)
    {
        var response = await PostAsync(host, name, sql, connectionID, database);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created), await response.Content.ReadAsStringAsync());

        return (await ReadJsonAsync(response)).GetProperty("id").GetGuid();
    }

    private static Task<HttpResponseMessage> PatchAsync(ApiHost host, object body)
        => host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, ScriptsPath) { Content = JsonContent.Create(body) });

    private static async Task<JsonElement> GetAsync(ApiHost host, Guid id)
    {
        var response = await host.Client.GetAsync($"{ScriptsPath}/{id}");
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));

        return await ReadJsonAsync(response);
    }

    private static async Task<List<JsonElement>> ListAsync(ApiHost host)
    {
        var response = await host.Client.GetAsync(ScriptsPath);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));

        return (await ReadJsonAsync(response)).EnumerateArray().ToList();
    }

    private static string VaultPath(ApiHost host, string userName)
        => Path.Combine(host.DataDirectory, "vaults", $"{userName}.vault.json");

    [Test]
    public async Task Create_Returns201_AndTheListHasItWithoutTheSql()
    {
        await using var host = await StartWithUserAsync();
        var connectionID = Guid.CreateVersion7();

        // Espaços sobrando no nome: ele é gravado normalizado; o SQL fica como veio.
        var response = await PostAsync(host, "  Fechamento   do mês ", "SELECT *\n  FROM pedidos;\n", connectionID, "vendas");

        var body = await ReadJsonAsync(response);
        var id = body.GetProperty("id").GetGuid();
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That(response.Headers.Location?.ToString(), Is.EqualTo($"{ScriptsPath}/{id}"));
        Assert.That(body.EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "id", "name", "connectionID", "database", "icon", "color", "updatedAt" }));
        Assert.That(body.GetProperty("name").GetString(), Is.EqualTo("Fechamento do mês"));
        Assert.That(body.GetProperty("connectionID").GetGuid(), Is.EqualTo(connectionID));
        Assert.That(body.GetProperty("database").GetString(), Is.EqualTo("vendas"));
        var listed = await ListAsync(host);
        Assert.That(listed, Has.Count.EqualTo(1));
        Assert.That(listed[0].EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "id", "name", "connectionID", "database", "icon", "color", "updatedAt" }));
        Assert.That(listed[0].GetProperty("id").GetGuid(), Is.EqualTo(id));
    }

    [Test]
    public async Task Get_ReturnsTheSql()
    {
        await using var host = await StartWithUserAsync();
        var id = await CreateAsync(host, "Pedidos", "SELECT *\n  FROM pedidos;\n");

        var body = await GetAsync(host, id);

        Assert.That(body.EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "id", "name", "connectionID", "database", "icon", "color", "sql", "updatedAt" }));
        Assert.That(body.GetProperty("sql").GetString(), Is.EqualTo("SELECT *\n  FROM pedidos;\n"));
        Assert.That(body.GetProperty("connectionID").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(body.GetProperty("database").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    [Test]
    public async Task Get_Missing_Returns404()
    {
        await using var host = await StartWithUserAsync();

        await AssertProblemAsync(await host.Client.GetAsync($"{ScriptsPath}/{Guid.CreateVersion7()}"), HttpStatusCode.NotFound, "SCRIPT_NOT_FOUND");
    }

    [Test]
    public async Task List_IsOrderedByNameIgnoringCase()
    {
        await using var host = await StartWithUserAsync();
        await CreateAsync(host, "beta");
        await CreateAsync(host, "Gama");
        await CreateAsync(host, "Alfa");

        var listed = await ListAsync(host);

        Assert.That(listed.Select(script => script.GetProperty("name").GetString()), Is.EqualTo(new[] { "Alfa", "beta", "Gama" }));
    }

    [Test]
    public async Task Create_NameTakenIgnoringCase_Returns409()
    {
        await using var host = await StartWithUserAsync();
        await CreateAsync(host, "Fechamento do Mês");

        await AssertProblemAsync(await PostAsync(host, "fechamento do mês", "SELECT 2"), HttpStatusCode.Conflict, "SCRIPT_ALREADY_EXISTS");
        Assert.That(await ListAsync(host), Has.Count.EqualTo(1));
    }

    [TestCase("")]
    [TestCase("   ")]
    [TestCase("Fecha\tmento")]
    [TestCase("Fechamento\u0001")]
    public async Task Create_InvalidName_Returns422(string name)
    {
        await using var host = await StartWithUserAsync();

        var body = await AssertProblemAsync(await PostAsync(host, name, "SELECT 1"), HttpStatusCode.UnprocessableEntity, "SCRIPT_NAME_INVALID");
        Assert.That(body.GetProperty("errors").TryGetProperty("Name", out _), Is.True, body.ToString());
        Assert.That(await ListAsync(host), Is.Empty);
    }

    [Test]
    public async Task Create_NameOf201Characters_Returns422_AndOf200_Returns201()
    {
        await using var host = await StartWithUserAsync();

        await AssertProblemAsync(await PostAsync(host, new string('a', 201), "SELECT 1"), HttpStatusCode.UnprocessableEntity, "SCRIPT_NAME_INVALID");
        await CreateAsync(host, new string('a', 200));
    }

    /// <summary>RN-SCRIPT-004: até 1 MB, em bytes de UTF-8. O de exatamente 1 MB entra, o de um byte a mais não.</summary>
    [Test]
    public async Task Create_SqlOverOneMegabyte_Returns422_AndOfExactlyOneMegabyte_Returns201()
    {
        await using var host = await StartWithUserAsync();

        var body = await AssertProblemAsync(await PostAsync(host, "Grande demais", new string('x', OneMegabyte + 1)), HttpStatusCode.UnprocessableEntity, "SCRIPT_TOO_LARGE");
        Assert.That(body.GetProperty("errors").TryGetProperty("Sql", out _), Is.True);
        var id = await CreateAsync(host, "No limite", new string('x', OneMegabyte));
        Assert.That((await GetAsync(host, id)).GetProperty("sql").GetString(), Has.Length.EqualTo(OneMegabyte));
    }

    [Test]
    public async Task Patch_Rename_KeepsTheSqlAndThePlace()
    {
        await using var host = await StartWithUserAsync();
        var connectionID = Guid.CreateVersion7();
        var id = await CreateAsync(host, "Antes", "SELECT 1", connectionID, "vendas");

        var response = await PatchAsync(host, new { id, name = "Depois" });

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        Assert.That(body.GetProperty("name").GetString(), Is.EqualTo("Depois"));
        var stored = await GetAsync(host, id);
        Assert.That(stored.GetProperty("name").GetString(), Is.EqualTo("Depois"));
        Assert.That(stored.GetProperty("sql").GetString(), Is.EqualTo("SELECT 1"));
        Assert.That(stored.GetProperty("connectionID").GetGuid(), Is.EqualTo(connectionID));
        Assert.That(stored.GetProperty("database").GetString(), Is.EqualTo("vendas"));
    }

    /// <summary>O Ctrl+S de um script que já existe: grava o SQL e o lugar da aba por cima. O banco nulo com a conexão é o banco da conexão.</summary>
    [Test]
    public async Task Patch_SqlAndPlace_OverwritesThem_AndStampsTheDate()
    {
        await using var host = await StartWithUserAsync();
        var id = await CreateAsync(host, "Relatório", "SELECT 1", Guid.CreateVersion7(), "vendas");
        var createdAt = (await GetAsync(host, id)).GetProperty("updatedAt").GetDateTime();
        var otherConnection = Guid.CreateVersion7();

        var response = await PatchAsync(host, new { id, sql = "SELECT 2", connectionID = otherConnection, database = (string?)null });

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var stored = await GetAsync(host, id);
        Assert.That(stored.GetProperty("name").GetString(), Is.EqualTo("Relatório"));
        Assert.That(stored.GetProperty("sql").GetString(), Is.EqualTo("SELECT 2"));
        Assert.That(stored.GetProperty("connectionID").GetGuid(), Is.EqualTo(otherConnection));
        Assert.That(stored.GetProperty("database").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(stored.GetProperty("updatedAt").GetDateTime(), Is.GreaterThanOrEqualTo(createdAt));
    }

    /// <summary>RN-SCRIPT-005: `generic: true` tira o lugar do script (a ausência da conexão não tira: o ausente fica), e o SQL enviado junto é gravado.</summary>
    [Test]
    public async Task Patch_Generic_ClearsThePlace_AndTheAbsentConnectionKeepsIt()
    {
        await using var host = await StartWithUserAsync();
        var connectionID = Guid.CreateVersion7();
        var id = await CreateAsync(host, "Relatório", "SELECT 1", connectionID, "vendas");

        var kept = await PatchAsync(host, new { id, sql = "SELECT 2" });
        Assert.That(kept.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await GetAsync(host, id)).GetProperty("connectionID").GetGuid(), Is.EqualTo(connectionID));

        var response = await PatchAsync(host, new { id, sql = "SELECT 3", generic = true });

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        Assert.That(body.GetProperty("connectionID").ValueKind, Is.EqualTo(JsonValueKind.Null));
        var stored = await GetAsync(host, id);
        Assert.That(stored.GetProperty("sql").GetString(), Is.EqualTo("SELECT 3"));
        Assert.That(stored.GetProperty("connectionID").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(stored.GetProperty("database").ValueKind, Is.EqualTo(JsonValueKind.Null));

        // Vincular de novo é mandar o lugar, como o Ctrl+S de uma aba com conexão.
        Assert.That((await PatchAsync(host, new { id, connectionID, database = "vendas" })).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await GetAsync(host, id)).GetProperty("database").GetString(), Is.EqualTo("vendas"));
    }

    [Test]
    public async Task Patch_GenericWithAPlace_Returns422_AndChangesNothing()
    {
        await using var host = await StartWithUserAsync();
        var connectionID = Guid.CreateVersion7();
        var id = await CreateAsync(host, "Relatório", "SELECT 1", connectionID, "vendas");

        await AssertProblemAsync(await PatchAsync(host, new { id, generic = true, connectionID = Guid.CreateVersion7() }), HttpStatusCode.UnprocessableEntity, "SCRIPT_PLACE_INVALID");
        await AssertProblemAsync(await PatchAsync(host, new { id, generic = true, database = "outro" }), HttpStatusCode.UnprocessableEntity, "SCRIPT_PLACE_INVALID");
        var stored = await GetAsync(host, id);
        Assert.That(stored.GetProperty("connectionID").GetGuid(), Is.EqualTo(connectionID));
        Assert.That(stored.GetProperty("database").GetString(), Is.EqualTo("vendas"));
    }

    /// <summary>
    /// RN-SCRIPT-006: o "Editar script…" grava o ícone e a cor pelo `PATCH`, e a lista e o item os devolvem; o ausente fica, a cor vazia a tira e o ícone
    /// `document` (o padrão) volta a nulo. O script novo nasce com os dois nulos, e o lugar e o SQL não mudam.
    /// </summary>
    [Test]
    public async Task Patch_IconAndColor_AreSavedListedAndCleared()
    {
        await using var host = await StartWithUserAsync();
        var connectionID = Guid.CreateVersion7();
        var id = await CreateAsync(host, "Relatório", "SELECT 1", connectionID, "vendas");
        var created = await GetAsync(host, id);

        var response = await PatchAsync(host, new { id, name = "Relatório", icon = "chart", color = " #F2B644 " });
        var body = await ReadJsonAsync(response);
        var listed = (await ListAsync(host)).Single();
        var renamed = await ReadJsonAsync(await PatchAsync(host, new { id, name = "Relatório mensal" }));
        var cleared = await ReadJsonAsync(await PatchAsync(host, new { id, icon = "document", color = "" }));
        var stored = await GetAsync(host, id);

        Assert.That(created.GetProperty("icon").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(created.GetProperty("color").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        Assert.That((body.GetProperty("icon").GetString(), body.GetProperty("color").GetString()), Is.EqualTo(("chart", "#F2B644")));
        Assert.That((listed.GetProperty("icon").GetString(), listed.GetProperty("color").GetString()), Is.EqualTo(("chart", "#F2B644")));
        Assert.That((renamed.GetProperty("icon").GetString(), renamed.GetProperty("color").GetString()), Is.EqualTo(("chart", "#F2B644")));
        Assert.That(cleared.GetProperty("icon").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(cleared.GetProperty("color").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(stored.GetProperty("sql").GetString(), Is.EqualTo("SELECT 1"));
        Assert.That(stored.GetProperty("connectionID").GetGuid(), Is.EqualTo(connectionID));
        Assert.That(stored.GetProperty("name").GetString(), Is.EqualTo("Relatório mensal"));
    }

    /// <summary>RN-SCRIPT-006: o ícone fora da lista fechada e a cor fora de `#RRGGBB` são 422 `SCRIPT_ICON_INVALID`, no campo; nada é gravado.</summary>
    [Test]
    public async Task Patch_InvalidIconOrColor_Returns422_AndChangesNothing()
    {
        await using var host = await StartWithUserAsync();
        var id = await CreateAsync(host, "Relatório");

        var icon = await AssertProblemAsync(await PatchAsync(host, new { id, icon = "foguete" }), HttpStatusCode.UnprocessableEntity, "SCRIPT_ICON_INVALID");
        var color = await AssertProblemAsync(await PatchAsync(host, new { id, icon = "star", color = "amarelo" }), HttpStatusCode.UnprocessableEntity, "SCRIPT_ICON_INVALID");

        Assert.That(icon.GetProperty("errorCodes").GetProperty("Icon")[0].GetString(), Is.EqualTo("SCRIPT_ICON_INVALID"));
        Assert.That(color.GetProperty("errorCodes").GetProperty("Color")[0].GetString(), Is.EqualTo("SCRIPT_ICON_INVALID"));
        var stored = await GetAsync(host, id);
        Assert.That(stored.GetProperty("icon").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(stored.GetProperty("color").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    [Test]
    public async Task Patch_Refusals()
    {
        await using var host = await StartWithUserAsync();
        var id = await CreateAsync(host, "Relatório");
        await CreateAsync(host, "Fechamento");

        await AssertProblemAsync(await PatchAsync(host, new { id = Guid.CreateVersion7(), name = "Outro" }), HttpStatusCode.NotFound, "SCRIPT_NOT_FOUND");
        await AssertProblemAsync(await PatchAsync(host, new { id, name = "FECHAMENTO" }), HttpStatusCode.Conflict, "SCRIPT_ALREADY_EXISTS");
        await AssertProblemAsync(await PatchAsync(host, new { id, name = "" }), HttpStatusCode.UnprocessableEntity, "SCRIPT_NAME_INVALID");
        await AssertProblemAsync(await PatchAsync(host, new { id, sql = new string('x', OneMegabyte + 1) }), HttpStatusCode.UnprocessableEntity, "SCRIPT_TOO_LARGE");
        Assert.That((await GetAsync(host, id)).GetProperty("name").GetString(), Is.EqualTo("Relatório"));
        Assert.That((await GetAsync(host, id)).GetProperty("sql").GetString(), Is.EqualTo("SELECT 1"));
    }

    [Test]
    public async Task Delete_Returns204_ThenTheScriptIsGone()
    {
        await using var host = await StartWithUserAsync();
        var keep = await CreateAsync(host, "Fica");
        var id = await CreateAsync(host, "Sai");

        var response = await host.Client.DeleteAsync($"{ScriptsPath}/{id}");

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        await AssertProblemAsync(await host.Client.GetAsync($"{ScriptsPath}/{id}"), HttpStatusCode.NotFound, "SCRIPT_NOT_FOUND");
        await AssertProblemAsync(await host.Client.DeleteAsync($"{ScriptsPath}/{id}"), HttpStatusCode.NotFound, "SCRIPT_NOT_FOUND");
        Assert.That((await ListAsync(host)).Select(script => script.GetProperty("id").GetGuid()), Is.EqualTo(new[] { keep }));
    }

    /// <summary>RN-API-005: com o cofre fechado (o "Sair"), toda rota dos scripts responde 401 `VAULT_LOCKED`.</summary>
    [Test]
    public async Task Routes_WithTheVaultClosed_Return401()
    {
        await using var host = await StartWithUserAsync();
        var id = await CreateAsync(host, "Relatório");
        (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();

        await AssertProblemAsync(await host.Client.GetAsync(ScriptsPath), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await host.Client.GetAsync($"{ScriptsPath}/{id}"), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await PostAsync(host, "Outro", "SELECT 1"), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await PatchAsync(host, new { id, name = "Outro" }), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await host.Client.DeleteAsync($"{ScriptsPath}/{id}"), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    /// <summary>
    /// RN-SCRIPT-002: nada vai em texto aberto para o disco. O SQL, o nome e o banco não aparecem no arquivo do cofre nem no `.bak` (em texto ou em base64),
    /// e voltam inteiros depois de sair e entrar de novo, com a senha.
    /// </summary>
    [Test]
    public async Task TheVaultFile_DoesNotHaveTheScriptInTheClear_AndTheScriptComesBackAfterSigningInAgain()
    {
        await using var host = await ApiHost.StartAsync();
        var password = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, password);
        var mark = Guid.NewGuid().ToString("N");
        var sql = $"SELECT 'segredo-{mark}' FROM clientes WHERE cpf = '123'";
        var id = await CreateAsync(host, $"Relatório {mark}", sql, Guid.CreateVersion7(), $"banco_{mark}");
        await CreateAsync(host, "Outro");

        (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();
        foreach (var path in Directory.GetFiles(Path.Combine(host.DataDirectory, "vaults")))
        {
            var text = await File.ReadAllTextAsync(path);
            Assert.That(text, Does.Not.Contain(mark), $"{Path.GetFileName(path)} tem a marca do script em claro.");
            Assert.That(text, Does.Not.Contain(Convert.ToBase64String(Encoding.UTF8.GetBytes(mark))), $"{Path.GetFileName(path)} tem a marca em base64.");
            Assert.That(text, Does.Not.Contain("segredo"), $"{Path.GetFileName(path)} tem o SQL em claro.");
        }

        (await host.Client.PostAsJsonAsync("/api/public/sessions", new { userName = UserName, password })).EnsureSuccessStatusCode();
        var stored = await GetAsync(host, id);
        Assert.That(stored.GetProperty("sql").GetString(), Is.EqualTo(sql));
        Assert.That(stored.GetProperty("name").GetString(), Is.EqualTo($"Relatório {mark}"));
    }

    /// <summary>
    /// RN-VERSAO-005: o cofre do formato 1, gravado antes dos scripts, abre pela rota de entrada e é migrado. A lista de scripts vem vazia, as pastas e as
    /// conexões continuam lá, o arquivo passa a declarar o formato atual (o 4, que trouxe as pastas de scripts, RN-SCRIPT-011, depois do 3, que trouxe a área de
    /// trabalho, RN-ABAS-006: as duas também vêm vazias), e o de antes fica no `.bak`, byte a byte. O primeiro script já se grava.
    /// </summary>
    [Test]
    public async Task SignIn_VaultOfFormatOne_IsMigrated()
    {
        await using var host = await ApiHost.StartAsync();
        var path = VaultPath(host, SampleUserName);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using (var sample = typeof(ScriptsTests).Assembly.GetManifestResourceStream("vault-format-1.json")!)
        await using (var file = File.Create(path))
            await sample.CopyToAsync(file);
        var before = await File.ReadAllBytesAsync(path);

        var signIn = await host.Client.PostAsJsonAsync("/api/public/sessions", new { userName = SampleUserName, password = SamplePassword });

        Assert.That(signIn.StatusCode, Is.EqualTo(HttpStatusCode.OK), await signIn.Content.ReadAsStringAsync());
        Assert.That(await ListAsync(host), Is.Empty);
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/user/folders"))).GetArrayLength(), Is.EqualTo(1));
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/user/connections"))).GetArrayLength(), Is.EqualTo(1));
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/user/workspace"))).GetProperty("tabs").GetArrayLength(), Is.Zero);
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/user/script-folders"))).GetArrayLength(), Is.Zero);
        Assert.That(JsonNode.Parse(await File.ReadAllTextAsync(path))!["version"]!.GetValue<int>(), Is.EqualTo(4));
        Assert.That(await File.ReadAllBytesAsync(path + ".bak"), Is.EqualTo(before));
        await CreateAsync(host, "Primeiro script");
        Assert.That(await File.ReadAllBytesAsync(path + ".bak"), Is.Not.EqualTo(before), "A gravação seguinte põe a versão migrada no .bak, como sempre.");
    }
}
