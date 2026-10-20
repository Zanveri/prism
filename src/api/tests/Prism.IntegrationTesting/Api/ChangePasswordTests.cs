using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// A troca da senha do usuário (`PUT api/user/password`, RN-COFRE-013) pela API de verdade: a senha nova abre e a antiga não, as recusas e os
/// códigos, o cofre aberto com o mesmo conteúdo, a falha de disco que deixa a senha antiga, e a troca ao mesmo tempo de outras gravações. A
/// barreira do cofre e o token já são provados em `FoldersTests`; aqui se confere que a rota nova fica atrás deles. Cada teste sobe uma API
/// própria, com o cofre e a pasta de dados próprios, e o Argon2id pequeno do `ApiHost`. Que a senha errada custa a mesma derivação de uma entrada
/// errada não se mede em HTTP: é a contagem de derivações do teste de unidade do serviço do cofre, como a da RN-COFRE-006.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class ChangePasswordTests
{
    private const string UserName = "marina.costa";
    private const string PasswordPath = "/api/user/password";
    private const string ConnectionsPath = "/api/user/connections";

    /// <summary>Marca única da senha de um banco: a prova de que a troca não a perde nem a vaza é procurá-la, inteira, onde ela tem de estar.</summary>
    private const string DatabasePassword = "marca-da-senha-do-banco-5Z";

    private static Task<HttpResponseMessage> ChangeAsync(ApiHost host, string currentPassword, string newPassword)
        => host.Client.PutAsJsonAsync(PasswordPath, new { currentPassword, newPassword });

    private static Task<HttpResponseMessage> ChangeRawAsync(ApiHost host, string json)
        => host.Client.PutAsync(PasswordPath, new StringContent(json, Encoding.UTF8, "application/json"));

    private static Task<HttpResponseMessage> SignInAsync(ApiHost host, string password, string userName = UserName)
        => host.Client.PostAsJsonAsync("/api/public/sessions", new { userName, password });

    private static async Task SignOutAsync(ApiHost host)
        => (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();

    private static Task<HttpResponseMessage> RevealAsync(ApiHost host, Guid id, string password)
        => host.Client.PostAsJsonAsync($"{ConnectionsPath}/{id}/password/reveal", new { password });

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    /// <summary>Confere o status, o formato e o código do erro e devolve o corpo: o conteúdo da resposta só pode ser lido uma vez.</summary>
    private static async Task<JsonElement> AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(status), body.ToString());
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));

        return body;
    }

    /// <summary>
    /// Os nomes dos campos em `errors` e `errorCodes` saem como nas outras rotas (o nome da propriedade em PascalCase: `Password` na criação de conta), e a
    /// tela os lê com a primeira letra em minúscula. A senha atual errada é `INVALID_PASSWORD` no `CurrentPassword` (o código da revelação de senha), a
    /// senha nova inválida é `PASSWORD_INVALID` no `NewPassword` (o da criação de conta), e a igual à atual é `PASSWORD_UNCHANGED` no `NewPassword`.
    /// </summary>
    private static void AssertOnlyField(JsonElement body, string field, string code)
    {
        var errors = body.GetProperty("errors").EnumerateObject().Select(property => property.Name).ToList();
        var errorCodes = body.GetProperty("errorCodes");

        Assert.That(errors, Is.EqualTo(new[] { field }));
        Assert.That(body.GetProperty("errors").GetProperty(field).GetArrayLength(), Is.GreaterThan(0));
        Assert.That(errorCodes.GetProperty(field).EnumerateArray().Select(value => value.GetString()), Is.EqualTo(new[] { code }));
    }

    private static string VaultPath(ApiHost host, string userName = UserName)
        => Path.Combine(host.DataDirectory, "vaults", $"{userName}.vault.json");

    private static JsonNode ReadVaultFile(ApiHost host, string? path = null)
        => JsonNode.Parse(File.ReadAllText(path ?? VaultPath(host)))!;

    private static async Task AssertSessionAsync(ApiHost host, bool unlocked)
    {
        var body = await ReadJsonAsync(await host.Client.GetAsync("/api/public/sessions"));

        Assert.That(body.GetProperty("unlocked").GetBoolean(), Is.EqualTo(unlocked));
    }

    private static async Task AssertSignsInOnlyWithAsync(ApiHost host, string rightPassword, params string[] wrongPasswords)
    {
        foreach (var wrongPassword in wrongPasswords)
        {
            await SignOutAsync(host);
            await AssertProblemAsync(await SignInAsync(host, wrongPassword), HttpStatusCode.Unauthorized, "INVALID_CREDENTIALS");
        }

        await SignOutAsync(host);
        Assert.That((await SignInAsync(host, rightPassword)).StatusCode, Is.EqualTo(HttpStatusCode.OK));
    }

    private static object ConnectionBody(string name, string password = DatabasePassword)
        => new { folderID = (Guid?)null, name, engine = 1, host = "pg.local", port = 5432, database = "producao", userName = "operador", password, environmentName = (string?)null, environmentColor = (string?)null };

    private static async Task<Guid> CreateConnectionAsync(ApiHost host, string name = "Produção")
    {
        var response = await host.Client.PostAsJsonAsync(ConnectionsPath, ConnectionBody(name));
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));

        return (await ReadJsonAsync(response)).GetProperty("id").GetGuid();
    }

    [Test]
    public async Task Change_RightPasswords_Returns204_AndOnlyTheNewOneSignsIn()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        var newPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);

        var response = await ChangeAsync(host, oldPassword, newPassword);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(await response.Content.ReadAsStringAsync(), Is.Empty);
        // O cofre continua aberto: a troca não sai nem entra.
        await AssertSessionAsync(host, unlocked: true);
        await AssertSignsInOnlyWithAsync(host, newPassword, oldPassword);
    }

    /// <summary>Espaço nas pontas faz parte da senha, como na criação e na entrada: as duas senhas seguem como vieram.</summary>
    [Test]
    public async Task Change_PasswordsWithSpacesAtTheEnds_AreUsedAsTheyCame()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = $"  {UserFakers.RandomPassword()}  ";
        var newPassword = $"  {UserFakers.RandomPassword()}  ";
        await host.CreateUserAsync(UserName, oldPassword);

        var response = await ChangeAsync(host, oldPassword, newPassword);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        await AssertSignsInOnlyWithAsync(host, newPassword, oldPassword, newPassword.Trim(), oldPassword.Trim());
    }

    [Test]
    public async Task Change_WrongCurrentPassword_Returns422InvalidPassword_OnTheCurrentPasswordField_AndChangesNothing()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        var wrongPassword = UserFakers.RandomPassword();
        var newPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);
        var fileBefore = await File.ReadAllBytesAsync(VaultPath(host));

        var response = await ChangeAsync(host, wrongPassword, newPassword);

        // 422, nunca 401: a chamada já está autenticada (RN-COFRE-013). O campo é o da senha atual, não o da nova.
        var raw = await response.Content.ReadAsStringAsync();
        using var parsed = JsonDocument.Parse(raw);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(parsed.RootElement.GetProperty("type").GetString(), Is.EqualTo("INVALID_PASSWORD"));
        AssertOnlyField(parsed.RootElement, "CurrentPassword", "INVALID_PASSWORD");
        // A resposta não devolve senha nenhuma, nem a errada que veio.
        Assert.That(raw, Does.Not.Contain(wrongPassword).And.Not.Contain(newPassword).And.Not.Contain(oldPassword));
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host)), Is.EqualTo(fileBefore));
        await AssertSessionAsync(host, unlocked: true);
        await AssertSignsInOnlyWithAsync(host, oldPassword, newPassword);
    }

    /// <summary>
    /// A senha nova segue as regras da criação de conta (RN-COFRE-010): os mesmos casos recusados, 422 `PASSWORD_INVALID` no campo `NewPassword`
    /// (e não no da senha atual: é o campo que distingue esta recusa da de senha atual errada). A recusa vem do validator, antes de qualquer
    /// derivação, então nenhuma conta como um dos cinco erros seguidos: sete recusas depois, a troca certa ainda passa.
    /// </summary>
    [Test]
    public async Task Change_InvalidNewPassword_Returns422PasswordInvalid_OnTheNewPasswordField_ForTheSameCasesAsCreateUser()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);
        var fileBefore = await File.ReadAllBytesAsync(VaultPath(host));

        foreach (var newPassword in new[] { new string('x', 7), new string('x', 129), string.Empty, "1234567", " ", new string('é', 129), new string('é', 7) })
        {
            var response = await ChangeAsync(host, oldPassword, newPassword);

            var body = await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "PASSWORD_INVALID");
            AssertOnlyField(body, "NewPassword", "PASSWORD_INVALID");
        }

        // Campo ausente é regra do validator (422), e não do binding do MVC (400), como na criação.
        var missing = await ChangeRawAsync(host, "{}");
        AssertOnlyField(await AssertProblemAsync(missing, HttpStatusCode.UnprocessableEntity, "PASSWORD_INVALID"), "NewPassword", "PASSWORD_INVALID");
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host)), Is.EqualTo(fileBefore));
        await AssertSessionAsync(host, unlocked: true);
        Assert.That((await ChangeAsync(host, oldPassword, UserFakers.RandomPassword())).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
    }

    /// <summary>RN-COFRE-010: 8 e 128 caracteres são válidos, sem regra de composição.</summary>
    [Test]
    public async Task Change_NewPasswordWithEightAndWith128Characters_Returns204()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        var shortest = new string('x', 8);
        var longest = new string('y', 128);
        await host.CreateUserAsync(UserName, oldPassword);

        var first = await ChangeAsync(host, oldPassword, shortest);
        var second = await ChangeAsync(host, shortest, longest);

        Assert.That(first.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(second.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        await AssertSignsInOnlyWithAsync(host, longest, shortest, oldPassword);
    }

    [Test]
    public async Task Change_SameAsCurrent_Returns422PasswordUnchanged_OnTheNewPasswordField()
    {
        await using var host = await ApiHost.StartAsync();
        var password = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, password);
        var fileBefore = await File.ReadAllBytesAsync(VaultPath(host));

        var response = await ChangeAsync(host, password, password);

        var raw = await response.Content.ReadAsStringAsync();
        using var parsed = JsonDocument.Parse(raw);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That(parsed.RootElement.GetProperty("type").GetString(), Is.EqualTo("PASSWORD_UNCHANGED"));
        AssertOnlyField(parsed.RootElement, "NewPassword", "PASSWORD_UNCHANGED");
        Assert.That(raw, Does.Not.Contain(password));
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host)), Is.EqualTo(fileBefore));
        await AssertSignsInOnlyWithAsync(host, password);
    }

    /// <summary>A igualdade só se olha depois de a senha atual conferir: igual à nova, mas errada, é senha atual errada.</summary>
    [Test]
    public async Task Change_WrongCurrentEqualToTheNew_Returns422InvalidPassword_NotUnchanged()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var wrongPassword = UserFakers.RandomPassword();

        var response = await ChangeAsync(host, wrongPassword, wrongPassword);

        var body = await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "INVALID_PASSWORD");
        AssertOnlyField(body, "CurrentPassword", "INVALID_PASSWORD");
    }

    [Test]
    public async Task Change_WithoutToken_Returns401AuthenticationRequired_AndChangesNothing()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        var newPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);

        var response = await host.ClientWithoutToken.PutAsJsonAsync(PasswordPath, new { currentPassword = oldPassword, newPassword });

        await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "AUTHENTICATION_REQUIRED");
        // Se a chamada sem token tivesse trocado a senha, esta (com a antiga) seria recusada.
        Assert.That((await ChangeAsync(host, oldPassword, newPassword)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
    }

    [Test]
    public async Task Change_WhileLocked_Returns401VaultLocked_AndChangesNothing()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);
        await SignOutAsync(host);
        var fileBefore = await File.ReadAllBytesAsync(VaultPath(host));

        var response = await ChangeAsync(host, oldPassword, UserFakers.RandomPassword());

        await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host)), Is.EqualTo(fileBefore));
        await AssertSessionAsync(host, unlocked: false);
        Assert.That((await SignInAsync(host, oldPassword)).StatusCode, Is.EqualTo(HttpStatusCode.OK));
    }

    /// <summary>
    /// A senha atual errada é uma das cinco tentativas da revelação de senha (RN-CONN-003): o quinto erro seguido fecha o cofre e responde 401
    /// `VAULT_LOCKED`, e não o 422. Quem tenta adivinhar a senha por esta rota não tem mais tentativas do que teria pela da revelação.
    /// </summary>
    [Test]
    public async Task Change_FifthWrongCurrentPasswordInARow_Returns401VaultLocked_AndTheOldPasswordStillSignsIn()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);
        var fileBefore = await File.ReadAllBytesAsync(VaultPath(host));

        for (var attempt = 1; attempt <= 4; attempt++)
            await AssertProblemAsync(await ChangeAsync(host, UserFakers.RandomPassword(), UserFakers.RandomPassword()), HttpStatusCode.UnprocessableEntity, "INVALID_PASSWORD");

        var fifth = await ChangeAsync(host, UserFakers.RandomPassword(), UserFakers.RandomPassword());

        await AssertProblemAsync(fifth, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertSessionAsync(host, unlocked: false);
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host)), Is.EqualTo(fileBefore));
        Assert.That((await SignInAsync(host, oldPassword)).StatusCode, Is.EqualTo(HttpStatusCode.OK));
    }

    /// <summary>
    /// A contagem é uma só com a revelação: três senhas erradas ao revelar e duas ao trocar fecham o cofre. E é a senha ATUAL errada que conta, não a
    /// nova inválida (essa nem chega ao serviço).
    /// </summary>
    [Test]
    public async Task Change_WrongCurrentPasswords_CountTogetherWithTheReveal()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var connectionID = await CreateConnectionAsync(host);

        for (var attempt = 1; attempt <= 3; attempt++)
            await AssertProblemAsync(await RevealAsync(host, connectionID, UserFakers.RandomPassword()), HttpStatusCode.UnprocessableEntity, "INVALID_PASSWORD");

        await AssertProblemAsync(await ChangeAsync(host, UserFakers.RandomPassword(), UserFakers.RandomPassword()), HttpStatusCode.UnprocessableEntity, "INVALID_PASSWORD");
        await AssertProblemAsync(await ChangeAsync(host, UserFakers.RandomPassword(), UserFakers.RandomPassword()), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertSessionAsync(host, unlocked: false);
    }

    /// <summary>
    /// A rota tem um teto de corpo pequeno (16 KiB, `[RequestSizeLimit]`): duas senhas de até 128 caracteres cabem com folga. Um corpo maior é recusado antes de o
    /// handler rodar (nada é derivado, nenhum erro é contado, nada muda), e um corpo dentro do teto segue o fluxo normal. Sem o teto, este mesmo corpo chegaria ao
    /// validator e daria 422 `PASSWORD_INVALID`, e é isso que o teste distingue.
    ///
    /// O status que sai hoje do corpo acima do teto é 500 `INTERNAL_SERVER_ERROR`, e não 413: o `UseExceptionHandler` troca o `BadHttpRequestException` do
    /// Kestrel pelo 500 fixo, em TODA rota que lê um corpo (é anterior a esta tarefa e fica para a leva final). Por isso o teste não afirma o 500 nem o 413: afirma que
    /// a requisição não foi lida como uma troca (nem 204 nem 422). Quando o defeito geral for consertado, este deve passar a afirmar o 413.
    /// </summary>
    [Test]
    public async Task Change_WithABodyOverTheCap_IsRefusedBeforeTheHandler_AndChangesNothing()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);
        var fileBefore = await File.ReadAllBytesAsync(VaultPath(host));
        var padding = new string('x', 20 * 1024);

        // Mais que o teto, com a senha atual CERTA: se o corpo fosse lido e conferido, a senha nova inválida daria 422.
        var over = await ChangeRawAsync(host, $$"""{"currentPassword":"{{oldPassword}}","newPassword":"{{padding}}"}""");

        Assert.That(over.StatusCode, Is.Not.EqualTo(HttpStatusCode.UnprocessableEntity).And.Not.EqualTo(HttpStatusCode.NoContent));
        Assert.That((int)over.StatusCode, Is.GreaterThanOrEqualTo(400));
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host)), Is.EqualTo(fileBefore));

        var within = await ChangeAsync(host, oldPassword, UserFakers.RandomPassword());

        Assert.That(within.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host)), Is.Not.EqualTo(fileBefore));
    }

    /// <summary>
    /// `null` explícito num campo do corpo não chega ao validator: o MVC o recusa antes, com 400 do `[ApiController]`, como nas outras rotas
    /// (campo omitido vale vazio e segue o fluxo normal). O que importa aqui é que não vire 500 nem troque nada.
    /// </summary>
    [Test]
    public async Task Change_WithNullFields_Returns400_AndChangesNothing()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);
        var fileBefore = await File.ReadAllBytesAsync(VaultPath(host));

        foreach (var json in new[] { """{"currentPassword":null,"newPassword":"uma-senha-nova-valida"}""", """{"currentPassword":"qualquer","newPassword":null}""" })
            Assert.That((await ChangeRawAsync(host, json)).StatusCode, Is.EqualTo(HttpStatusCode.BadRequest), json);

        Assert.That(await File.ReadAllBytesAsync(VaultPath(host)), Is.EqualTo(fileBefore));
        await AssertSignsInOnlyWithAsync(host, oldPassword);
    }

    /// <summary>
    /// RN-COFRE-013: o cofre continua aberto com o mesmo conteúdo. As pastas e as conexões gravadas continuam legíveis, a senha de uma conexão continua
    /// revelável (agora com a senha nova, e só com ela), e tudo isso vale também depois de sair e entrar com a senha nova.
    /// </summary>
    [Test]
    public async Task Change_KeepsTheContentReadable_AndTheConnectionPasswordRevealableWithTheNewPassword()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        var newPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);
        (await host.Client.PostAsJsonAsync("/api/user/folders", new { name = "Produção", parentID = (Guid?)null })).EnsureSuccessStatusCode();
        var connectionID = await CreateConnectionAsync(host);
        (await host.Client.PostAsJsonAsync(ConnectionsPath, ConnectionBody("Outra", "outra-senha-do-banco-3K"))).EnsureSuccessStatusCode();
        var foldersBefore = await (await host.Client.GetAsync("/api/user/folders")).Content.ReadAsStringAsync();
        var connectionsBefore = await (await host.Client.GetAsync(ConnectionsPath)).Content.ReadAsStringAsync();
        Assert.That((await ChangeAsync(host, oldPassword, newPassword)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        // Na própria sessão, sem sair: o mesmo conteúdo, e a senha da conexão sai com a senha nova.
        Assert.That(await (await host.Client.GetAsync("/api/user/folders")).Content.ReadAsStringAsync(), Is.EqualTo(foldersBefore));
        Assert.That(await (await host.Client.GetAsync(ConnectionsPath)).Content.ReadAsStringAsync(), Is.EqualTo(connectionsBefore));
        Assert.That(connectionsBefore, Does.Not.Contain(DatabasePassword));
        var revealed = await RevealAsync(host, connectionID, newPassword);
        Assert.That(revealed.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await ReadJsonAsync(revealed)).GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
        // A antiga deixa de revelar (e não devolve nada).
        var withTheOld = await RevealAsync(host, connectionID, oldPassword);
        var withTheOldBody = await AssertProblemAsync(withTheOld, HttpStatusCode.UnprocessableEntity, "INVALID_PASSWORD");
        Assert.That(withTheOldBody.ToString(), Does.Not.Contain(DatabasePassword));

        // E depois de sair e entrar com a senha nova.
        await SignOutAsync(host);
        Assert.That((await SignInAsync(host, newPassword)).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(await (await host.Client.GetAsync("/api/user/folders")).Content.ReadAsStringAsync(), Is.EqualTo(foldersBefore));
        Assert.That(await (await host.Client.GetAsync(ConnectionsPath)).Content.ReadAsStringAsync(), Is.EqualTo(connectionsBefore));
        Assert.That((await ReadJsonAsync(await RevealAsync(host, connectionID, newPassword))).GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
    }

    /// <summary>
    /// RN-COFRE-013 e 004: o arquivo ganha sal novo e continua no formato de sempre (versão 1, Argon2id, os parâmetros atuais), com o `wrappedKey` e o
    /// `payload` novos (a chave do cofre gira, RN-COFRE-003; que a chave antiga não decifra o conteúdo novo é a prova do teste de unidade do serviço do
    /// cofre, que enxerga a cifra). Que um cofre criado com parâmetros mais fracos passe a ter os atuais também não se prova em HTTP, onde a API só
    /// cria cofres com os parâmetros dela. A gravação é a de sempre, seguida de uma segunda: o `.bak` fica igual ao principal novo, e nenhum temporário sobra.
    /// </summary>
    [Test]
    public async Task Change_WritesANewSalt_AndKeepsTheFileFormat()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);
        var before = ReadVaultFile(host);

        Assert.That((await ChangeAsync(host, oldPassword, UserFakers.RandomPassword())).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        var after = ReadVaultFile(host);
        Assert.That(after["version"]!.GetValue<int>(), Is.EqualTo(4));
        Assert.That(after["kdf"]!["algorithm"]!.GetValue<string>(), Is.EqualTo("argon2id"));
        Assert.That((after["kdf"]!["memoryKiB"]!.GetValue<int>(), after["kdf"]!["iterations"]!.GetValue<int>(), after["kdf"]!["parallelism"]!.GetValue<int>()), Is.EqualTo((8192, 1, 1)));
        Assert.That(Convert.FromBase64String(after["kdf"]!["salt"]!.GetValue<string>()), Has.Length.EqualTo(16));
        Assert.That(after["kdf"]!["salt"]!.GetValue<string>(), Is.Not.EqualTo(before["kdf"]!["salt"]!.GetValue<string>()));
        Assert.That(after["wrappedKey"]!["ciphertext"]!.GetValue<string>(), Is.Not.EqualTo(before["wrappedKey"]!["ciphertext"]!.GetValue<string>()));
        Assert.That(after["payload"]!["nonce"]!.GetValue<string>(), Is.Not.EqualTo(before["payload"]!["nonce"]!.GetValue<string>()));
        Assert.That(Directory.GetFiles(Path.GetDirectoryName(VaultPath(host))!).Select(Path.GetFileName), Is.EquivalentTo(new[] { $"{UserName}.vault.json", $"{UserName}.vault.json.bak" }));
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host) + ".bak"), Is.EqualTo(await File.ReadAllBytesAsync(VaultPath(host))));
    }

    /// <summary>
    /// RN-COFRE-005 e 013: o app promove o `.bak` quando o arquivo principal some. Como a troca regrava o mesmo arquivo para o `.bak` ficar com a senha nova,
    /// nessa situação só a senha NOVA abre o cofre (a antiga voltaria a abrir se o `.bak` fosse o principal de antes), e o conteúdo está inteiro. É o que
    /// a pergunta ao dono sobre o `.bak` decidiu (opção B).
    /// </summary>
    [Test]
    public async Task Change_WhenTheMainFileIsLost_TheBakOpensOnlyWithTheNewPassword_AndKeepsTheContent()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        var newPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);
        var connectionID = await CreateConnectionAsync(host);
        var connectionsBefore = await (await host.Client.GetAsync(ConnectionsPath)).Content.ReadAsStringAsync();
        Assert.That((await ChangeAsync(host, oldPassword, newPassword)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        await SignOutAsync(host);
        File.Delete(VaultPath(host));

        await AssertProblemAsync(await SignInAsync(host, oldPassword), HttpStatusCode.Unauthorized, "INVALID_CREDENTIALS");
        Assert.That((await SignInAsync(host, newPassword)).StatusCode, Is.EqualTo(HttpStatusCode.OK));

        Assert.That(File.Exists(VaultPath(host)), Is.True);
        Assert.That(await (await host.Client.GetAsync(ConnectionsPath)).Content.ReadAsStringAsync(), Is.EqualTo(connectionsBefore));
        Assert.That((await ReadJsonAsync(await RevealAsync(host, connectionID, newPassword))).GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
    }

    /// <summary>
    /// §7 da especificação e RN-COFRE-013: uma falha de disco no meio responde 503 `VAULT_UNAVAILABLE` e deixa o cofre abrindo com a senha ANTIGA,
    /// no arquivo e na memória. A falha é uma pasta no lugar do temporário da gravação: o `FileStream` a recusa como recusaria um disco cheio, em
    /// qualquer sistema. Depois de tirá-la, a mesma troca passa.
    /// </summary>
    [Test]
    public async Task Change_WhenTheDiskFails_Returns503VaultUnavailable_AndTheOldPasswordKeepsOpening()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        var newPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);
        var connectionID = await CreateConnectionAsync(host);
        var fileBefore = await File.ReadAllBytesAsync(VaultPath(host));
        Directory.CreateDirectory(VaultPath(host) + ".tmp");

        var response = await ChangeAsync(host, oldPassword, newPassword);

        var body = await AssertProblemAsync(response, HttpStatusCode.ServiceUnavailable, "VAULT_UNAVAILABLE");
        Assert.That(body.ToString(), Does.Not.Contain(oldPassword).And.Not.Contain(newPassword));
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host)), Is.EqualTo(fileBefore));
        // Na memória: o cofre segue aberto, e é a senha antiga que revela (a nova não).
        await AssertSessionAsync(host, unlocked: true);
        Assert.That((await ReadJsonAsync(await RevealAsync(host, connectionID, oldPassword))).GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
        await AssertProblemAsync(await RevealAsync(host, connectionID, newPassword), HttpStatusCode.UnprocessableEntity, "INVALID_PASSWORD");
        // No disco: sair e entrar de novo só aceita a antiga.
        await AssertSignsInOnlyWithAsync(host, oldPassword, newPassword);
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host)), Is.EqualTo(fileBefore));

        Directory.Delete(VaultPath(host) + ".tmp");
        Assert.That((await ChangeAsync(host, oldPassword, newPassword)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        await AssertSignsInOnlyWithAsync(host, newPassword, oldPassword);
    }

    /// <summary>
    /// Uma troca ao mesmo tempo de gravações comuns (criar conexões): nenhuma perde a outra, e o arquivo nunca fica com o embrulho de uma e o
    /// conteúdo antigo da outra. Depois de tudo, sai-se e entra-se só com a senha nova, e as vinte conexões estão lá.
    /// </summary>
    [Test]
    public async Task Change_ConcurrentWithConnectionCreations_LosesNothing()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        var newPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);
        var names = Enumerable.Range(1, 20).Select(number => $"Conexão {number:00}").ToArray();

        var creations = names.Select(name => host.Client.PostAsJsonAsync(ConnectionsPath, ConnectionBody(name))).ToList();
        var change = ChangeAsync(host, oldPassword, newPassword);
        var responses = await Task.WhenAll([.. creations, change]);

        Assert.That(responses.Take(20).Select(response => response.StatusCode), Is.All.EqualTo(HttpStatusCode.Created));
        Assert.That(responses[20].StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        await SignOutAsync(host);
        await AssertProblemAsync(await SignInAsync(host, oldPassword), HttpStatusCode.Unauthorized, "INVALID_CREDENTIALS");
        Assert.That((await SignInAsync(host, newPassword)).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var listed = (await ReadJsonAsync(await host.Client.GetAsync(ConnectionsPath))).EnumerateArray().Select(connection => connection.GetProperty("name").GetString()).ToList();
        Assert.That(listed, Is.EquivalentTo(names));
    }

    /// <summary>
    /// Duas trocas ao mesmo tempo, com a mesma senha atual: uma passa (204) e a outra encontra a senha atual já trocada (422). O arquivo fica inteiro,
    /// com o embrulho de quem venceu: entra-se só com a senha dele.
    /// </summary>
    [Test]
    public async Task Change_TwoAtOnce_OneWins_AndTheFileIsWhole()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        var firstPassword = UserFakers.RandomPassword();
        var secondPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);
        await CreateConnectionAsync(host);

        var responses = await Task.WhenAll(ChangeAsync(host, oldPassword, firstPassword), ChangeAsync(host, oldPassword, secondPassword));

        var winnerIsTheFirst = responses[0].StatusCode == HttpStatusCode.NoContent;
        var loser = responses[winnerIsTheFirst ? 1 : 0];
        var body = await AssertProblemAsync(loser, HttpStatusCode.UnprocessableEntity, "INVALID_PASSWORD");
        AssertOnlyField(body, "CurrentPassword", "INVALID_PASSWORD");
        Assert.That(responses.Count(response => response.StatusCode == HttpStatusCode.NoContent), Is.EqualTo(1));
        var (winner, loserPassword) = winnerIsTheFirst ? (firstPassword, secondPassword) : (secondPassword, firstPassword);
        await AssertSignsInOnlyWithAsync(host, winner, loserPassword, oldPassword);
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync(ConnectionsPath))).GetArrayLength(), Is.EqualTo(1));
    }

    /// <summary>A troca é do usuário do cofre aberto, e só dele: o arquivo de outro usuário não é tocado e a senha dele segue a mesma.</summary>
    [Test]
    public async Task Change_TouchesOnlyTheOpenUsersVault()
    {
        await using var host = await ApiHost.StartAsync();
        var marinaPassword = UserFakers.RandomPassword();
        var joaoPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("joao.silva", joaoPassword);
        await host.CreateUserAsync(UserName, marinaPassword);
        var joaoFile = await File.ReadAllBytesAsync(VaultPath(host, "joao.silva"));

        var response = await ChangeAsync(host, marinaPassword, UserFakers.RandomPassword());

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(await File.ReadAllBytesAsync(VaultPath(host, "joao.silva")), Is.EqualTo(joaoFile));
        Assert.That(File.Exists(VaultPath(host, "joao.silva") + ".bak"), Is.False);
        await SignOutAsync(host);
        Assert.That((await SignInAsync(host, joaoPassword, "joao.silva")).StatusCode, Is.EqualTo(HttpStatusCode.OK));
    }

    /// <summary>Só o PUT existe nesta rota (RN-COFRE-013): GET, POST e PATCH respondem 405, e nenhum deles chega a conferir senha.</summary>
    [Test]
    public async Task Change_OtherVerbsOnTheSameRoute_AreNotAllowed()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());

        var post = await host.Client.PostAsJsonAsync(PasswordPath, new { currentPassword = "uma-senha-qualquer", newPassword = "outra-senha-qualquer" });
        var get = await host.Client.GetAsync(PasswordPath);
        var patch = await host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, PasswordPath) { Content = JsonContent.Create(new { currentPassword = "uma-senha-qualquer", newPassword = "outra-senha-qualquer" }) });

        Assert.That(new[] { post.StatusCode, get.StatusCode, patch.StatusCode }, Is.All.EqualTo(HttpStatusCode.MethodNotAllowed));
    }
}
