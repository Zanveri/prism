using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// Exportar e importar conexões com as pastas pelas rotas de verdade, sem banco (seção 34 da especificação): o arquivo sempre cifrado, sem nada em claro; a
/// senha do Prism pedida só quando uma senha de banco vai, com a contagem de cinco erros; a prévia sem a senha de banco; a importação numa gravação só,
/// com as pastas juntadas, os conflitos e o "nunca mais fraca"; as recusas no campo; e a conexão que chega sem usuário e senha, recusada antes do driver ao
/// abrir sessão e ao testar (RN-TRANSF-015 e 016). Cada teste sobe uma API própria, com a pasta de dados própria e o Argon2id pequeno do `ApiHost`.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class ConnectionTransfersTests
{
    private const string ConnectionsPath = "/api/user/connections";
    private const string FoldersPath = "/api/user/folders";
    private const string ExportPath = "/api/user/connections/export";
    private const string PreviewPath = "/api/user/connections/import/preview";
    private const string ImportPath = "/api/user/connections/import";
    private const string Passphrase = "senha de exportação fictícia";
    private const string DatabasePassword = "senha-ficticia-do-banco";

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<(ApiHost Host, string Password)> StartAsync(string userName = "marina.costa")
    {
        var host = await ApiHost.StartAsync();
        var password = UserFakers.RandomPassword();
        await host.CreateUserAsync(userName, password);

        return (host, password);
    }

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type, string? field = null)
    {
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(status), body.ToString());
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));
        if (field is not null)
            Assert.That(body.GetProperty("errorCodes").GetProperty(field)[0].GetString(), Is.EqualTo(type));
    }

    private static Guid IdOf(JsonElement item)
        => item.GetProperty("id").GetGuid();

    private static async Task<JsonElement> CreateAsync(ApiHost host, string path, object body)
    {
        var response = await host.Client.PostAsJsonAsync(path, body);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created), await response.Content.ReadAsStringAsync());

        return await ReadJsonAsync(response);
    }

    /// <summary>"Estoque" › "Production PRD" (ambiente Production, somente leitura) com "DATA FIX" e "NOMINAL", e "Relatórios" na raiz.</summary>
    private static async Task<(Guid Stock, Guid Production, Guid DataFix, Guid Nominal, Guid Reports)> SeedAsync(ApiHost host)
    {
        var stock = IdOf(await CreateAsync(host, FoldersPath, new { name = "Estoque" }));
        var production = IdOf(await CreateAsync(host, FoldersPath, new { name = "Production PRD", parentID = stock, environmentName = "Production", environmentColor = "#d64545", readOnly = true }));
        var dataFix = IdOf(await CreateAsync(host, ConnectionsPath, new { folderID = production, name = "DATA FIX", engine = 3, host = "informix-prd.exemplo.invalid", port = 9089, database = "estoque", userName = "datafix", password = DatabasePassword }));
        var nominal = IdOf(await CreateAsync(host, ConnectionsPath, new { folderID = production, name = "NOMINAL", engine = 3, host = "informix-prd.exemplo.invalid", port = 9089, database = "estoque", userName = "nominal", password = "senha-ficticia-nominal" }));
        var reports = IdOf(await CreateAsync(host, ConnectionsPath, new { name = "Relatórios", engine = 1, host = "192.0.2.10", port = 5432, database = "relatorios", userName = "leitor", password = "senha-ficticia-leitor" }));

        return (stock, production, dataFix, nominal, reports);
    }

    private static Task<HttpResponseMessage> ExportAsync(ApiHost host, IEnumerable<Guid> folderIDs, IEnumerable<(Guid ID, string? Credentials)> connections, string passphrase = Passphrase, string? userPassword = null)
        => host.Client.PostAsJsonAsync(ExportPath, new { folderIDs, connections = connections.Select(choice => new { id = choice.ID, credentials = choice.Credentials }), passphrase, userPassword });

    /// <summary>
    /// RN-TRANSF-005 a 014, do começo ao fim: a exportação com a senha de uma conexão pede a senha do Prism, e o arquivo não tem nada em claro (nem nomes,
    /// nem hosts, nem usuários, nem senhas); outro usuário, noutro cofre, vê a prévia sem a senha de banco e importa numa gravação só; a senha que foi no
    /// arquivo é a que a revelação mostra depois, e a que não foi fica vazia.
    /// </summary>
    [Test]
    public async Task ExportAndImport_RoundTrip()
    {
        var (started, password) = await StartAsync();
        await using var host = started;
        var seeded = await SeedAsync(host);

        var asked = await ExportAsync(host, [], [(seeded.DataFix, "userAndPassword"), (seeded.Nominal, "user"), (seeded.Reports, null)]);
        await AssertProblemAsync(asked, HttpStatusCode.UnprocessableEntity, "USER_PASSWORD_REQUIRED", "UserPassword");

        var exported = await ExportAsync(host, [], [(seeded.DataFix, "userAndPassword"), (seeded.Nominal, "user"), (seeded.Reports, null)], userPassword: password);
        Assert.That(exported.StatusCode, Is.EqualTo(HttpStatusCode.OK), await exported.Content.ReadAsStringAsync());
        var body = await ReadJsonAsync(exported);
        var content = body.GetProperty("content").GetString()!;
        Assert.That(body.GetProperty("folders").GetInt32(), Is.EqualTo(2));
        Assert.That(body.GetProperty("connections").GetInt32(), Is.EqualTo(3));
        Assert.That(body.GetProperty("withUser").GetInt32(), Is.EqualTo(2));
        Assert.That(body.GetProperty("withPassword").GetInt32(), Is.EqualTo(1));
        foreach (var secret in new[] { "Estoque", "Production", "DATA FIX", "informix-prd", "192.0.2.10", "datafix", DatabasePassword, Passphrase })
            Assert.That(content, Does.Not.Contain(secret));

        // Outro usuário no mesmo app: o cofre dele não tem nada, e a importação vai para ele.
        await host.CreateUserAsync("joao.pereira", UserFakers.RandomPassword());

        var preview = await host.Client.PostAsJsonAsync(PreviewPath, new { content, passphrase = "  " + Passphrase + "  " });
        Assert.That(preview.StatusCode, Is.EqualTo(HttpStatusCode.OK), await preview.Content.ReadAsStringAsync());
        var previewText = await preview.Content.ReadAsStringAsync();
        Assert.That(previewText, Does.Not.Contain(DatabasePassword));
        var previewBody = JsonDocument.Parse(previewText).RootElement;
        var dataFixPreview = previewBody.GetProperty("connections").EnumerateArray().Single(item => item.GetProperty("name").GetString() == "DATA FIX");
        Assert.That(dataFixPreview.GetProperty("hasPassword").GetBoolean(), Is.True);
        Assert.That(dataFixPreview.GetProperty("engine").GetInt32(), Is.EqualTo(3));
        Assert.That(dataFixPreview.GetProperty("effective").GetProperty("readOnly").GetBoolean(), Is.True);
        Assert.That(dataFixPreview.TryGetProperty("password", out _), Is.False);
        var keys = previewBody.GetProperty("folders").EnumerateArray().Concat(previewBody.GetProperty("connections").EnumerateArray()).Select(item => item.GetProperty("key").GetString()).ToList();

        var imported = await host.Client.PostAsJsonAsync(ImportPath, new { content, passphrase = Passphrase, items = keys });
        Assert.That(imported.StatusCode, Is.EqualTo(HttpStatusCode.OK), await imported.Content.ReadAsStringAsync());
        var importedBody = await ReadJsonAsync(imported);
        Assert.That(importedBody.GetProperty("folderIDs").GetArrayLength(), Is.EqualTo(2));
        Assert.That(importedBody.GetProperty("connectionIDs").GetArrayLength(), Is.EqualTo(3));
        Assert.That(importedBody.GetProperty("mergedFolders").GetInt32(), Is.EqualTo(0));

        var connections = (await ReadJsonAsync(await host.Client.GetAsync(ConnectionsPath))).EnumerateArray().ToDictionary(item => item.GetProperty("name").GetString()!);
        Assert.That(connections.Keys, Is.EquivalentTo(new[] { "DATA FIX", "NOMINAL", "Relatórios" }));
        Assert.That(connections["NOMINAL"].GetProperty("userName").GetString(), Is.EqualTo("nominal"));
        Assert.That(connections["NOMINAL"].GetProperty("hasPassword").GetBoolean(), Is.False);
        Assert.That(connections["Relatórios"].GetProperty("userName").GetString(), Is.EqualTo(string.Empty));
        Assert.That(connections["DATA FIX"].GetProperty("protections").GetProperty("readOnly").GetBoolean(), Is.True);
    }

    /// <summary>RN-TRANSF-004 e 008: as recusas da exportação antes de qualquer derivação, no campo da tela quando são de um campo.</summary>
    [Test]
    public async Task Export_Refusals()
    {
        var (started, password) = await StartAsync();
        await using var host = started;
        var seeded = await SeedAsync(host);

        await AssertProblemAsync(await ExportAsync(host, [], []), HttpStatusCode.UnprocessableEntity, "EXPORT_EMPTY");
        await AssertProblemAsync(await ExportAsync(host, [], [(seeded.DataFix, "tudo")]), HttpStatusCode.UnprocessableEntity, "EXPORT_INVALID");
        await AssertProblemAsync(await ExportAsync(host, [], [(seeded.DataFix, null)], passphrase: "curta"), HttpStatusCode.UnprocessableEntity, "EXPORT_PASSPHRASE_INVALID", "Passphrase");
        await AssertProblemAsync(await ExportAsync(host, [Guid.CreateVersion7()], []), HttpStatusCode.NotFound, "FOLDER_NOT_FOUND");
        await AssertProblemAsync(await ExportAsync(host, [], [(Guid.CreateVersion7(), null)]), HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
        await AssertProblemAsync(await ExportAsync(host, [], [(seeded.DataFix, "userAndPassword")], passphrase: password, userPassword: password), HttpStatusCode.UnprocessableEntity, "EXPORT_PASSPHRASE_INVALID", "Passphrase");
    }

    /// <summary>
    /// RN-TRANSF-005 e RN-CONN-003: a senha do Prism errada na exportação é 422 `INVALID_PASSWORD` no campo, e o quinto erro seguido fecha o cofre (401
    /// `VAULT_LOCKED`), na mesma conta da revelação de senha.
    /// </summary>
    [Test]
    public async Task Export_FifthWrongUserPassword_LocksTheVault()
    {
        var (started, _) = await StartAsync();
        await using var host = started;
        var seeded = await SeedAsync(host);

        for (var attempt = 1; attempt <= 4; attempt++)
            await AssertProblemAsync(await ExportAsync(host, [], [(seeded.DataFix, "userAndPassword")], userPassword: "senha errada do Prism"), HttpStatusCode.UnprocessableEntity, "INVALID_PASSWORD", "UserPassword");

        await AssertProblemAsync(await ExportAsync(host, [], [(seeded.DataFix, "userAndPassword")], userPassword: "senha errada do Prism"), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await host.Client.GetAsync(FoldersPath), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    /// <summary>
    /// RN-TRANSF-010: as recusas da leitura, no campo da tela. A senha de exportação errada é a mesma recusa do arquivo alterado, e não conta no contador de
    /// cinco erros do cofre: seis tentativas erradas e o cofre continua aberto.
    /// </summary>
    [Test]
    public async Task Import_Refusals_AndTheWrongPassphraseDoesNotLockTheVault()
    {
        var (started, _) = await StartAsync();
        await using var host = started;
        var seeded = await SeedAsync(host);
        var content = (await ReadJsonAsync(await ExportAsync(host, [seeded.Stock], [(seeded.Nominal, "user")]))).GetProperty("content").GetString()!;

        for (var attempt = 1; attempt <= 6; attempt++)
            await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { content, passphrase = "outra senha de exportação" }), HttpStatusCode.UnprocessableEntity, "IMPORT_PASSPHRASE_WRONG", "Passphrase");

        var tampered = JsonNode.Parse(content)!;
        tampered["kdf"]!["memoryKiB"] = 8193;
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { content = tampered.ToJsonString(), passphrase = Passphrase }), HttpStatusCode.UnprocessableEntity, "IMPORT_PASSPHRASE_WRONG", "Passphrase");
        var newer = JsonNode.Parse(content)!;
        newer["version"] = 2;
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { content = newer.ToJsonString(), passphrase = Passphrase }), HttpStatusCode.Conflict, "IMPORT_FILE_NEWER");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { content = "{\"kind\":\"prism-vault\"}", passphrase = Passphrase }), HttpStatusCode.UnprocessableEntity, "IMPORT_FILE_INVALID", "Content");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { content, passphrase = "   " }), HttpStatusCode.UnprocessableEntity, "IMPORT_PASSPHRASE_INVALID", "Passphrase");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { content, passphrase = Passphrase, targetFolderID = Guid.CreateVersion7() }), HttpStatusCode.NotFound, "FOLDER_NOT_FOUND");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(ImportPath, new { content, passphrase = Passphrase, items = Array.Empty<string>() }), HttpStatusCode.UnprocessableEntity, "IMPORT_EMPTY");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(ImportPath, new { content, passphrase = Passphrase, items = new[] { "c9" } }), HttpStatusCode.UnprocessableEntity, "IMPORT_INVALID", "Items");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(ImportPath, new { content, passphrase = Passphrase, items = new[] { "c1" }, onConflict = "overwrite" }), HttpStatusCode.UnprocessableEntity, "IMPORT_INVALID", "OnConflict");

        Assert.That((await host.Client.GetAsync(FoldersPath)).StatusCode, Is.EqualTo(HttpStatusCode.OK));
    }

    /// <summary>
    /// RN-TRANSF-012 e 013: importado no mesmo cofre, a pasta de mesmo nome é a que existe (e não muda), a conexão de nome tomado vai com o nome da cópia ou
    /// fica de fora, e nada que existia muda.
    /// </summary>
    [Test]
    public async Task Import_IntoTheSameVault_MergesFoldersAndRenamesOrSkips()
    {
        var (started, _) = await StartAsync();
        await using var host = started;
        var seeded = await SeedAsync(host);
        var content = (await ReadJsonAsync(await ExportAsync(host, [], [(seeded.Nominal, "user")]))).GetProperty("content").GetString()!;
        var preview = await ReadJsonAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { content, passphrase = Passphrase }));
        var nominalPreview = preview.GetProperty("connections")[0];
        Assert.That(nominalPreview.GetProperty("conflict").GetBoolean(), Is.True);
        Assert.That(nominalPreview.GetProperty("copyName").GetString(), Is.EqualTo("NOMINAL (cópia)"));
        Assert.That(preview.GetProperty("folders").EnumerateArray().All(folder => folder.GetProperty("existing").GetBoolean()), Is.True);

        var skipped = await ReadJsonAsync(await host.Client.PostAsJsonAsync(ImportPath, new { content, passphrase = Passphrase, items = new[] { nominalPreview.GetProperty("key").GetString() }, onConflict = "skip" }));
        Assert.That(skipped.GetProperty("skipped").GetInt32(), Is.EqualTo(1));
        Assert.That(skipped.GetProperty("connectionIDs").GetArrayLength(), Is.EqualTo(0));

        var renamed = await ReadJsonAsync(await host.Client.PostAsJsonAsync(ImportPath, new { content, passphrase = Passphrase, items = new[] { nominalPreview.GetProperty("key").GetString() } }));
        Assert.That(renamed.GetProperty("renamed").GetInt32(), Is.EqualTo(1));
        Assert.That(renamed.GetProperty("mergedFolders").GetInt32(), Is.EqualTo(2));
        var names = (await ReadJsonAsync(await host.Client.GetAsync(ConnectionsPath))).EnumerateArray().Select(item => item.GetProperty("name").GetString()).ToList();
        Assert.That(names, Is.EquivalentTo(new[] { "DATA FIX", "NOMINAL", "NOMINAL (cópia)", "Relatórios" }));
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync(FoldersPath))).GetArrayLength(), Is.EqualTo(2));
    }

    /// <summary>
    /// RN-TRANSF-015 e 016: a conexão que chegou sem usuário e senha fica com os dois vazios; abrir sessão é recusado antes do driver, no campo que falta;
    /// testar sem senha no pedido é recusado no campo da senha; e renomear sem preencher nada passa, enquanto tirar o usuário de uma que tem não passa.
    /// </summary>
    [Test]
    public async Task CredentialLessConnection_IsRefusedBeforeTheDriver()
    {
        var (started, _) = await StartAsync();
        await using var host = started;
        var seeded = await SeedAsync(host);
        var content = (await ReadJsonAsync(await ExportAsync(host, [], [(seeded.Reports, "none"), (seeded.Nominal, "user")]))).GetProperty("content").GetString()!;
        await host.CreateUserAsync("joao.pereira", UserFakers.RandomPassword());
        var preview = await ReadJsonAsync(await host.Client.PostAsJsonAsync(PreviewPath, new { content, passphrase = Passphrase }));
        var keys = preview.GetProperty("folders").EnumerateArray().Concat(preview.GetProperty("connections").EnumerateArray()).Select(item => item.GetProperty("key").GetString()).ToArray();
        await host.Client.PostAsJsonAsync(ImportPath, new { content, passphrase = Passphrase, items = keys });
        var connections = (await ReadJsonAsync(await host.Client.GetAsync(ConnectionsPath))).EnumerateArray().ToDictionary(item => item.GetProperty("name").GetString()!);
        var reports = connections["Relatórios"];
        var nominal = connections["NOMINAL"];

        await AssertProblemAsync(await host.Client.PostAsJsonAsync("/api/user/database-sessions", new { connectionID = IdOf(reports) }), HttpStatusCode.UnprocessableEntity, "CONNECTION_CREDENTIALS_MISSING", "UserName");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync("/api/user/database-sessions", new { connectionID = IdOf(nominal) }), HttpStatusCode.UnprocessableEntity, "CONNECTION_CREDENTIALS_MISSING", "Password");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync($"{ConnectionsPath}/test", new { id = IdOf(nominal), engine = 3, host = "informix-prd.exemplo.invalid", port = 9089, database = "estoque", userName = "nominal" }), HttpStatusCode.UnprocessableEntity, "CONNECTION_CREDENTIALS_MISSING", "Password");

        var rename = await host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, ConnectionsPath) { Content = JsonContent.Create(new { id = IdOf(reports), name = "Relatórios 2026", engine = 1, host = "192.0.2.10", port = 5432, database = "relatorios", userName = "" }) });
        Assert.That(rename.StatusCode, Is.EqualTo(HttpStatusCode.OK), await rename.Content.ReadAsStringAsync());
        var removeUser = await host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, ConnectionsPath) { Content = JsonContent.Create(new { id = IdOf(nominal), folderID = nominal.GetProperty("folderID").GetGuid(), name = "NOMINAL", engine = 3, host = "informix-prd.exemplo.invalid", port = 9089, database = "estoque", userName = "" }) });
        await AssertProblemAsync(removeUser, HttpStatusCode.UnprocessableEntity, "CONNECTION_INVALID", "UserName");
    }

    /// <summary>
    /// As rotas da importação aceitam um corpo de até 6 MiB (`RequestSizeLimit`). Acima disso a requisição é recusada antes de o handler rodar; o status é o
    /// 500 do defeito conhecido de toda rota que lê corpo, e não 413, e o teste afirma só que ela não foi lida como uma importação.
    /// </summary>
    [Test]
    public async Task Import_BodyAboveTheLimit_IsNotRead()
    {
        var (started, _) = await StartAsync();
        await using var host = started;

        var response = await host.Client.PostAsJsonAsync(PreviewPath, new { content = new string('a', 6 * 1024 * 1024 + 1), passphrase = Passphrase });

        Assert.That(response.StatusCode, Is.Not.EqualTo(HttpStatusCode.OK).And.Not.EqualTo(HttpStatusCode.UnprocessableEntity));
    }
}
