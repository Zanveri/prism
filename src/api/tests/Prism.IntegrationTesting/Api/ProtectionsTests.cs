using Prism.IntegrationTesting.Api.Support;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// As proteções da conexão e da pasta e a verificação periódica pelas rotas de verdade, sem banco (seção 32 da especificação): os campos novos
/// de `api/user/folders` e `api/user/connections`, as que valem herdadas das pastas acima (RN-PROT-004), a senha do usuário que o somente leitura
/// pede (RN-PROT-003), as recusas no campo, a verificação sem sessão aberta (RN-VERIF-002) e o teste de conexão com a consulta do formulário
/// (RN-CONN-013), recusada antes de conectar. Cada teste sobe uma API própria, com a pasta de dados própria.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class ProtectionsTests
{
    private const string ConnectionsPath = "/api/user/connections";
    private const string FoldersPath = "/api/user/folders";
    private const string UserName = "marina.costa";

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<(ApiHost Host, string Password)> StartAsync()
    {
        var host = await ApiHost.StartAsync();
        var password = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, password);

        return (host, password);
    }

    /// <summary>Confere o status, o código e o campo da recusa, na forma do filtro de validação (`errors` e `errorCodes` com o nome em PascalCase).</summary>
    private static async Task AssertFieldProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type, string field)
    {
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(status), body.ToString());
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));
        Assert.That(body.GetProperty("errorCodes").GetProperty(field)[0].GetString(), Is.EqualTo(type));
    }

    private static Dictionary<string, object?> FolderBody(string name, Guid? parentID = null, string? confirmCommands = null, bool readOnly = false)
        => new() { ["name"] = name, ["parentID"] = parentID, ["confirmCommands"] = confirmCommands, ["readOnly"] = readOnly };

    private static Dictionary<string, object?> ConnectionBody(Guid? folderID = null, string name = "MES Produção", string? confirmCommands = null, bool readOnly = false)
        => new() { ["folderID"] = folderID, ["name"] = name, ["engine"] = 1, ["host"] = "192.0.2.10", ["port"] = 5432, ["database"] = "mes", ["userName"] = "leitor", ["password"] = "senha-do-banco-de-exemplo", ["confirmCommands"] = confirmCommands, ["readOnly"] = readOnly };

    private static async Task<JsonElement> CreateAsync(ApiHost host, string path, Dictionary<string, object?> body)
    {
        var response = await host.Client.PostAsJsonAsync(path, body);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created), await response.Content.ReadAsStringAsync());

        return await ReadJsonAsync(response);
    }

    private static Task<HttpResponseMessage> PatchAsync(ApiHost host, string path, Guid id, Dictionary<string, object?> body)
        => host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, path) { Content = JsonContent.Create(new Dictionary<string, object?>(body) { ["id"] = id }) });

    private static Guid IdOf(JsonElement item)
        => item.GetProperty("id").GetGuid();

    private static async Task<JsonElement> GetConnectionAsync(ApiHost host, Guid id)
    {
        var response = await host.Client.GetAsync($"{ConnectionsPath}/{id}");
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));

        return await ReadJsonAsync(response);
    }

    /// <summary>RN-PROT-001 e RN-VERIF-001: sem os campos, a conexão sai com o padrão; com eles, como foram gravados, e o "none" é o "Não" nulo.</summary>
    [Test]
    public async Task Connection_SafeguardsAreCreatedWithTheirDefaults_AndRoundTrip()
    {
        var (started, _) = await StartAsync();
        await using var host = started;

        var plain = await CreateAsync(host, ConnectionsPath, ConnectionBody(name: "Sem nada"));
        var none = await CreateAsync(host, ConnectionsPath, new Dictionary<string, object?>(ConnectionBody(name: "Com none")) { ["confirmCommands"] = "none" });
        var full = await CreateAsync(host, ConnectionsPath, new Dictionary<string, object?>(ConnectionBody(name: "Com tudo", confirmCommands: "irreversible", readOnly: true)) { ["verificationEnabled"] = false, ["verificationInterval"] = 120, ["verificationQuery"] = "  SELECT 1  " });
        var read = await GetConnectionAsync(host, IdOf(full));

        Assert.That(plain.GetProperty("confirmCommands").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(plain.GetProperty("readOnly").GetBoolean(), Is.False);
        Assert.That(plain.GetProperty("verificationEnabled").GetBoolean(), Is.True);
        Assert.That(plain.GetProperty("verificationInterval").GetInt32(), Is.EqualTo(30));
        Assert.That(plain.GetProperty("verificationQuery").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(none.GetProperty("confirmCommands").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(read.GetProperty("confirmCommands").GetString(), Is.EqualTo("irreversible"));
        Assert.That(read.GetProperty("readOnly").GetBoolean(), Is.True);
        Assert.That(read.GetProperty("verificationEnabled").GetBoolean(), Is.False);
        Assert.That(read.GetProperty("verificationInterval").GetInt32(), Is.EqualTo(120));
        Assert.That(read.GetProperty("verificationQuery").GetString(), Is.EqualTo("SELECT 1"));
        Assert.That(read.GetProperty("protections").GetProperty("readOnly").GetBoolean(), Is.True);
        Assert.That(read.GetProperty("protections").GetProperty("readOnlyFolderID").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(read.GetProperty("protections").GetProperty("confirmCommands").GetString(), Is.EqualTo("irreversible"));
    }

    /// <summary>RN-PROT-004: as proteções de uma pasta valem para tudo o que está dentro dela, com a pasta que as impõe; a conexão não as afrouxa.</summary>
    [Test]
    public async Task Protections_AreInheritedFromEveryFolderAbove()
    {
        var (started, _) = await StartAsync();
        await using var host = started;

        var factory = await CreateAsync(host, FoldersPath, FolderBody("Fábrica", confirmCommands: "irreversible", readOnly: true));
        var line = await CreateAsync(host, FoldersPath, FolderBody("Linha 1", IdOf(factory), confirmCommands: "all"));
        var connection = await CreateAsync(host, ConnectionsPath, ConnectionBody(IdOf(line)));
        var listed = (await ReadJsonAsync(await host.Client.GetAsync(ConnectionsPath))).EnumerateArray().Single();
        var folders = (await ReadJsonAsync(await host.Client.GetAsync(FoldersPath))).EnumerateArray().ToList();
        var lineListed = folders.Single(folder => IdOf(folder) == IdOf(line));

        foreach (var item in new[] { connection, listed })
        {
            var protections = item.GetProperty("protections");
            Assert.That(item.GetProperty("readOnly").GetBoolean(), Is.False);
            Assert.That(protections.GetProperty("readOnly").GetBoolean(), Is.True);
            Assert.That(protections.GetProperty("readOnlyFolderID").GetGuid(), Is.EqualTo(IdOf(factory)));
            Assert.That(protections.GetProperty("confirmCommands").GetString(), Is.EqualTo("all"));
            Assert.That(protections.GetProperty("confirmCommandsFolderID").GetGuid(), Is.EqualTo(IdOf(line)));
        }

        Assert.That(lineListed.GetProperty("confirmCommands").GetString(), Is.EqualTo("all"));
        Assert.That(lineListed.GetProperty("protections").GetProperty("readOnlyFolderID").GetGuid(), Is.EqualTo(IdOf(factory)));
        Assert.That(lineListed.GetProperty("protections").GetProperty("confirmCommandsFolderID").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    /// <summary>
    /// RN-PROT-003: desmarcar o somente leitura da conexão pede a senha do usuário. Sem ela, 422 `USER_PASSWORD_REQUIRED`; errada, 422
    /// `INVALID_PASSWORD`; as duas no campo `UserPassword`, sem gravar nada. Certa, grava.
    /// </summary>
    [Test]
    public async Task Connection_ReadOnlyChange_AsksForTheUserPassword()
    {
        var (started, password) = await StartAsync();
        await using var host = started;
        var connection = await CreateAsync(host, ConnectionsPath, ConnectionBody(readOnly: true));
        var id = IdOf(connection);
        var unmarked = new Dictionary<string, object?>(ConnectionBody()) { ["password"] = null };

        var missing = await PatchAsync(host, ConnectionsPath, id, unmarked);
        var wrong = await PatchAsync(host, ConnectionsPath, id, new Dictionary<string, object?>(unmarked) { ["userPassword"] = password + "x" });
        var stillReadOnly = (await GetConnectionAsync(host, id)).GetProperty("readOnly").GetBoolean();
        var right = await PatchAsync(host, ConnectionsPath, id, new Dictionary<string, object?>(unmarked) { ["userPassword"] = password });
        var renamedWithoutPassword = await PatchAsync(host, ConnectionsPath, id, new Dictionary<string, object?>(unmarked) { ["name"] = "Outro nome", ["confirmCommands"] = "all" });

        await AssertFieldProblemAsync(missing, HttpStatusCode.UnprocessableEntity, "USER_PASSWORD_REQUIRED", "UserPassword");
        await AssertFieldProblemAsync(wrong, HttpStatusCode.UnprocessableEntity, "INVALID_PASSWORD", "UserPassword");
        Assert.That(stillReadOnly, Is.True);
        Assert.That(right.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await ReadJsonAsync(right)).GetProperty("readOnly").GetBoolean(), Is.False);
        Assert.That(renamedWithoutPassword.StatusCode, Is.EqualTo(HttpStatusCode.OK));
    }

    /// <summary>RN-PROT-003 e RN-CONN-003: o quinto erro seguido, somando os da revelação da senha, fecha o cofre e responde 401.</summary>
    [Test]
    public async Task Folder_ReadOnlyChange_FifthWrongPasswordLocksTheVault()
    {
        var (started, password) = await StartAsync();
        await using var host = started;
        var folder = await CreateAsync(host, FoldersPath, FolderBody("Fábrica"));
        var connection = await CreateAsync(host, ConnectionsPath, ConnectionBody());
        var marking = FolderBody("Fábrica", readOnly: true);
        marking["userPassword"] = password + "x";

        var reveals = new List<HttpStatusCode>();
        for (var attempt = 1; attempt <= 2; attempt++)
            reveals.Add((await host.Client.PostAsJsonAsync($"{ConnectionsPath}/{IdOf(connection)}/password/reveal", new { password = password + "x" })).StatusCode);

        var wrong = new List<HttpStatusCode>();
        for (var attempt = 1; attempt <= 2; attempt++)
            wrong.Add((await PatchAsync(host, FoldersPath, IdOf(folder), marking)).StatusCode);

        var fifth = await PatchAsync(host, FoldersPath, IdOf(folder), marking);
        var afterwards = await host.Client.GetAsync(FoldersPath);

        Assert.That(reveals, Is.All.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That(wrong, Is.All.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That(fifth.StatusCode, Is.EqualTo(HttpStatusCode.Unauthorized));
        Assert.That((await ReadJsonAsync(fifth)).GetProperty("type").GetString(), Is.EqualTo("VAULT_LOCKED"));
        Assert.That(afterwards.StatusCode, Is.EqualTo(HttpStatusCode.Unauthorized));
    }

    /// <summary>RN-PROT-003: tirar a conexão da pasta somente leitura afrouxa o herdado, e pede a senha; criar dentro dela e mover para dentro, não.</summary>
    [Test]
    public async Task Connection_MovingOutOfAReadOnlyFolder_AsksForTheUserPassword()
    {
        var (started, password) = await StartAsync();
        await using var host = started;
        var factory = await CreateAsync(host, FoldersPath, FolderBody("Fábrica", readOnly: true));
        var connection = await CreateAsync(host, ConnectionsPath, ConnectionBody(IdOf(factory)));
        var outside = new Dictionary<string, object?>(ConnectionBody()) { ["password"] = null };

        var missing = await PatchAsync(host, ConnectionsPath, IdOf(connection), outside);
        var right = await PatchAsync(host, ConnectionsPath, IdOf(connection), new Dictionary<string, object?>(outside) { ["userPassword"] = password });
        var backIn = await PatchAsync(host, ConnectionsPath, IdOf(connection), new Dictionary<string, object?>(outside) { ["folderID"] = IdOf(factory) });

        await AssertFieldProblemAsync(missing, HttpStatusCode.UnprocessableEntity, "USER_PASSWORD_REQUIRED", "UserPassword");
        Assert.That(right.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await ReadJsonAsync(right)).GetProperty("protections").GetProperty("readOnly").GetBoolean(), Is.False);
        Assert.That(backIn.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await ReadJsonAsync(backIn)).GetProperty("protections").GetProperty("readOnlyFolderID").GetGuid(), Is.EqualTo(IdOf(factory)));
    }

    /// <summary>RN-PROT-001 e RN-VERIF-001: as recusas dos campos novos são 422 no campo, com o código de cada rota.</summary>
    [Test]
    public async Task InvalidSafeguards_AreRefusedOnTheField()
    {
        var (started, _) = await StartAsync();
        await using var host = started;

        var folder = await host.Client.PostAsJsonAsync(FoldersPath, FolderBody("Fábrica", confirmCommands: "sempre"));
        var confirm = await host.Client.PostAsJsonAsync(ConnectionsPath, ConnectionBody(confirmCommands: "ALL"));
        var interval = await host.Client.PostAsJsonAsync(ConnectionsPath, new Dictionary<string, object?>(ConnectionBody()) { ["verificationInterval"] = 4 });
        var query = await host.Client.PostAsJsonAsync(ConnectionsPath, new Dictionary<string, object?>(ConnectionBody()) { ["verificationQuery"] = "DELETE FROM pedido" });
        var queryBody = await ReadJsonAsync(query);

        await AssertFieldProblemAsync(folder, HttpStatusCode.UnprocessableEntity, "FOLDER_NAME_INVALID", "ConfirmCommands");
        await AssertFieldProblemAsync(confirm, HttpStatusCode.UnprocessableEntity, "CONNECTION_INVALID", "ConfirmCommands");
        await AssertFieldProblemAsync(interval, HttpStatusCode.UnprocessableEntity, "CONNECTION_INVALID", "VerificationInterval");
        Assert.That(queryBody.GetProperty("errors").GetProperty("VerificationQuery")[0].GetString(), Is.EqualTo("A consulta de verificação tem de ser uma leitura só: um DELETE não é leitura."));
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync(ConnectionsPath))).GetArrayLength(), Is.Zero);
    }

    /// <summary>RN-VERIF-002: sem sessão aberta não há o que verificar, e nenhuma sessão é aberta para isso; a conexão que não existe é 404.</summary>
    [Test]
    public async Task Verification_WithoutAnOpenSession_IsNotConnected()
    {
        using var counter = new ConnectionCounter();
        var (started, _) = await StartAsync();
        await using var host = started;
        var body = ConnectionBody();
        body["host"] = "127.0.0.1";
        body["port"] = counter.Port;
        var connection = await CreateAsync(host, ConnectionsPath, body);

        var verified = await host.Client.PostAsync($"{ConnectionsPath}/{IdOf(connection)}/verification", null);
        var verifiedBody = await ReadJsonAsync(verified);
        var missing = await host.Client.PostAsync($"{ConnectionsPath}/{Guid.CreateVersion7()}/verification", null);

        Assert.That(verified.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(verifiedBody.GetProperty("status").GetString(), Is.EqualTo("notConnected"));
        Assert.That(verifiedBody.GetProperty("checkedAt").GetDateTime(), Is.Not.EqualTo(default(DateTime)));
        Assert.That(verifiedBody.GetProperty("elapsedMs").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(counter.Accepted, Is.Zero);
        Assert.That(missing.StatusCode, Is.EqualTo(HttpStatusCode.NotFound));
        Assert.That((await ReadJsonAsync(missing)).GetProperty("type").GetString(), Is.EqualTo("CONNECTION_NOT_FOUND"));
    }

    /// <summary>RN-CONN-013: a consulta de verificação do formulário que não é uma leitura só é recusada no campo, antes de conectar.</summary>
    [Test]
    public async Task TestConnection_WithAnInvalidVerificationQuery_IsRefusedBeforeConnecting()
    {
        using var counter = new ConnectionCounter();
        var (started, _) = await StartAsync();
        await using var host = started;
        var body = new Dictionary<string, object?> { ["engine"] = 1, ["host"] = "127.0.0.1", ["port"] = counter.Port, ["database"] = "mes", ["userName"] = "leitor", ["password"] = "senha-do-banco-de-exemplo" };

        var refused = await host.Client.PostAsJsonAsync($"{ConnectionsPath}/test", new Dictionary<string, object?>(body) { ["verificationQuery"] = "SELECT 1; SELECT 2" });
        var acceptedBefore = counter.Accepted;
        var tried = await host.Client.PostAsJsonAsync($"{ConnectionsPath}/test", new Dictionary<string, object?>(body) { ["verificationQuery"] = "SELECT 1" });

        await AssertFieldProblemAsync(refused, HttpStatusCode.UnprocessableEntity, "CONNECTION_INVALID", "VerificationQuery");
        Assert.That(acceptedBefore, Is.Zero);
        Assert.That(tried.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That(counter.Accepted, Is.GreaterThan(0));
    }
}
