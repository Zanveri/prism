using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// As abas que voltam na próxima entrada (`api/user/workspace`, seção 24: RN-ABAS-006), pela API de verdade: a leitura vazia, a gravação que troca a anterior
/// e volta depois de sair e entrar, as recusas da tabela de rotas, o cofre fechado (RN-API-005), o arquivo do cofre sem o SQL nem os nomes em claro e o cofre do
/// formato 2 migrado na entrada (RN-VERSAO-005). Cada teste sobe uma API própria, com a pasta de dados própria.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class WorkspaceTests
{
    private const string WorkspacePath = "/api/user/workspace";
    private const string UserName = "marina.costa";
    private const int OneMegabyte = 1024 * 1024;

    /// <summary>
    /// A senha do cofre de exemplo do formato 2 (`Prism.UnitTesting/Vault/Samples/vault-format-2.json`): a mesma constante fictícia dos exemplos dos formatos 1 e
    /// 2, de um cofre com dados inventados. Não protege nada de ninguém.
    /// </summary>
    private const string SamplePassword = "senha-ficticia-do-cofre-de-exemplo";
    private const string SampleUserName = "exemplo.formato2";

    private static readonly Guid ConnectionID = Guid.CreateVersion7();
    private static readonly Guid ScriptID = Guid.CreateVersion7();

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

    private static async Task<ApiHost> StartWithUserAsync(string? password = null)
    {
        var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, password ?? UserFakers.RandomPassword());

        return host;
    }

    private static object QueryTab(string sql, Guid? connectionID = null, string? database = null, Guid? scriptID = null, bool dirty = false, bool sqlTooLarge = false)
        => new { kind = "query", connectionID, database, sql, scriptID, dirty, sqlTooLarge };

    private static object TableTab(string schema, string table, string view, Guid? connectionID = null, string? database = null)
        => new { kind = "table", connectionID = connectionID ?? ConnectionID, database, schema, table, view };

    private static Task<HttpResponseMessage> PutAsync(ApiHost host, object[] tabs, int? activeIndex)
        => host.Client.PutAsJsonAsync(WorkspacePath, new { tabs, activeIndex });

    private static async Task<JsonElement> GetAsync(ApiHost host)
    {
        var response = await host.Client.GetAsync(WorkspacePath);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), await response.Content.ReadAsStringAsync());

        return await ReadJsonAsync(response);
    }

    private static string VaultPath(ApiHost host, string userName)
        => Path.Combine(host.DataDirectory, "vaults", $"{userName}.vault.json");

    [Test]
    public async Task Get_WithNothingSaved_ReturnsAnEmptyList()
    {
        await using var host = await StartWithUserAsync();

        var body = await GetAsync(host);

        Assert.That(body.EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "tabs", "activeIndex" }));
        Assert.That(body.GetProperty("tabs").GetArrayLength(), Is.Zero);
        Assert.That(body.GetProperty("activeIndex").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    /// <summary>RN-ABAS-006: as abas voltam na ordem, com a ativa, cada uma com os campos dela; a gravação seguinte troca a anterior inteira (fechar uma aba a tira do que volta).</summary>
    [Test]
    public async Task Put_Returns204_AndTheTabsComeBackInOrder_AndTheNextPutReplacesThem()
    {
        await using var host = await StartWithUserAsync();
        const string sql = "SELECT *\n  FROM pedidos\n WHERE total > 10;\n";

        var put = await PutAsync(host, [QueryTab(sql, ConnectionID, "vendas", ScriptID, dirty: true), TableTab("loja", "clientes", "structure"), QueryTab("", sqlTooLarge: true)], 1);

        Assert.That(put.StatusCode, Is.EqualTo(HttpStatusCode.NoContent), await put.Content.ReadAsStringAsync());
        Assert.That(await put.Content.ReadAsStringAsync(), Is.Empty);
        var body = await GetAsync(host);
        var tabs = body.GetProperty("tabs").EnumerateArray().ToList();
        Assert.That(body.GetProperty("activeIndex").GetInt32(), Is.EqualTo(1));
        Assert.That(tabs.Select(tab => tab.GetProperty("kind").GetString()), Is.EqualTo(new[] { "query", "table", "query" }));
        Assert.That(tabs[0].EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "kind", "connectionID", "database", "sql", "scriptID", "dirty", "sqlTooLarge", "schema", "table", "view" }));
        Assert.That(tabs[0].GetProperty("sql").GetString(), Is.EqualTo(sql));
        Assert.That(tabs[0].GetProperty("connectionID").GetGuid(), Is.EqualTo(ConnectionID));
        Assert.That(tabs[0].GetProperty("database").GetString(), Is.EqualTo("vendas"));
        Assert.That(tabs[0].GetProperty("scriptID").GetGuid(), Is.EqualTo(ScriptID));
        Assert.That(tabs[0].GetProperty("dirty").GetBoolean(), Is.True);
        Assert.That(tabs[1].GetProperty("connectionID").GetGuid(), Is.EqualTo(ConnectionID));
        Assert.That((tabs[1].GetProperty("schema").GetString(), tabs[1].GetProperty("table").GetString(), tabs[1].GetProperty("view").GetString()), Is.EqualTo(("loja", "clientes", "structure")));
        Assert.That(tabs[1].GetProperty("sql").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(tabs[2].GetProperty("sqlTooLarge").GetBoolean(), Is.True);
        Assert.That(tabs[2].GetProperty("sql").GetString(), Is.Empty);
        Assert.That(tabs[2].GetProperty("connectionID").ValueKind, Is.EqualTo(JsonValueKind.Null));

        var replaced = await PutAsync(host, [TableTab("loja", "pedidos", "diagram")], 0);

        Assert.That(replaced.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        var after = await GetAsync(host);
        Assert.That(after.GetProperty("tabs").GetArrayLength(), Is.EqualTo(1));
        Assert.That(after.GetProperty("tabs")[0].GetProperty("table").GetString(), Is.EqualTo("pedidos"));
        Assert.That((await PutAsync(host, [], null)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That((await GetAsync(host)).GetProperty("tabs").GetArrayLength(), Is.Zero);
    }

    /// <summary>A mesma área de trabalho de novo não regrava o cofre: o `.bak` continua com a versão anterior de verdade.</summary>
    [Test]
    public async Task Put_TheSameWorkspaceAgain_DoesNotRewriteTheVault()
    {
        await using var host = await StartWithUserAsync();
        var path = VaultPath(host, UserName);
        object[] tabs = [QueryTab("SELECT 1", ConnectionID)];
        Assert.That((await PutAsync(host, tabs, 0)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        var (file, backup) = (await File.ReadAllBytesAsync(path), await File.ReadAllBytesAsync(path + ".bak"));

        var again = await PutAsync(host, tabs, 0);

        Assert.That(again.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(await File.ReadAllBytesAsync(path), Is.EqualTo(file));
        Assert.That(await File.ReadAllBytesAsync(path + ".bak"), Is.EqualTo(backup));
    }

    [Test]
    public async Task Put_Refusals_KeepWhatWasSaved()
    {
        await using var host = await StartWithUserAsync();
        Assert.That((await PutAsync(host, [QueryTab("SELECT 'fica'")], 0)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        await AssertProblemAsync(await PutAsync(host, [QueryTab("SELECT 1"), new { kind = "grafico", sql = "SELECT 1" }], 0), HttpStatusCode.UnprocessableEntity, "WORKSPACE_INVALID");
        await AssertProblemAsync(await PutAsync(host, [new { kind = "table", schema = "loja", table = "clientes", view = "data" }], 0), HttpStatusCode.UnprocessableEntity, "WORKSPACE_INVALID");
        await AssertProblemAsync(await PutAsync(host, [TableTab("loja", "clientes", "grade")], 0), HttpStatusCode.UnprocessableEntity, "WORKSPACE_INVALID");
        await AssertProblemAsync(await PutAsync(host, [QueryTab("SELECT 1")], 1), HttpStatusCode.UnprocessableEntity, "WORKSPACE_INVALID");
        await AssertProblemAsync(await PutAsync(host, [QueryTab("SELECT 1")], -1), HttpStatusCode.UnprocessableEntity, "WORKSPACE_INVALID");
        await AssertProblemAsync(await PutAsync(host, [], 0), HttpStatusCode.UnprocessableEntity, "WORKSPACE_INVALID");
        var tooLarge = await AssertProblemAsync(await PutAsync(host, [QueryTab("SELECT 1"), QueryTab(new string('x', OneMegabyte + 1))], 0), HttpStatusCode.UnprocessableEntity, "WORKSPACE_TOO_LARGE");
        Assert.That(tooLarge.GetProperty("errorCodes").GetProperty("Tabs[1].Sql")[0].GetString(), Is.EqualTo("WORKSPACE_TOO_LARGE"));
        Assert.That((await PutAsync(host, [QueryTab(new string('x', OneMegabyte))], 0)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent), "1 MB exato cabe.");
        Assert.That((await GetAsync(host)).GetProperty("tabs")[0].GetProperty("sql").GetString(), Has.Length.EqualTo(OneMegabyte));
    }

    /// <summary>RN-API-005: com o cofre fechado (o "Sair"), as duas rotas respondem 401 `VAULT_LOCKED`, e a leitura não é uma lista vazia.</summary>
    [Test]
    public async Task Routes_WithTheVaultClosed_Return401()
    {
        await using var host = await StartWithUserAsync();
        (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();

        await AssertProblemAsync(await host.Client.GetAsync(WorkspacePath), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await PutAsync(host, [QueryTab("SELECT 1")], 0), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    /// <summary>
    /// RN-ABAS-006 e RN-SCRIPT-002: nada vai em texto aberto para o disco. O texto, o banco, o esquema e a tabela das abas não aparecem no arquivo do cofre nem no
    /// `.bak` (em texto ou em base64), e voltam inteiros, na mesma ordem, depois de sair e entrar de novo com a senha.
    /// </summary>
    [Test]
    public async Task TheVaultFile_DoesNotHaveTheTabsInTheClear_AndTheyComeBackAfterSigningInAgain()
    {
        var password = UserFakers.RandomPassword();
        await using var host = await StartWithUserAsync(password);
        var mark = Guid.NewGuid().ToString("N");
        var sql = $"SELECT 'segredo-{mark}' FROM clientes WHERE cpf = '123'";
        Assert.That((await PutAsync(host, [TableTab($"esquema_{mark}", $"tabela_{mark}", "data", database: $"banco_{mark}"), QueryTab(sql, ConnectionID, $"banco_{mark}")], 1)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That((await PutAsync(host, [TableTab($"esquema_{mark}", $"tabela_{mark}", "data", database: $"banco_{mark}"), QueryTab(sql + " ", ConnectionID, $"banco_{mark}")], 1)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();
        foreach (var path in Directory.GetFiles(Path.Combine(host.DataDirectory, "vaults")))
        {
            var text = await File.ReadAllTextAsync(path);
            Assert.That(text, Does.Not.Contain(mark), $"{Path.GetFileName(path)} tem a marca das abas em claro.");
            Assert.That(text, Does.Not.Contain(Convert.ToBase64String(Encoding.UTF8.GetBytes(mark))), $"{Path.GetFileName(path)} tem a marca em base64.");
            Assert.That(text, Does.Not.Contain("segredo"), $"{Path.GetFileName(path)} tem o SQL em claro.");
        }

        (await host.Client.PostAsJsonAsync("/api/public/sessions", new { userName = UserName, password })).EnsureSuccessStatusCode();
        var body = await GetAsync(host);
        Assert.That(body.GetProperty("activeIndex").GetInt32(), Is.EqualTo(1));
        Assert.That(body.GetProperty("tabs")[0].GetProperty("table").GetString(), Is.EqualTo($"tabela_{mark}"));
        Assert.That(body.GetProperty("tabs")[1].GetProperty("sql").GetString(), Is.EqualTo(sql + " "));
    }

    /// <summary>
    /// RN-VERSAO-005: o cofre do formato 2, gravado antes da área de trabalho, abre pela rota de entrada e é migrado. A área de trabalho vem vazia, o script e a
    /// conexão continuam lá, o arquivo passa a declarar o formato 3, e o de antes fica no `.bak`, byte a byte. A primeira área de trabalho já se grava.
    /// </summary>
    [Test]
    public async Task SignIn_VaultOfFormatTwo_IsMigrated()
    {
        await using var host = await ApiHost.StartAsync();
        var path = VaultPath(host, SampleUserName);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using (var sample = typeof(WorkspaceTests).Assembly.GetManifestResourceStream("vault-format-2.json")!)
        await using (var file = File.Create(path))
            await sample.CopyToAsync(file);
        var before = await File.ReadAllBytesAsync(path);

        var signIn = await host.Client.PostAsJsonAsync("/api/public/sessions", new { userName = SampleUserName, password = SamplePassword });

        Assert.That(signIn.StatusCode, Is.EqualTo(HttpStatusCode.OK), await signIn.Content.ReadAsStringAsync());
        Assert.That((await GetAsync(host)).GetProperty("tabs").GetArrayLength(), Is.Zero);
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/user/scripts"))).GetArrayLength(), Is.EqualTo(1));
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/user/connections"))).GetArrayLength(), Is.EqualTo(1));
        Assert.That(JsonNode.Parse(await File.ReadAllTextAsync(path))!["version"]!.GetValue<int>(), Is.EqualTo(3));
        Assert.That(await File.ReadAllBytesAsync(path + ".bak"), Is.EqualTo(before));
        Assert.That((await PutAsync(host, [QueryTab("SELECT 1")], 0)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(await File.ReadAllBytesAsync(path + ".bak"), Is.Not.EqualTo(before), "A gravação seguinte põe a versão migrada no .bak, como sempre.");
    }
}
