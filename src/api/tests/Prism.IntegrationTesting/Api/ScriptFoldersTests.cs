using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// As pastas de scripts do usuário (`api/user/script-folders`, seção 33: RN-SCRIPT-007 a 011), pela API de verdade: as rotas da tabela, com as recusas dela,
/// o cofre fechado (RN-API-005), o arquivo do cofre sem o nome da pasta em claro e o cofre do formato 3 migrado na entrada (RN-SCRIPT-011). Cada teste sobe
/// uma API própria, com a pasta de dados própria.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class ScriptFoldersTests
{
    private const string FoldersPath = "/api/user/script-folders";
    private const string UserName = "marina.costa";

    /// <summary>
    /// A senha do cofre de exemplo do formato 3 (`Prism.UnitTesting/Vault/Samples/vault-format-3.json`): a mesma constante fictícia dos exemplos dos formatos 1
    /// e 2, de um cofre com dados inventados. Não protege nada de ninguém.
    /// </summary>
    private const string SamplePassword = "senha-ficticia-do-cofre-de-exemplo";
    private const string SampleUserName = "exemplo.formato3";

    private static readonly string[] FolderKeys = ["id", "parentID", "name", "createdAt", "updatedAt"];

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

    private static Task<HttpResponseMessage> PostAsync(ApiHost host, string name, Guid? parentID = null)
        => host.Client.PostAsJsonAsync(FoldersPath, new { name, parentID });

    /// <summary>Cria pela rota e confere o 201: um teste que arruma estado não segue adiante com uma criação recusada.</summary>
    private static async Task<Guid> CreateAsync(ApiHost host, string name, Guid? parentID = null)
    {
        var response = await PostAsync(host, name, parentID);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created), await response.Content.ReadAsStringAsync());

        return (await ReadJsonAsync(response)).GetProperty("id").GetGuid();
    }

    private static Task<HttpResponseMessage> PatchAsync(ApiHost host, object body)
        => host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, FoldersPath) { Content = JsonContent.Create(body) });

    private static async Task<List<JsonElement>> ListAsync(ApiHost host)
    {
        var response = await host.Client.GetAsync(FoldersPath);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));

        return (await ReadJsonAsync(response)).EnumerateArray().ToList();
    }

    private static async Task<JsonElement> FindAsync(ApiHost host, Guid id)
        => (await ListAsync(host)).Single(folder => folder.GetProperty("id").GetGuid() == id);

    private static string VaultPath(ApiHost host, string userName)
        => Path.Combine(host.DataDirectory, "vaults", $"{userName}.vault.json");

    [Test]
    public async Task Create_Returns201_AndTheListHasAllTheLevels()
    {
        await using var host = await StartWithUserAsync();

        // Espaços sobrando no nome: ele é gravado normalizado.
        var response = await PostAsync(host, "  Fechamento   do mês ");
        var body = await ReadJsonAsync(response);
        var id = body.GetProperty("id").GetGuid();
        var child = await CreateAsync(host, "Abril", id);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That(response.Headers.Location?.ToString(), Is.EqualTo(FoldersPath));
        Assert.That(body.EnumerateObject().Select(property => property.Name), Is.EqualTo(FolderKeys));
        Assert.That(body.GetProperty("name").GetString(), Is.EqualTo("Fechamento do mês"));
        Assert.That(body.GetProperty("parentID").ValueKind, Is.EqualTo(JsonValueKind.Null));
        var listed = await ListAsync(host);
        Assert.That(listed.Select(folder => folder.GetProperty("name").GetString()), Is.EqualTo(new[] { "Abril", "Fechamento do mês" }));
        Assert.That(listed[0].EnumerateObject().Select(property => property.Name), Is.EqualTo(FolderKeys));
        Assert.That(listed[0].GetProperty("id").GetGuid(), Is.EqualTo(child));
        Assert.That(listed[0].GetProperty("parentID").GetGuid(), Is.EqualTo(id));
    }

    /// <summary>RN-SCRIPT-007: o nome é único entre as irmãs, sem diferenciar maiúsculas; o mesmo nome noutra pasta não é repetição.</summary>
    [Test]
    public async Task Create_NameTakenAmongSiblingsIgnoringCase_Returns409_AndElsewhereIs201()
    {
        await using var host = await StartWithUserAsync();
        var parent = await CreateAsync(host, "Fechamento");
        await CreateAsync(host, "Mensal", parent);

        var body = await AssertProblemAsync(await PostAsync(host, "MENSAL", parent), HttpStatusCode.Conflict, "SCRIPT_FOLDER_ALREADY_EXISTS");
        Assert.That(body.GetProperty("detail").GetString(), Is.EqualTo("Já existe uma pasta chamada MENSAL em Fechamento."));
        await CreateAsync(host, "Mensal");
        Assert.That(await ListAsync(host), Has.Count.EqualTo(3));
    }

    [TestCase("")]
    [TestCase("   ")]
    [TestCase("Fecha\tmento")]
    [TestCase("Fechamento\u0001")]
    public async Task Create_InvalidName_Returns422(string name)
    {
        await using var host = await StartWithUserAsync();

        var body = await AssertProblemAsync(await PostAsync(host, name), HttpStatusCode.UnprocessableEntity, "SCRIPT_FOLDER_NAME_INVALID");
        Assert.That(body.GetProperty("errors").TryGetProperty("Name", out _), Is.True, body.ToString());
        Assert.That(await ListAsync(host), Is.Empty);
    }

    [Test]
    public async Task Create_NameOf61Characters_Returns422_AndOf60_Returns201()
    {
        await using var host = await StartWithUserAsync();

        await AssertProblemAsync(await PostAsync(host, new string('a', 61)), HttpStatusCode.UnprocessableEntity, "SCRIPT_FOLDER_NAME_INVALID");
        await CreateAsync(host, new string('a', 60));
    }

    [Test]
    public async Task Create_InMissingParent_Returns404()
    {
        await using var host = await StartWithUserAsync();

        var body = await AssertProblemAsync(await PostAsync(host, "Abril", Guid.CreateVersion7()), HttpStatusCode.NotFound, "SCRIPT_FOLDER_NOT_FOUND");
        Assert.That(body.GetProperty("detail").GetString(), Is.EqualTo("A pasta pai não existe mais."));
        Assert.That(await ListAsync(host), Is.Empty);
    }

    /// <summary>O `PATCH` grava a pasta por inteiro: renomear manda a pasta pai que ela tem, mover manda o nome dela, e sem `parentID` ela vai para a raiz.</summary>
    [Test]
    public async Task Patch_RenamesAndMoves_AndWithoutParentGoesToTheRoot()
    {
        await using var host = await StartWithUserAsync();
        var destination = await CreateAsync(host, "Fechamento");
        var id = await CreateAsync(host, "mensal");

        var renamed = await PatchAsync(host, new { id, name = "Mensal" });
        Assert.That(renamed.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await ReadJsonAsync(renamed)).GetProperty("name").GetString(), Is.EqualTo("Mensal"));

        var moved = await PatchAsync(host, new { id, name = "Mensal", parentID = destination });
        Assert.That(moved.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await FindAsync(host, id)).GetProperty("parentID").GetGuid(), Is.EqualTo(destination));

        Assert.That((await PatchAsync(host, new { id, name = "Mensal" })).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await FindAsync(host, id)).GetProperty("parentID").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    /// <summary>A tela salva sem mudar nada: o arquivo do cofre não é regravado, e a data não muda.</summary>
    [Test]
    public async Task Patch_NothingChanged_DoesNotRewriteTheVault()
    {
        await using var host = await StartWithUserAsync();
        var id = await CreateAsync(host, "Fechamento");
        var before = await File.ReadAllBytesAsync(VaultPath(host, UserName));
        var updatedAt = (await FindAsync(host, id)).GetProperty("updatedAt").GetDateTime();

        var response = await PatchAsync(host, new { id, name = " Fechamento " });

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await ReadJsonAsync(response)).GetProperty("updatedAt").GetDateTime(), Is.EqualTo(updatedAt));
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host, UserName)), Is.EqualTo(before));
    }

    [Test]
    public async Task Patch_Refusals()
    {
        await using var host = await StartWithUserAsync();
        var top = await CreateAsync(host, "Fechamento");
        var child = await CreateAsync(host, "Mensal", top);
        var grandchild = await CreateAsync(host, "Abril", child);
        var other = await CreateAsync(host, "Abril");

        await AssertProblemAsync(await PatchAsync(host, new { id = Guid.CreateVersion7(), name = "Outra" }), HttpStatusCode.NotFound, "SCRIPT_FOLDER_NOT_FOUND");
        var destination = await AssertProblemAsync(await PatchAsync(host, new { id = other, name = "Abril", parentID = Guid.CreateVersion7() }), HttpStatusCode.NotFound, "SCRIPT_FOLDER_NOT_FOUND");
        Assert.That(destination.GetProperty("detail").GetString(), Is.EqualTo("A pasta de destino não existe mais."));
        var cycle = await AssertProblemAsync(await PatchAsync(host, new { id = top, name = "Fechamento", parentID = grandchild }), HttpStatusCode.Conflict, "SCRIPT_FOLDER_CYCLE");
        Assert.That(cycle.GetProperty("detail").GetString(), Is.EqualTo("Uma pasta não pode ir para dentro dela mesma nem de uma subpasta dela."));
        await AssertProblemAsync(await PatchAsync(host, new { id = top, name = "Fechamento", parentID = top }), HttpStatusCode.Conflict, "SCRIPT_FOLDER_CYCLE");
        var taken = await AssertProblemAsync(await PatchAsync(host, new { id = other, name = "Abril", parentID = child }), HttpStatusCode.Conflict, "SCRIPT_FOLDER_ALREADY_EXISTS");
        Assert.That(taken.GetProperty("detail").GetString(), Is.EqualTo("Já existe uma pasta chamada Abril em Fechamento / Mensal."));
        var invalid = await AssertProblemAsync(await PatchAsync(host, new { id = other, name = "" }), HttpStatusCode.UnprocessableEntity, "SCRIPT_FOLDER_NAME_INVALID");
        Assert.That(invalid.GetProperty("errors").TryGetProperty("Name", out _), Is.True);
        Assert.That((await FindAsync(host, other)).GetProperty("parentID").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    [Test]
    public async Task Delete_Returns204_AndTheFolderWithASubfolderIsRefusedWithTheCounts()
    {
        await using var host = await StartWithUserAsync();
        var parent = await CreateAsync(host, "Fechamento");
        var child = await CreateAsync(host, "Mensal", parent);

        var refused = await AssertProblemAsync(await host.Client.DeleteAsync($"{FoldersPath}/{parent}"), HttpStatusCode.Conflict, "SCRIPT_FOLDER_NOT_EMPTY");
        Assert.That((refused.GetProperty("folders").GetInt32(), refused.GetProperty("scripts").GetInt32()), Is.EqualTo((1, 0)));
        Assert.That(refused.GetProperty("detail").GetString(), Is.EqualTo("A pasta Fechamento tem 1 subpasta. Só uma pasta vazia pode ser excluída: mova ou exclua antes o que está dentro dela."));

        Assert.That((await host.Client.DeleteAsync($"{FoldersPath}/{child}")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That((await host.Client.DeleteAsync($"{FoldersPath}/{parent}")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(await ListAsync(host), Is.Empty);
        await AssertProblemAsync(await host.Client.DeleteAsync($"{FoldersPath}/{parent}"), HttpStatusCode.NotFound, "SCRIPT_FOLDER_NOT_FOUND");
    }

    /// <summary>RN-API-005: com o cofre fechado (o "Sair"), toda rota das pastas de scripts responde 401 `VAULT_LOCKED`.</summary>
    [Test]
    public async Task Routes_WithTheVaultClosed_Return401()
    {
        await using var host = await StartWithUserAsync();
        var id = await CreateAsync(host, "Fechamento");
        (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();

        await AssertProblemAsync(await host.Client.GetAsync(FoldersPath), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await PostAsync(host, "Outra"), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await PatchAsync(host, new { id, name = "Outra" }), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await host.Client.DeleteAsync($"{FoldersPath}/{id}"), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    /// <summary>O nome da pasta não aparece no arquivo do cofre nem no `.bak` (em texto ou em base64), e a pasta volta inteira depois de sair e entrar de novo.</summary>
    [Test]
    public async Task TheVaultFile_DoesNotHaveTheFolderInTheClear_AndTheFolderComesBackAfterSigningInAgain()
    {
        await using var host = await ApiHost.StartAsync();
        var password = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, password);
        var mark = Guid.NewGuid().ToString("N");
        var id = await CreateAsync(host, $"Pasta {mark}");
        await CreateAsync(host, "Outra", id);

        (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();
        foreach (var path in Directory.GetFiles(Path.Combine(host.DataDirectory, "vaults")))
        {
            var text = await File.ReadAllTextAsync(path);
            Assert.That(text, Does.Not.Contain(mark), $"{Path.GetFileName(path)} tem a marca da pasta em claro.");
            Assert.That(text, Does.Not.Contain(Convert.ToBase64String(Encoding.UTF8.GetBytes(mark))), $"{Path.GetFileName(path)} tem a marca em base64.");
        }

        (await host.Client.PostAsJsonAsync("/api/public/sessions", new { userName = UserName, password })).EnsureSuccessStatusCode();
        Assert.That((await FindAsync(host, id)).GetProperty("name").GetString(), Is.EqualTo($"Pasta {mark}"));
        Assert.That(await ListAsync(host), Has.Count.EqualTo(2));
    }

    /// <summary>
    /// RN-SCRIPT-011: o cofre do formato 3, gravado antes das pastas de scripts, abre pela rota de entrada e é migrado. As pastas de scripts vêm vazias, os scripts,
    /// as pastas, a conexão e as abas continuam lá, o arquivo passa a declarar o formato 4, e o de antes fica no `.bak`, byte a byte. A primeira pasta já se grava.
    /// </summary>
    [Test]
    public async Task SignIn_VaultOfFormatThree_IsMigrated()
    {
        await using var host = await ApiHost.StartAsync();
        var path = VaultPath(host, SampleUserName);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using (var sample = typeof(ScriptFoldersTests).Assembly.GetManifestResourceStream("vault-format-3.json")!)
        await using (var file = File.Create(path))
            await sample.CopyToAsync(file);
        var before = await File.ReadAllBytesAsync(path);

        var signIn = await host.Client.PostAsJsonAsync("/api/public/sessions", new { userName = SampleUserName, password = SamplePassword });

        Assert.That(signIn.StatusCode, Is.EqualTo(HttpStatusCode.OK), await signIn.Content.ReadAsStringAsync());
        Assert.That(await ListAsync(host), Is.Empty);
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/user/scripts"))).GetArrayLength(), Is.EqualTo(2));
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/user/folders"))).GetArrayLength(), Is.EqualTo(1));
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/user/connections"))).GetArrayLength(), Is.EqualTo(1));
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/user/workspace"))).GetProperty("tabs").GetArrayLength(), Is.EqualTo(2));
        Assert.That(JsonNode.Parse(await File.ReadAllTextAsync(path))!["version"]!.GetValue<int>(), Is.EqualTo(4));
        Assert.That(await File.ReadAllBytesAsync(path + ".bak"), Is.EqualTo(before));
        await CreateAsync(host, "Primeira pasta");
        Assert.That(await File.ReadAllBytesAsync(path + ".bak"), Is.Not.EqualTo(before), "A gravação seguinte põe a versão migrada no .bak, como sempre.");
    }
}
