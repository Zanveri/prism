using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// Criar usuário, entrar, sair e consultar a sessão (`api/public/users` e `api/public/sessions`), e a
/// barreira do cofre que fecha `api/user/...` enquanto nenhum está aberto (RN-API-005). Cada teste sobe
/// uma API própria, com a pasta de dados própria e o Argon2id pequeno do `ApiHost`.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class UsersAndSessionsTests
{
    private static Task<HttpResponseMessage> PostJsonAsync(HttpClient client, string path, string json)
        => client.PostAsync(path, new StringContent(json, Encoding.UTF8, "application/json"));

    private static Task<HttpResponseMessage> SignInAsync(ApiHost host, string userName, string password)
        => host.Client.PostAsJsonAsync("/api/public/sessions", new { userName, password });

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(status));
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));
    }

    private static string VaultPath(ApiHost host, string userName)
        => Path.Combine(host.DataDirectory, "vaults", $"{userName}.vault.json");

    /// <summary>Troca o número do formato no cabeçalho, como faria um Prism mais novo (ou quem editasse o arquivo à mão). `literal` é JSON.</summary>
    private static void SetFormat(string path, string literal)
    {
        var node = JsonNode.Parse(File.ReadAllText(path))!;
        node["version"] = JsonNode.Parse(literal);
        File.WriteAllText(path, node.ToJsonString());
    }

    /// <summary>Cria o usuário e uma pasta, para o `.bak` existir (a segunda gravação o cria), e sai. Devolve a senha.</summary>
    private static async Task<string> CreateVaultWithBackupAsync(ApiHost host, string userName)
    {
        var password = UserFakers.RandomPassword();
        await host.CreateUserAsync(userName, password);
        (await host.Client.PostAsJsonAsync("/api/user/folders", new { name = "Produção", parentID = (Guid?)null })).EnsureSuccessStatusCode();
        (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();
        Assert.That(File.Exists(VaultPath(host, userName) + ".bak"), Is.True);

        return password;
    }

    private static async Task AssertSessionAsync(ApiHost host, bool unlocked, string? userName)
    {
        var response = await host.Client.GetAsync("/api/public/sessions");
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(body.GetProperty("unlocked").GetBoolean(), Is.EqualTo(unlocked));
        Assert.That(body.GetProperty("userName").GetString(), Is.EqualTo(userName));
    }

    [Test]
    public async Task CreateUser_Valid_Returns201AndCreatesVaultFile()
    {
        await using var host = await ApiHost.StartAsync();

        // Maiúscula de propósito: o nome é gravado em minúsculas (RN-COFRE-010).
        var response = await host.Client.PostAsJsonAsync("/api/public/users", new { userName = "Marina.Costa", password = UserFakers.RandomPassword() });

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That(body.GetProperty("unlocked").GetBoolean(), Is.True);
        Assert.That(body.GetProperty("userName").GetString(), Is.EqualTo("marina.costa"));
        Assert.That(File.Exists(Path.Combine(host.DataDirectory, "vaults", "marina.costa.vault.json")), Is.True);
        await AssertSessionAsync(host, unlocked: true, userName: "marina.costa");
    }

    [Test]
    public async Task CreateUser_Duplicate_Returns409UserAlreadyExists()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        // Outra caixa: o nome é normalizado antes da conferência, então é o mesmo usuário.
        var response = await host.Client.PostAsJsonAsync("/api/public/users", new { userName = "MARINA.COSTA", password = UserFakers.RandomPassword() });

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "USER_ALREADY_EXISTS");
        Assert.That(Directory.GetFiles(Path.Combine(host.DataDirectory, "vaults"), "*.vault.json"), Has.Length.EqualTo(1));
    }

    /// <summary>RN-COFRE-001: nenhum nome com caminho grava fora de `vaults/`; a pasta de dados só tem `vaults/` e `logs/`.</summary>
    [Test]
    public async Task CreateUser_PathLikeName_Returns422AndCreatesNoFileOutsideVaults()
    {
        await using var host = await ApiHost.StartAsync();
        var outside = Path.Combine(Path.GetDirectoryName(host.DataDirectory)!, "prism-evil.vault.json");

        foreach (var userName in new[] { "../prism-evil", @"..\prism-evil", @"..\..\prism-evil", "vaults/prism-evil", "con", "nul.txt" })
        {
            var response = await host.Client.PostAsJsonAsync("/api/public/users", new { userName, password = UserFakers.RandomPassword() });

            await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "USERNAME_INVALID");
        }

        var created = Directory.GetFileSystemEntries(host.DataDirectory).Select(Path.GetFileName).ToList();
        Assert.That(created, Is.SubsetOf(new[] { "vaults", "logs" }));
        var vaults = Path.Combine(host.DataDirectory, "vaults");
        if (Directory.Exists(vaults))
            Assert.That(Directory.GetFileSystemEntries(vaults, "*", SearchOption.AllDirectories), Is.Empty);
        Assert.That(File.Exists(outside), Is.False);
        await AssertSessionAsync(host, unlocked: false, userName: null);
    }

    [Test]
    public async Task CreateUser_ShortPassword_Returns422PasswordInvalid()
    {
        await using var host = await ApiHost.StartAsync();

        var response = await host.Client.PostAsJsonAsync("/api/public/users", new { userName = "marina.costa", password = "1234567" });

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo("PASSWORD_INVALID"));
        // A tela lê `errors.password`: ela põe a primeira letra do nome da propriedade em minúscula.
        Assert.That(body.GetProperty("errors").TryGetProperty("Password", out var passwordErrors), Is.True);
        Assert.That(passwordErrors.GetArrayLength(), Is.GreaterThan(0));
        Assert.That(body.GetProperty("errors").TryGetProperty("UserName", out _), Is.False);
        Assert.That(File.Exists(Path.Combine(host.DataDirectory, "vaults", "marina.costa.vault.json")), Is.False);
    }

    [Test]
    public async Task CreateUser_ShortUserName_Returns422UserNameInvalid()
    {
        await using var host = await ApiHost.StartAsync();

        var response = await host.Client.PostAsJsonAsync("/api/public/users", new { userName = "ab", password = UserFakers.RandomPassword() });

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo("USERNAME_INVALID"));
        Assert.That(body.GetProperty("errors").TryGetProperty("UserName", out _), Is.True);
    }

    /// <summary>Campo ausente é regra do validator (422), e não do binding do MVC (400).</summary>
    [Test]
    public async Task CreateUser_WithMissingFields_Returns422()
    {
        await using var host = await ApiHost.StartAsync();

        var response = await PostJsonAsync(host.Client, "/api/public/users", "{}");

        await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "USERNAME_INVALID");
    }

    [Test]
    public async Task SignIn_RightPassword_Returns200WithUserName()
    {
        await using var host = await ApiHost.StartAsync();
        var password = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", password);
        (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();

        // Caixa e espaços nas pontas do nome: a entrada o normaliza como a criação.
        var response = await SignInAsync(host, " Marina.Costa ", password);

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(body.GetProperty("unlocked").GetBoolean(), Is.True);
        Assert.That(body.GetProperty("userName").GetString(), Is.EqualTo("marina.costa"));
        await AssertSessionAsync(host, unlocked: true, userName: "marina.costa");
    }

    /// <summary>RN-COFRE-006: quem tenta não descobre se o usuário existe. O custo da derivação é conferido no teste de unidade do serviço do cofre.</summary>
    [Test]
    public async Task SignIn_WrongPassword_And_UnknownUser_ReturnTheSameBody()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var wrongPassword = await SignInAsync(host, "marina.costa", UserFakers.RandomPassword());
        var unknownUser = await SignInAsync(host, "joao.silva", UserFakers.RandomPassword());

        await AssertProblemAsync(wrongPassword, HttpStatusCode.Unauthorized, "INVALID_CREDENTIALS");
        await AssertProblemAsync(unknownUser, HttpStatusCode.Unauthorized, "INVALID_CREDENTIALS");
        Assert.That(await unknownUser.Content.ReadAsStringAsync(), Is.EqualTo(await wrongPassword.Content.ReadAsStringAsync()));
    }

    /// <summary>
    /// RN-VERSAO-005: o cofre criado por um Prism mais novo responde 409, e não 401. A resposta é a mesma com a senha certa e com a errada (a
    /// recusa vem antes de a senha ser olhada; que nenhuma derivação aconteceu é conferido no teste de unidade do serviço do cofre), e o
    /// arquivo e o `.bak` ficam byte a byte como estavam.
    /// </summary>
    [Test]
    public async Task SignIn_VaultOfNewerFormat_Returns409VaultFormatUnsupported_AndDoesNotTouchTheFiles()
    {
        await using var host = await ApiHost.StartAsync();
        var password = await CreateVaultWithBackupAsync(host, "marina.costa");
        SetFormat(VaultPath(host, "marina.costa"), "4");
        var mainBytes = await File.ReadAllBytesAsync(VaultPath(host, "marina.costa"));
        var backupBytes = await File.ReadAllBytesAsync(VaultPath(host, "marina.costa") + ".bak");

        var withRightPassword = await SignInAsync(host, "marina.costa", password);
        var withWrongPassword = await SignInAsync(host, "marina.costa", UserFakers.RandomPassword());

        await AssertProblemAsync(withRightPassword, HttpStatusCode.Conflict, "VAULT_FORMAT_UNSUPPORTED");
        await AssertProblemAsync(withWrongPassword, HttpStatusCode.Conflict, "VAULT_FORMAT_UNSUPPORTED");
        var text = await withRightPassword.Content.ReadAsStringAsync();
        using var body = JsonDocument.Parse(text);
        Assert.That(body.RootElement.GetProperty("title").GetString(), Is.EqualTo("Cofre de uma versão mais nova do Prism."));
        Assert.That(body.RootElement.GetProperty("detail").GetString(), Is.EqualTo("Este cofre foi criado por uma versão mais nova do Prism. Atualize o Prism para abri-lo."));
        Assert.That(await withWrongPassword.Content.ReadAsStringAsync(), Is.EqualTo(text));
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host, "marina.costa")), Is.EqualTo(mainBytes));
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host, "marina.costa") + ".bak"), Is.EqualTo(backupBytes));
        await AssertSessionAsync(host, unlocked: false, userName: null);
    }

    /// <summary>RN-COFRE-005 com a RN-VERSAO-005: sem o principal, o `.bak` de formato mais novo responde o mesmo 409 e não é promovido.</summary>
    [Test]
    public async Task SignIn_OnlyBakOfNewerFormat_Returns409_AndDoesNotPromoteIt()
    {
        await using var host = await ApiHost.StartAsync();
        var password = await CreateVaultWithBackupAsync(host, "marina.costa");
        File.Delete(VaultPath(host, "marina.costa"));
        SetFormat(VaultPath(host, "marina.costa") + ".bak", "4");
        var backupBytes = await File.ReadAllBytesAsync(VaultPath(host, "marina.costa") + ".bak");

        var response = await SignInAsync(host, "marina.costa", password);

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "VAULT_FORMAT_UNSUPPORTED");
        Assert.That(File.Exists(VaultPath(host, "marina.costa")), Is.False);
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host, "marina.costa") + ".bak"), Is.EqualTo(backupBytes));
    }

    /// <summary>O principal manda: com o principal de formato mais novo e o `.bak` do formato atual, a resposta é 409 e nada é tocado.</summary>
    [Test]
    public async Task SignIn_MainOfNewerFormatAndBakOfCurrentFormat_Returns409_AndTouchesNothing()
    {
        await using var host = await ApiHost.StartAsync();
        var password = await CreateVaultWithBackupAsync(host, "marina.costa");
        SetFormat(VaultPath(host, "marina.costa"), "4");
        var mainBytes = await File.ReadAllBytesAsync(VaultPath(host, "marina.costa"));
        var backupBytes = await File.ReadAllBytesAsync(VaultPath(host, "marina.costa") + ".bak");

        var response = await SignInAsync(host, "marina.costa", password);

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "VAULT_FORMAT_UNSUPPORTED");
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host, "marina.costa")), Is.EqualTo(mainBytes));
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host, "marina.costa") + ".bak"), Is.EqualTo(backupBytes));
    }

    /// <summary>
    /// RN-VERSAO-005: o 409 é só para o formato mais NOVO. Formato 0, negativo ou que nem é número é cofre corrompido, e responde 401
    /// `INVALID_CREDENTIALS` com o mesmo corpo de uma senha errada.
    /// </summary>
    [Test]
    public async Task SignIn_VaultWithFormatThatIsNotNewer_Returns401InvalidCredentials()
    {
        await using var host = await ApiHost.StartAsync();
        var password = await CreateVaultWithBackupAsync(host, "marina.costa");
        var original = await File.ReadAllBytesAsync(VaultPath(host, "marina.costa"));
        var wrongPassword = await SignInAsync(host, "marina.costa", UserFakers.RandomPassword());

        foreach (var literal in new[] { "0", "-1", "\"abc\"", "\"2\"", "2.5", "null" })
        {
            SetFormat(VaultPath(host, "marina.costa"), literal);

            var response = await SignInAsync(host, "marina.costa", password);

            await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "INVALID_CREDENTIALS");
            Assert.That(await response.Content.ReadAsStringAsync(), Is.EqualTo(await wrongPassword.Content.ReadAsStringAsync()), literal);
            await File.WriteAllBytesAsync(VaultPath(host, "marina.costa"), original);
        }
    }

    /// <summary>Criar por cima apagaria o cofre de uma versão mais nova: continua 409 `USER_ALREADY_EXISTS`, e os arquivos não são tocados.</summary>
    [Test]
    public async Task CreateUser_OverVaultOfNewerFormat_Returns409UserAlreadyExists_AndDoesNotTouchTheFiles()
    {
        await using var host = await ApiHost.StartAsync();
        await CreateVaultWithBackupAsync(host, "marina.costa");
        SetFormat(VaultPath(host, "marina.costa"), "4");
        var mainBytes = await File.ReadAllBytesAsync(VaultPath(host, "marina.costa"));
        var backupBytes = await File.ReadAllBytesAsync(VaultPath(host, "marina.costa") + ".bak");

        var response = await host.Client.PostAsJsonAsync("/api/public/users", new { userName = "marina.costa", password = UserFakers.RandomPassword() });

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "USER_ALREADY_EXISTS");
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host, "marina.costa")), Is.EqualTo(mainBytes));
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host, "marina.costa") + ".bak"), Is.EqualTo(backupBytes));
        await AssertSessionAsync(host, unlocked: false, userName: null);
    }

    /// <summary>Ruling 18: a entrada nunca recusa o formato do nome. `con` é dispositivo do Windows, e responde como qualquer credencial inválida.</summary>
    [Test]
    public async Task SignIn_WithDeviceName_Returns401InvalidCredentials()
    {
        await using var host = await ApiHost.StartAsync();
        var unknownUser = await SignInAsync(host, "marina.costa", UserFakers.RandomPassword());

        var response = await SignInAsync(host, "con", UserFakers.RandomPassword());

        await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "INVALID_CREDENTIALS");
        Assert.That(await response.Content.ReadAsStringAsync(), Is.EqualTo(await unknownUser.Content.ReadAsStringAsync()));
        Assert.That(Directory.Exists(Path.Combine(host.DataDirectory, "vaults")), Is.False);
    }

    /// <summary>Ruling 18: campo vazio ou ausente também é 401, nunca 422. A senha vazia custa a mesma derivação (`VaultCrypto.DeriveKey`) e não estoura em 500.</summary>
    [Test]
    public async Task SignIn_WithEmptyBodyFields_Returns401InvalidCredentials()
    {
        await using var host = await ApiHost.StartAsync();

        foreach (var json in new[] { """{"userName":"","password":""}""", "{}", """{"userName":"   ","password":"x"}""", """{"userName":"marina.costa"}""" })
        {
            var response = await PostJsonAsync(host.Client, "/api/public/sessions", json);

            await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "INVALID_CREDENTIALS");
        }
    }

    [Test]
    public async Task GetSession_Locked_ReturnsUnlockedFalse()
    {
        await using var host = await ApiHost.StartAsync();

        var response = await host.Client.GetAsync("/api/public/sessions");

        // O corpo inteiro, e não só os valores: a tela espera `userName: null` com o cofre fechado, e não a chave ausente.
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(await response.Content.ReadAsStringAsync(), Is.EqualTo("""{"unlocked":false,"userName":null}"""));
    }

    [Test]
    public async Task GetSession_Unlocked_ReturnsUserName()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var response = await host.Client.GetAsync("/api/public/sessions");

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(await response.Content.ReadAsStringAsync(), Is.EqualTo("""{"unlocked":true,"userName":"marina.costa"}"""));
    }

    [Test]
    public async Task SignOut_Returns204_AndUserRoutesAnswer401VaultLocked()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        // Aberto, a barreira deixa passar: a rota não existe ainda, então é o 404 do roteamento e não o 401 do cofre.
        Assert.That((await host.Client.GetAsync("/api/user/qualquer-coisa")).StatusCode, Is.EqualTo(HttpStatusCode.NotFound));

        var response = await host.Client.DeleteAsync("/api/public/sessions");
        var again = await host.Client.DeleteAsync("/api/public/sessions");

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(await response.Content.ReadAsStringAsync(), Is.Empty);
        // Sair com o cofre já fechado também é 204.
        Assert.That(again.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        await AssertProblemAsync(await host.Client.GetAsync("/api/user/qualquer-coisa"), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertSessionAsync(host, unlocked: false, userName: null);
    }

    [Test]
    public async Task UserRoute_WhileLocked_Returns401VaultLocked()
    {
        await using var host = await ApiHost.StartAsync();

        var response = await host.Client.GetAsync("/api/user/qualquer-coisa");

        await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    /// <summary>O roteamento do ASP.NET não diferencia maiúsculas, então a barreira também não pode: `/API/USER/...` chega ao mesmo controller.</summary>
    [Test]
    public async Task UserRoute_WithOtherCasing_StillReturns401VaultLocked()
    {
        await using var host = await ApiHost.StartAsync();

        foreach (var path in new[] { "/API/USER/qualquer-coisa", "/Api/User/folders", "/api/user", "/api/user/" })
            await AssertProblemAsync(await host.Client.GetAsync(path), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    /// <summary>A barreira é só de `api/user/...`: `api/users` e `api/public/...` não passam por ela.</summary>
    [Test]
    public async Task OtherRoutes_WhileLocked_AreNotGated()
    {
        await using var host = await ApiHost.StartAsync();

        var similar = await host.Client.GetAsync("/api/users/qualquer-coisa");
        var publicRoute = await host.Client.GetAsync("/api/public/sessions");

        Assert.That(similar.StatusCode, Is.EqualTo(HttpStatusCode.NotFound));
        Assert.That(publicRoute.StatusCode, Is.EqualTo(HttpStatusCode.OK));
    }

    /// <summary>RN-COFRE-007: entrar com outro usuário fecha o cofre do primeiro.</summary>
    [Test]
    public async Task SignIn_AsSecondUser_ClosesTheFirst()
    {
        await using var host = await ApiHost.StartAsync();
        var firstPassword = UserFakers.RandomPassword();
        var secondPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("primeiro.usuario", firstPassword);
        await host.CreateUserAsync("segundo.usuario", secondPassword);
        await AssertSessionAsync(host, unlocked: true, userName: "segundo.usuario");

        (await SignInAsync(host, "primeiro.usuario", firstPassword)).EnsureSuccessStatusCode();
        await AssertSessionAsync(host, unlocked: true, userName: "primeiro.usuario");
        (await SignInAsync(host, "segundo.usuario", secondPassword)).EnsureSuccessStatusCode();

        await AssertSessionAsync(host, unlocked: true, userName: "segundo.usuario");
    }
}
