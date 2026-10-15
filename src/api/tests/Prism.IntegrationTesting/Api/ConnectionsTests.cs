using CSharpFunctionalExtensions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Prism.Application.Connections.Queries;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// As conexões do usuário (`api/user/connections`) e a revelação da senha, pela API de verdade: RN-CONN-001 a
/// 004, 010 e 011, e os critérios de aceite 2, 3 e 5. A barreira do cofre e o token já são provados em
/// `FoldersTests`; aqui só se confere que as rotas novas ficam atrás dela. Cada teste sobe uma API própria,
/// com a pasta de dados própria.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class ConnectionsTests
{
    private const string ConnectionsPath = "/api/user/connections";
    private const string FoldersPath = "/api/user/folders";

    /// <summary>Marca única de cada senha de banco: a prova de que ela não vazou é procurá-la no texto cru.</summary>
    private const string DatabasePassword = "marca-da-senha-do-banco-7Q";

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(status));
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));
    }

    /// <summary>O corpo que a tela manda ao criar ou alterar (RN-CONN-010). A senha nula é o "manter a gravada" do `PATCH`.</summary>
    private static Dictionary<string, object?> Body(Guid? folderID = null, string name = "Produção", int engine = 1, string host = "pg.local", int port = 5432, string database = "producao", string userName = "operador", string? password = DatabasePassword, string? environmentName = null, string? environmentColor = null)
        => new() { ["folderID"] = folderID, ["name"] = name, ["engine"] = engine, ["host"] = host, ["port"] = port, ["database"] = database, ["userName"] = userName, ["password"] = password, ["environmentName"] = environmentName, ["environmentColor"] = environmentColor };

    private static Task<HttpResponseMessage> PostConnectionAsync(ApiHost host, Dictionary<string, object?> body)
        => host.Client.PostAsJsonAsync(ConnectionsPath, body);

    /// <summary>Cria a conexão pela rota e confere o 201: um teste que arruma estado não segue adiante com uma criação recusada.</summary>
    private static async Task<JsonElement> CreateConnectionAsync(ApiHost host, Dictionary<string, object?>? body = null)
    {
        var response = await PostConnectionAsync(host, body ?? Body());
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));

        return await ReadJsonAsync(response);
    }

    private static Task<HttpResponseMessage> UpdateConnectionAsync(ApiHost host, Guid id, Dictionary<string, object?> body)
        => host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, ConnectionsPath) { Content = JsonContent.Create(new Dictionary<string, object?>(body) { ["id"] = id }) });

    private static Task<HttpResponseMessage> RevealAsync(ApiHost host, Guid id, string password)
        => host.Client.PostAsJsonAsync($"{ConnectionsPath}/{id}/password/reveal", new { password });

    /// <summary>"Duplicar conexão" (RN-CONN-016): a tela não manda corpo, só o ID na rota.</summary>
    private static Task<HttpResponseMessage> DuplicateAsync(ApiHost host, Guid id)
        => host.Client.PostAsync($"{ConnectionsPath}/{id}/duplicate", null);

    private static async Task<List<JsonElement>> ListConnectionsAsync(ApiHost host)
    {
        var response = await host.Client.GetAsync(ConnectionsPath);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));

        return (await ReadJsonAsync(response)).EnumerateArray().ToList();
    }

    private static async Task<Guid> CreateFolderAsync(ApiHost host, string name)
    {
        var response = await host.Client.PostAsJsonAsync(FoldersPath, new { name, parentID = (Guid?)null });
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));

        return IdOf(await ReadJsonAsync(response));
    }

    private static Guid IdOf(JsonElement element)
        => element.GetProperty("id").GetGuid();

    private static async Task<bool> IsUnlockedAsync(ApiHost host)
        => (await ReadJsonAsync(await host.Client.GetAsync("/api/public/sessions"))).GetProperty("unlocked").GetBoolean();

    private static async Task SignInAsync(ApiHost host, string userName, string password)
        => (await host.Client.PostAsJsonAsync("/api/public/sessions", new { userName, password })).EnsureSuccessStatusCode();

    [Test]
    public async Task Create_Valid_Returns201_AndBodyHasNoPassword()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var folderID = await CreateFolderAsync(host, "Produção");

        // Espaços sobrando de propósito: nome, host, banco e usuário são gravados aparados (RN-CONN-010).
        var response = await PostConnectionAsync(host, Body(folderID: folderID, name: "  Linha   1 ", engine: 3, host: " ifx.local ", port: 9089, database: " producao ", userName: " operador ", environmentName: "Produção", environmentColor: "#FF8800"));

        var raw = await response.Content.ReadAsStringAsync();
        var body = JsonDocument.Parse(raw).RootElement;
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That(raw, Does.Not.Contain(DatabasePassword));
        Assert.That(response.Headers.Location?.ToString(), Is.EqualTo($"{ConnectionsPath}/{IdOf(body)}"));
        Assert.That(IdOf(body), Is.Not.EqualTo(Guid.Empty));
        Assert.That(body.GetProperty("folderID").GetGuid(), Is.EqualTo(folderID));
        Assert.That(body.GetProperty("name").GetString(), Is.EqualTo("Linha 1"));
        // O banco vai como número (1, 2 ou 3): é o que a tela valida.
        Assert.That(body.GetProperty("engine").GetInt32(), Is.EqualTo(3));
        Assert.That(body.GetProperty("host").GetString(), Is.EqualTo("ifx.local"));
        Assert.That(body.GetProperty("port").GetInt32(), Is.EqualTo(9089));
        Assert.That(body.GetProperty("database").GetString(), Is.EqualTo("producao"));
        Assert.That(body.GetProperty("userName").GetString(), Is.EqualTo("operador"));
        Assert.That(body.GetProperty("hasPassword").GetBoolean(), Is.True);
        Assert.That(body.GetProperty("environmentName").GetString(), Is.EqualTo("Produção"));
        Assert.That(body.GetProperty("environmentColor").GetString(), Is.EqualTo("#FF8800"));
        Assert.That(body.GetProperty("createdAt").GetDateTime(), Is.EqualTo(body.GetProperty("updatedAt").GetDateTime()));
        Assert.That(await ListConnectionsAsync(host), Has.Count.EqualTo(1));
    }

    [Test]
    public async Task Create_InTheRoot_WithoutEnvironment_Returns201()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var body = await CreateConnectionAsync(host);

        Assert.That(body.GetProperty("folderID").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(body.GetProperty("environmentName").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(body.GetProperty("environmentColor").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    [Test]
    public async Task Create_UnknownFolder_Returns404FolderNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var response = await PostConnectionAsync(host, Body(folderID: Guid.CreateVersion7()));

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "FOLDER_NOT_FOUND");
        Assert.That(await ListConnectionsAsync(host), Is.Empty);
    }

    /// <summary>RN-CONN-011: a comparação ignora maiúsculas, e vale também para letra acentuada.</summary>
    [Test]
    public async Task Create_SameNameSameFolder_Returns409ConnectionAlreadyExists()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var folderID = await CreateFolderAsync(host, "Produção");
        await CreateConnectionAsync(host, Body(folderID: folderID, name: "Produção"));

        var response = await PostConnectionAsync(host, Body(folderID: folderID, name: "  PRODUÇÃO "));

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "CONNECTION_ALREADY_EXISTS");
        Assert.That(await ListConnectionsAsync(host), Has.Count.EqualTo(1));
    }

    [Test]
    public async Task Create_SameNameInTheRootTwice_Returns409ConnectionAlreadyExists()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        await CreateConnectionAsync(host, Body(name: "Produção"));

        var response = await PostConnectionAsync(host, Body(name: "produção"));

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "CONNECTION_ALREADY_EXISTS");
    }

    [Test]
    public async Task Create_SameNameOtherFolder_Returns201()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var first = await CreateFolderAsync(host, "Produção");
        var second = await CreateFolderAsync(host, "Manutenção");
        await CreateConnectionAsync(host, Body(folderID: first, name: "Linha 1"));

        var inOtherFolder = await PostConnectionAsync(host, Body(folderID: second, name: "Linha 1"));
        // E a raiz também é um "lugar": o mesmo nome na raiz não colide com os das pastas.
        var inTheRoot = await PostConnectionAsync(host, Body(folderID: null, name: "Linha 1"));

        Assert.That(inOtherFolder.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That(inTheRoot.StatusCode, Is.EqualTo(HttpStatusCode.Created));
    }

    /// <summary>"Fábrica" digitado (á composto) e "Fábrica" colado de outro programa (a + acento combinante) são o mesmo nome.</summary>
    [Test]
    public async Task Create_SameNameInDecomposedForm_Returns409_AndStoresTheNameComposed()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var created = await CreateConnectionAsync(host, Body(name: "Fábrica"));

        var response = await PostConnectionAsync(host, Body(name: "Fábrica"));

        Assert.That(created.GetProperty("name").GetString(), Is.EqualTo("Fábrica"));
        await AssertProblemAsync(response, HttpStatusCode.Conflict, "CONNECTION_ALREADY_EXISTS");
    }

    /// <summary>
    /// Cada campo inválido sozinho: 422 `CONNECTION_INVALID`, com a propriedade em `errors` (a tela lê `errors.name`,
    /// pondo a primeira letra do nome da propriedade em minúscula). Os limites de dentro passam (RN-CONN-010).
    /// </summary>
    [Test]
    public async Task Create_InvalidField_Returns422ConnectionInvalid_WithTheProperty()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var cases = new (string Property, Dictionary<string, object?> Body)[]
        {
            ("Name", Body(name: "   ")),
            ("Name", Body(name: new string('a', 81))),
            ("Host", Body(host: "")),
            ("Port", Body(port: 0)),
            ("Port", Body(port: 65536)),
            ("Database", Body(database: "")),
            ("UserName", Body(userName: "")),
            ("Password", Body(password: "")),
            ("Engine", Body(engine: 0)),
            ("Engine", Body(engine: 4)),
            ("EnvironmentName", Body(environmentName: new string('a', 31))),
            ("EnvironmentColor", Body(environmentColor: "red")),
            ("EnvironmentColor", Body(environmentColor: "#12345")),
            ("EnvironmentColor", Body(environmentColor: "#GGGGGG"))
        };

        foreach (var (property, body) in cases)
        {
            var response = await PostConnectionAsync(host, body);

            var problem = await ReadJsonAsync(response);
            Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity), property);
            Assert.That(problem.GetProperty("type").GetString(), Is.EqualTo("CONNECTION_INVALID"), property);
            Assert.That(problem.GetProperty("errors").GetProperty(property).GetArrayLength(), Is.GreaterThan(0), property);
            Assert.That(await response.Content.ReadAsStringAsync(), Does.Not.Contain(DatabasePassword));
        }

        // Os limites de dentro: nome com 80, porta 1 e 65535, ambiente com 30.
        Assert.That((await PostConnectionAsync(host, Body(name: new string('a', 80), port: 1, environmentName: new string('a', 30)))).StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That((await PostConnectionAsync(host, Body(name: "Outra", port: 65535))).StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That(await ListConnectionsAsync(host), Has.Count.EqualTo(2));
    }

    /// <summary>RN-CONN-001: nem a lista nem o detalhe trazem a senha, só `hasPassword`; a lista vem inteira e ordenada pelo nome.</summary>
    [Test]
    public async Task GetConnections_And_GetConnection_NeverContainThePassword()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var folderID = await CreateFolderAsync(host, "Produção");
        var beta = await CreateConnectionAsync(host, Body(folderID: folderID, name: "beta"));
        var alfa = await CreateConnectionAsync(host, Body(name: "Alfa", engine: 2, port: 50000, environmentName: "Produção", environmentColor: "#ff0000"));

        var listResponse = await host.Client.GetAsync(ConnectionsPath);
        var detailResponse = await host.Client.GetAsync($"{ConnectionsPath}/{IdOf(beta)}");

        var listRaw = await listResponse.Content.ReadAsStringAsync();
        var detailRaw = await detailResponse.Content.ReadAsStringAsync();
        var list = JsonDocument.Parse(listRaw).RootElement.EnumerateArray().ToList();
        Assert.That(listResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(detailResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(listRaw, Does.Not.Contain(DatabasePassword));
        Assert.That(detailRaw, Does.Not.Contain(DatabasePassword));
        Assert.That(list.Select(IdOf), Is.EqualTo(new[] { IdOf(alfa), IdOf(beta) }));
        Assert.That(list[0].EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "id", "folderID", "name", "engine", "host", "port", "database", "userName", "hasPassword", "environmentName", "environmentColor", "confirmCommands", "readOnly", "verificationEnabled", "verificationInterval", "verificationQuery", "protections", "createdAt", "updatedAt" }));
        Assert.That(list.All(item => item.GetProperty("hasPassword").GetBoolean()), Is.True);
        Assert.That(JsonDocument.Parse(detailRaw).RootElement.GetRawText(), Is.EqualTo(list[1].GetRawText()));
    }

    [Test]
    public async Task GetConnections_NoConnections_ReturnsEmptyList()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var response = await host.Client.GetAsync(ConnectionsPath);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(await response.Content.ReadAsStringAsync(), Is.EqualTo("[]"));
    }

    [Test]
    public async Task GetConnection_Unknown_Returns404ConnectionNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var response = await host.Client.GetAsync($"{ConnectionsPath}/{Guid.CreateVersion7()}");

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
    }

    /// <summary>O que foi salvo está no arquivo cifrado, e não na memória da API: fechar o cofre e entrar de novo devolve a conexão, com a senha.</summary>
    [Test]
    public async Task GetConnections_AfterLockAndSignIn_ReturnsWhatWasSaved()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var connection = await CreateConnectionAsync(host);
        (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();
        await SignInAsync(host, "marina.costa", userPassword);

        var connections = await ListConnectionsAsync(host);
        var revealed = await RevealAsync(host, IdOf(connection), userPassword);

        Assert.That(connections.Select(IdOf), Is.EqualTo(new[] { IdOf(connection) }));
        Assert.That((await ReadJsonAsync(revealed)).GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
    }

    /// <summary>RN-CONN-004.</summary>
    [Test]
    public async Task Update_WithoutPassword_KeepsTheStoredOne()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var connection = await CreateConnectionAsync(host);

        // `password: null` e o campo ausente querem dizer o mesmo.
        var absent = Body(name: "Nova de novo");
        absent.Remove("password");
        var withNull = await UpdateConnectionAsync(host, IdOf(connection), Body(name: "Nova", password: null));
        var withoutField = await UpdateConnectionAsync(host, IdOf(connection), absent);

        Assert.That(withNull.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(withoutField.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var revealed = await RevealAsync(host, IdOf(connection), userPassword);
        Assert.That((await ReadJsonAsync(revealed)).GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
        Assert.That((await ReadJsonAsync(withoutField)).GetProperty("hasPassword").GetBoolean(), Is.True);
    }

    /// <summary>
    /// RN-CONN-004: a senha gravada só é enviada ao servidor para o qual foi gravada. Mudar o host sem informar a senha é 422, com a
    /// mensagem no campo da senha, e nada é gravado: nem o host, nem os outros campos que vinham no mesmo pedido.
    /// </summary>
    [Test]
    public async Task Patch_ChangingHostWithoutPassword_Returns422_AndKeepsTheRecord()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var connection = await CreateConnectionAsync(host);

        var response = await UpdateConnectionAsync(host, IdOf(connection), Body(name: "Outra", host: "outro.local", password: null));

        await AssertServerChangeRefusedAsync(host, response, connection, userPassword);
    }

    [Test]
    public async Task Patch_ChangingPortWithoutPassword_Returns422_AndKeepsTheRecord()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var connection = await CreateConnectionAsync(host);

        var response = await UpdateConnectionAsync(host, IdOf(connection), Body(name: "Outra", port: 5433, password: null));

        await AssertServerChangeRefusedAsync(host, response, connection, userPassword);
    }

    private static async Task AssertServerChangeRefusedAsync(ApiHost host, HttpResponseMessage response, JsonElement before, string userPassword)
    {
        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity), body.ToString());
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo("CONNECTION_INVALID"));
        Assert.That(body.GetProperty("detail").GetString(), Is.EqualTo("Ao mudar o host ou a porta, informe a senha da conexão de novo."));
        Assert.That(body.GetProperty("errors").GetProperty("Password")[0].GetString(), Is.EqualTo("Ao mudar o host ou a porta, informe a senha da conexão de novo."));
        Assert.That(body.GetProperty("errorCodes").GetProperty("Password")[0].GetString(), Is.EqualTo("CONNECTION_INVALID"));
        Assert.That((await ListConnectionsAsync(host)).Single().GetRawText(), Is.EqualTo(before.GetRawText()), "A recusa gravou alguma coisa.");
        Assert.That((await ReadJsonAsync(await RevealAsync(host, IdOf(before), userPassword))).GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
    }

    /// <summary>O host é comparado de forma exata: só as maiúsculas mudando já é outro servidor (um diretório de socket Unix em `/tmp/pgsock-x` não é `/tmp/PGSOCK-X`).</summary>
    [Test]
    public async Task Patch_ChangingOnlyTheCaseOfTheHost_WithoutPassword_Returns422_AndKeepsTheRecord()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var connection = await CreateConnectionAsync(host);

        var response = await UpdateConnectionAsync(host, IdOf(connection), Body(name: "Outra", host: "PG.LOCAL", password: null));

        await AssertServerChangeRefusedAsync(host, response, connection, userPassword);
    }

    [Test]
    public async Task Patch_ChangingHostWithPassword_Returns200()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var connection = await CreateConnectionAsync(host);

        var newPassword = UserFakers.RandomPassword();

        var response = await UpdateConnectionAsync(host, IdOf(connection), Body(host: "outro.local", port: 5433, password: newPassword));

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(body.GetProperty("host").GetString(), Is.EqualTo("outro.local"));
        Assert.That(body.GetProperty("port").GetInt32(), Is.EqualTo(5433));
        Assert.That((await ReadJsonAsync(await RevealAsync(host, IdOf(connection), userPassword))).GetProperty("password").GetString(), Is.EqualTo(newPassword));
    }

    /// <summary>
    /// Só o servidor (host e porta) prende a senha: nome, pasta, banco, usuário e ambiente mudam sem ela. Os espaços das pontas do host
    /// (que a criação grava aparado) não contam como mudança. (`Update_WithoutPassword_KeepsTheStoredOne` cobre só o nome.)
    /// </summary>
    [Test]
    public async Task Patch_ChangingOnlyNameFolderDatabaseUserAndEnvironment_WithoutPassword_KeepsThePassword()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var folderID = await CreateFolderAsync(host, "Produção");
        var connection = await CreateConnectionAsync(host);

        var response = await UpdateConnectionAsync(host, IdOf(connection), Body(folderID: folderID, name: "Outra", host: "  pg.local ", database: "outro_banco", userName: "outro_usuario", password: null, environmentName: "Homologação", environmentColor: "#00AA00"));

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        Assert.That(body.GetProperty("database").GetString(), Is.EqualTo("outro_banco"));
        Assert.That(body.GetProperty("userName").GetString(), Is.EqualTo("outro_usuario"));
        Assert.That((await ReadJsonAsync(await RevealAsync(host, IdOf(connection), userPassword))).GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
    }

    /// <summary>
    /// Decisão: o servidor que a senha prende é host e porta. Mudar só o banco (`engine`), com os dois iguais, mantém a senha gravada, que
    /// continua indo ao mesmo servidor; o contrário pediria a senha a quem corrige um engano de seleção no formulário.
    /// </summary>
    [Test]
    public async Task Patch_ChangingOnlyTheEngine_WithTheSameHostAndPort_WithoutPassword_KeepsThePassword()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var connection = await CreateConnectionAsync(host);

        var response = await UpdateConnectionAsync(host, IdOf(connection), Body(engine: 2, password: null));

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        Assert.That(body.GetProperty("engine").GetInt32(), Is.EqualTo(2));
        Assert.That(body.GetProperty("host").GetString(), Is.EqualTo("pg.local"));
        Assert.That(body.GetProperty("port").GetInt32(), Is.EqualTo(5432));
        Assert.That((await ReadJsonAsync(await RevealAsync(host, IdOf(connection), userPassword))).GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
    }

    [Test]
    public async Task Update_WithPassword_ReplacesIt()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var connection = await CreateConnectionAsync(host);

        var response = await UpdateConnectionAsync(host, IdOf(connection), Body(password: "senha-nova-do-banco"));

        var raw = await response.Content.ReadAsStringAsync();
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(raw, Does.Not.Contain("senha-nova-do-banco"));
        Assert.That((await ReadJsonAsync(await RevealAsync(host, IdOf(connection), userPassword))).GetProperty("password").GetString(), Is.EqualTo("senha-nova-do-banco"));
    }

    [Test]
    public async Task Update_ChangesTheFieldsAndKeepsTheCreation()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var folderID = await CreateFolderAsync(host, "Produção");
        var connection = await CreateConnectionAsync(host);

        var response = await UpdateConnectionAsync(host, IdOf(connection), Body(folderID: folderID, name: "  Nova   ", engine: 2, host: "db2.local", port: 50000, database: "novo", userName: "outro", password: UserFakers.RandomPassword(), environmentName: "Homologação", environmentColor: "#00AA00"));

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(IdOf(body), Is.EqualTo(IdOf(connection)));
        Assert.That(body.GetProperty("folderID").GetGuid(), Is.EqualTo(folderID));
        Assert.That(body.GetProperty("name").GetString(), Is.EqualTo("Nova"));
        Assert.That(body.GetProperty("engine").GetInt32(), Is.EqualTo(2));
        Assert.That(body.GetProperty("host").GetString(), Is.EqualTo("db2.local"));
        Assert.That(body.GetProperty("port").GetInt32(), Is.EqualTo(50000));
        Assert.That(body.GetProperty("environmentName").GetString(), Is.EqualTo("Homologação"));
        Assert.That(body.GetProperty("createdAt").GetDateTime(), Is.EqualTo(connection.GetProperty("createdAt").GetDateTime()));
        Assert.That(body.GetProperty("updatedAt").GetDateTime(), Is.GreaterThanOrEqualTo(connection.GetProperty("updatedAt").GetDateTime()));
        Assert.That((await ListConnectionsAsync(host)).Single().GetRawText(), Is.EqualTo(body.GetRawText()));
    }

    /// <summary>`folderID` nulo move a conexão para a raiz, e quem só edita manda a pasta que ela já tem.</summary>
    [Test]
    public async Task Update_MoveToRoot_Returns200()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var folderID = await CreateFolderAsync(host, "Produção");
        var connection = await CreateConnectionAsync(host, Body(folderID: folderID));

        var response = await UpdateConnectionAsync(host, IdOf(connection), Body(folderID: null, password: null));

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await ReadJsonAsync(response)).GetProperty("folderID").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    /// <summary>Salvar sem mudar o nome (ou só a caixa) não é duplicidade: a conexão não colide com ela mesma.</summary>
    [Test]
    public async Task Update_SameNameItAlreadyHas_Returns200()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var connection = await CreateConnectionAsync(host, Body(name: "Produção"));

        var unchanged = await UpdateConnectionAsync(host, IdOf(connection), Body(name: "Produção", password: null));
        var otherCase = await UpdateConnectionAsync(host, IdOf(connection), Body(name: "PRODUÇÃO", password: null));

        Assert.That(unchanged.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(otherCase.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await ReadJsonAsync(otherCase)).GetProperty("name").GetString(), Is.EqualTo("PRODUÇÃO"));
    }

    [Test]
    public async Task Update_RenameToSiblingName_Returns409ConnectionAlreadyExists()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        await CreateConnectionAsync(host, Body(name: "Produção"));
        var connection = await CreateConnectionAsync(host, Body(name: "Manutenção"));

        var response = await UpdateConnectionAsync(host, IdOf(connection), Body(name: "produção", password: null));

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "CONNECTION_ALREADY_EXISTS");
        Assert.That((await ListConnectionsAsync(host)).Select(item => item.GetProperty("name").GetString()), Is.EquivalentTo(new[] { "Produção", "Manutenção" }));
    }

    [Test]
    public async Task Update_Unknown_Returns404ConnectionNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var response = await UpdateConnectionAsync(host, Guid.CreateVersion7(), Body(password: null));

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
    }

    [Test]
    public async Task Update_UnknownFolder_Returns404FolderNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var connection = await CreateConnectionAsync(host);

        var response = await UpdateConnectionAsync(host, IdOf(connection), Body(folderID: Guid.CreateVersion7(), password: null));

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "FOLDER_NOT_FOUND");
    }

    [Test]
    public async Task Update_InvalidField_Returns422ConnectionInvalid_WithTheProperty()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var connection = await CreateConnectionAsync(host);

        var cases = new (string Property, Dictionary<string, object?> Body)[]
        {
            ("Name", Body(name: new string('a', 81), password: null)),
            ("Port", Body(port: 65536, password: null)),
            ("Engine", Body(engine: 4, password: null)),
            ("Password", Body(password: "")),
            ("EnvironmentColor", Body(environmentColor: "#12345", password: null))
        };

        foreach (var (property, body) in cases)
        {
            var response = await UpdateConnectionAsync(host, IdOf(connection), body);

            var problem = await ReadJsonAsync(response);
            Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity), property);
            Assert.That(problem.GetProperty("type").GetString(), Is.EqualTo("CONNECTION_INVALID"), property);
            Assert.That(problem.GetProperty("errors").GetProperty(property).GetArrayLength(), Is.GreaterThan(0), property);
        }
    }

    [Test]
    public async Task Delete_Returns204()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var kept = await CreateConnectionAsync(host, Body(name: "Mantida"));
        var connection = await CreateConnectionAsync(host, Body(name: "Excluída"));

        var response = await host.Client.DeleteAsync($"{ConnectionsPath}/{IdOf(connection)}");

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(await response.Content.ReadAsStringAsync(), Is.Empty);
        Assert.That((await ListConnectionsAsync(host)).Select(IdOf), Is.EqualTo(new[] { IdOf(kept) }));
    }

    [Test]
    public async Task Delete_Unknown_Returns404ConnectionNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var response = await host.Client.DeleteAsync($"{ConnectionsPath}/{Guid.CreateVersion7()}");

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
    }

    /// <summary>
    /// A conexão já foi excluída: a segunda chamada é 404, e não 204. E a recusa não regrava o cofre: o arquivo
    /// principal e o `.bak` continuam com os mesmos bytes, e a versão anterior não se perde.
    /// </summary>
    [Test]
    public async Task Delete_Twice_SecondReturns404_AndDoesNotRewriteTheVaultFiles()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        await CreateConnectionAsync(host, Body(name: "Mantida"));
        var connection = await CreateConnectionAsync(host, Body(name: "Excluída"));
        Assert.That((await host.Client.DeleteAsync($"{ConnectionsPath}/{IdOf(connection)}")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        var mainPath = Path.Combine(host.DataDirectory, "vaults", "marina.costa.vault.json");
        var mainBytes = await File.ReadAllBytesAsync(mainPath);
        var backupBytes = await File.ReadAllBytesAsync(mainPath + ".bak");

        var response = await host.Client.DeleteAsync($"{ConnectionsPath}/{IdOf(connection)}");

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
        Assert.That(await File.ReadAllBytesAsync(mainPath), Is.EqualTo(mainBytes));
        Assert.That(await File.ReadAllBytesAsync(mainPath + ".bak"), Is.EqualTo(backupBytes));
    }

    /// <summary>RN-PASTA-004: a pasta com conexão não é vazia. Excluída a conexão, a pasta sai.</summary>
    [Test]
    public async Task DeleteFolder_WithConnection_Returns409FolderNotEmpty()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var folderID = await CreateFolderAsync(host, "Produção");
        var connection = await CreateConnectionAsync(host, Body(folderID: folderID));

        var refused = await host.Client.DeleteAsync($"{FoldersPath}/{folderID}");

        await AssertProblemAsync(refused, HttpStatusCode.Conflict, "FOLDER_NOT_EMPTY");
        Assert.That((await host.Client.DeleteAsync($"{ConnectionsPath}/{IdOf(connection)}")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That((await host.Client.DeleteAsync($"{FoldersPath}/{folderID}")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
    }

    /// <summary>RN-CONN-002.</summary>
    [Test]
    public async Task Reveal_RightPassword_Returns200WithThePassword()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var connection = await CreateConnectionAsync(host);

        var response = await RevealAsync(host, IdOf(connection), userPassword);

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(body.GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
        Assert.That(body.EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "password" }));
    }

    [Test]
    public async Task Reveal_WrongPassword_Returns422InvalidPassword_AndNoPasswordInBody()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var connection = await CreateConnectionAsync(host);

        var response = await RevealAsync(host, IdOf(connection), userPassword + "x");

        var raw = await response.Content.ReadAsStringAsync();
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(JsonDocument.Parse(raw).RootElement.GetProperty("type").GetString(), Is.EqualTo("INVALID_PASSWORD"));
        Assert.That(raw, Does.Not.Contain(DatabasePassword));
        Assert.That(await IsUnlockedAsync(host), Is.True);
    }

    /// <summary>RN-CONN-003: o quinto erro seguido fecha o cofre e responde 401 no lugar do 422. Entrar de novo traz a conexão de volta.</summary>
    [Test]
    public async Task Reveal_FifthWrongInARow_Returns401VaultLocked_AndVaultIsClosed()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var connection = await CreateConnectionAsync(host);

        for (var attempt = 1; attempt <= 4; attempt++)
            await AssertProblemAsync(await RevealAsync(host, IdOf(connection), userPassword + "x"), HttpStatusCode.UnprocessableEntity, "INVALID_PASSWORD");

        var fifth = await RevealAsync(host, IdOf(connection), userPassword + "x");

        await AssertProblemAsync(fifth, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        Assert.That(await fifth.Content.ReadAsStringAsync(), Does.Not.Contain(DatabasePassword));
        Assert.That(await IsUnlockedAsync(host), Is.False);
        await AssertProblemAsync(await host.Client.GetAsync(ConnectionsPath), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        // Mesmo a senha certa, agora, não revela nada: o cofre está fechado.
        await AssertProblemAsync(await RevealAsync(host, IdOf(connection), userPassword), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await SignInAsync(host, "marina.costa", userPassword);
        Assert.That((await ListConnectionsAsync(host)).Select(IdOf), Is.EqualTo(new[] { IdOf(connection) }));
        Assert.That((await ReadJsonAsync(await RevealAsync(host, IdOf(connection), userPassword))).GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
    }

    /// <summary>RN-CONN-003: acertar zera a contagem. Quatro erros, um acerto e mais quatro erros não fecham o cofre.</summary>
    [Test]
    public async Task Reveal_RightAfterFourWrong_ResetsTheCount()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var connection = await CreateConnectionAsync(host);

        for (var attempt = 1; attempt <= 4; attempt++)
            Assert.That((await RevealAsync(host, IdOf(connection), userPassword + "x")).StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));

        Assert.That((await RevealAsync(host, IdOf(connection), userPassword)).StatusCode, Is.EqualTo(HttpStatusCode.OK));

        for (var attempt = 1; attempt <= 4; attempt++)
            Assert.That((await RevealAsync(host, IdOf(connection), userPassword + "x")).StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));

        Assert.That(await IsUnlockedAsync(host), Is.True);
    }

    /// <summary>A conexão é carregada antes de a senha ser conferida: um ID que não existe responde 404 e não gasta uma das cinco tentativas.</summary>
    [Test]
    public async Task Reveal_Unknown_Returns404ConnectionNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);

        for (var attempt = 1; attempt <= 6; attempt++)
            await AssertProblemAsync(await RevealAsync(host, Guid.CreateVersion7(), userPassword + "x"), HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");

        Assert.That(await IsUnlockedAsync(host), Is.True);
    }

    /// <summary>O ID da rota é o que vale: um `id` no corpo da revelação é ignorado.</summary>
    [Test]
    public async Task Reveal_IgnoresAnIDInTheBody()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var connection = await CreateConnectionAsync(host, Body(name: "Alvo"));
        var other = await CreateConnectionAsync(host, Body(name: "Outra", password: "senha-da-outra"));

        var response = await host.Client.PostAsJsonAsync($"{ConnectionsPath}/{IdOf(connection)}/password/reveal", new { id = IdOf(other), password = userPassword });

        Assert.That((await ReadJsonAsync(response)).GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
    }

    /// <summary>Critério de aceite 3: cada usuário tem o cofre dele, e o B não vê, lê, altera, revela nem apaga a conexão do A.</summary>
    [Test]
    public async Task TwoUsers_DoNotSeeEachOthersConnections()
    {
        await using var host = await ApiHost.StartAsync();
        var passwordA = UserFakers.RandomPassword();
        var passwordB = UserFakers.RandomPassword();
        await host.CreateUserAsync("usuario.a", passwordA);
        var connectionOfA = await CreateConnectionAsync(host, Body(name: "Produção"));
        await host.CreateUserAsync("usuario.b", passwordB);

        Assert.That(await ListConnectionsAsync(host), Is.Empty);
        await AssertProblemAsync(await host.Client.GetAsync($"{ConnectionsPath}/{IdOf(connectionOfA)}"), HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
        await AssertProblemAsync(await RevealAsync(host, IdOf(connectionOfA), passwordB), HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
        await AssertProblemAsync(await UpdateConnectionAsync(host, IdOf(connectionOfA), Body(password: null)), HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
        await AssertProblemAsync(await host.Client.DeleteAsync($"{ConnectionsPath}/{IdOf(connectionOfA)}"), HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
        // O nome do A está livre para o B, e o A continua com a conexão dele, com a senha.
        await CreateConnectionAsync(host, Body(name: "Produção", password: "senha-do-b"));
        await SignInAsync(host, "usuario.a", passwordA);
        Assert.That((await ListConnectionsAsync(host)).Select(IdOf), Is.EqualTo(new[] { IdOf(connectionOfA) }));
        Assert.That((await ReadJsonAsync(await RevealAsync(host, IdOf(connectionOfA), passwordA))).GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
    }

    /// <summary>
    /// Critério de aceite 2: o arquivo do cofre (e o `.bak`) não traz, em texto legível, nome de conexão, host,
    /// usuário nem senha. O `payload` vai em base64, que esconderia até um conteúdo gravado em claro: por isso as
    /// marcas também são procuradas nos bytes do `ciphertext` já decodificado.
    /// </summary>
    [Test]
    public async Task VaultFile_HasNoReadableNameHostUserOrPassword()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        string[] marks = ["MARCA-DO-NOME-DA-CONEXAO", "marca-do-host.exemplo", "marca_do_usuario_do_banco", "marca-do-banco-de-dados", DatabasePassword, userPassword];
        await CreateConnectionAsync(host, Body(name: marks[0], host: marks[1], userName: marks[2], database: marks[3], password: marks[4]));
        // Uma segunda gravação, para o `.bak` também ter conteúdo.
        await CreateConnectionAsync(host, Body(name: "Outra"));

        var files = Directory.GetFiles(host.DataDirectory, "*", SearchOption.AllDirectories);

        Assert.That(files.Select(Path.GetFileName), Is.EquivalentTo(new[] { "marina.costa.vault.json", "marina.costa.vault.json.bak" }));

        foreach (var path in files)
        {
            var raw = await File.ReadAllBytesAsync(path);
            var ciphertext = Convert.FromBase64String(JsonNode.Parse(raw)!["payload"]!["ciphertext"]!.GetValue<string>());

            foreach (var mark in marks)
            {
                Assert.That(raw.AsSpan().IndexOf(Encoding.UTF8.GetBytes(mark)), Is.LessThan(0), $"{Path.GetFileName(path)} tem {mark} em texto legível");
                Assert.That(ciphertext.AsSpan().IndexOf(Encoding.UTF8.GetBytes(mark)), Is.LessThan(0), $"{Path.GetFileName(path)} tem {mark} em claro dentro do conteúdo cifrado");
            }
        }
    }

    /// <summary>
    /// RN-CONN-016: a cópia nasce na mesma pasta, com todos os campos e a senha gravada, e o nome "(cópia)". A resposta é a do detalhe
    /// (`GET api/user/connections/{id}`), sem a senha (RN-CONN-001); a senha copiada é provada pela revelação da cópia, e não pela resposta.
    /// </summary>
    [Test]
    public async Task Duplicate_Returns201_WithTheCopyInTheSameFolder_AndTheStoredPassword()
    {
        await using var host = await ApiHost.StartAsync();
        var userPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", userPassword);
        var folderID = await CreateFolderAsync(host, "Fábrica");
        var source = await CreateConnectionAsync(host, Body(folderID: folderID, name: "MES Produção", engine: 3, host: "ifx.local", port: 9089, environmentName: "Produção", environmentColor: "#FF8800"));

        var response = await DuplicateAsync(host, IdOf(source));

        var raw = await response.Content.ReadAsStringAsync();
        var copy = JsonDocument.Parse(raw).RootElement;
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That(raw, Does.Not.Contain(DatabasePassword));
        Assert.That(IdOf(copy), Is.Not.EqualTo(IdOf(source)));
        Assert.That(response.Headers.Location?.ToString(), Is.EqualTo($"{ConnectionsPath}/{IdOf(copy)}"));
        Assert.That(copy.GetProperty("name").GetString(), Is.EqualTo("MES Produção (cópia)"));
        foreach (var field in new[] { "folderID", "engine", "host", "port", "database", "userName", "hasPassword", "environmentName", "environmentColor" })
            Assert.That(copy.GetProperty(field).GetRawText(), Is.EqualTo(source.GetProperty(field).GetRawText()), field);
        Assert.That(copy.GetProperty("createdAt").GetDateTime(), Is.EqualTo(copy.GetProperty("updatedAt").GetDateTime()));
        Assert.That(copy.GetProperty("createdAt").GetDateTime(), Is.GreaterThanOrEqualTo(source.GetProperty("createdAt").GetDateTime()));

        var detail = await host.Client.GetAsync($"{ConnectionsPath}/{IdOf(copy)}");
        Assert.That(detail.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(JsonDocument.Parse(await detail.Content.ReadAsStringAsync()).RootElement.GetRawText(), Is.EqualTo(copy.GetRawText()));

        var revealed = await RevealAsync(host, IdOf(copy), userPassword);
        Assert.That(revealed.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await ReadJsonAsync(revealed)).GetProperty("password").GetString(), Is.EqualTo(DatabasePassword));
        Assert.That(await ListConnectionsAsync(host), Has.Count.EqualTo(2));
    }

    /// <summary>RN-CONN-016: com "(cópia)" tomado, vem "(cópia 2)"; a cópia de uma cópia é "&lt;nome da cópia&gt; (cópia)".</summary>
    [Test]
    public async Task Duplicate_Twice_NumbersTheSecondCopy()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var source = await CreateConnectionAsync(host, Body(name: "MES"));

        var first = await ReadJsonAsync(await DuplicateAsync(host, IdOf(source)));
        var second = await ReadJsonAsync(await DuplicateAsync(host, IdOf(source)));
        var ofTheCopy = await ReadJsonAsync(await DuplicateAsync(host, IdOf(first)));

        Assert.That(first.GetProperty("name").GetString(), Is.EqualTo("MES (cópia)"));
        Assert.That(second.GetProperty("name").GetString(), Is.EqualTo("MES (cópia 2)"));
        Assert.That(ofTheCopy.GetProperty("name").GetString(), Is.EqualTo("MES (cópia) (cópia)"));
        Assert.That(await ListConnectionsAsync(host), Has.Count.EqualTo(4));
    }

    [Test]
    public async Task Duplicate_Unknown_Returns404ConnectionNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var response = await DuplicateAsync(host, Guid.CreateVersion7());

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
        Assert.That(await ListConnectionsAsync(host), Is.Empty);
    }

    [Test]
    public async Task Routes_WhileLocked_Return401VaultLocked()
    {
        await using var host = await ApiHost.StartAsync();
        var id = Guid.CreateVersion7();

        await AssertProblemAsync(await host.Client.GetAsync(ConnectionsPath), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await host.Client.GetAsync($"{ConnectionsPath}/{id}"), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await PostConnectionAsync(host, Body()), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await UpdateConnectionAsync(host, id, Body(password: null)), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await host.Client.DeleteAsync($"{ConnectionsPath}/{id}"), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await RevealAsync(host, id, "qualquer-senha"), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await DuplicateAsync(host, id), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    /// <summary>
    /// Duas criações do mesmo nome ao mesmo tempo. Não há conferência prévia que possa ficar velha: a regra mora na
    /// função que o serviço do cofre roda com o semáforo tomado, uma requisição por vez (RN-CONN-011), então a segunda
    /// enxerga a primeira e é recusada.
    /// </summary>
    [Test]
    public async Task Create_SameNameTwiceInParallel_OnlyOneSucceeds()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var responses = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => PostConnectionAsync(host, Body(name: "Produção"))));

        Assert.That(responses.Select(response => response.StatusCode), Is.EquivalentTo(new[] { HttpStatusCode.Created, HttpStatusCode.Conflict }));
        await AssertProblemAsync(responses.Single(response => response.StatusCode == HttpStatusCode.Conflict), HttpStatusCode.Conflict, "CONNECTION_ALREADY_EXISTS");
        Assert.That(await ListConnectionsAsync(host), Has.Count.EqualTo(1));
    }

    /// <summary>
    /// RN-CONN-002 e critério de aceite 5. Quem tem a sessão do A aberta e o token faz duas chamadas em paralelo: uma cria o
    /// usuário B (que o A não conhece a senha) e a outra revela a conexão do A com a senha do B. A leitura da conexão acontece
    /// com o cofre do A aberto; a conferência da senha, só depois de o B virar o cofre aberto. A resposta não pode ser 200 com a
    /// senha do banco do A: a senha confere contra o cofre do B, e a conexão tem de ser procurada nesse mesmo cofre, onde não
    /// está. O `UserCreatingQueries` cria o B logo depois de ler a conexão, que é o intercalamento exato dessa corrida.
    /// </summary>
    [Test]
    public async Task Reveal_WhenAnotherUserIsCreatedMidRequest_NeverReturnsThePassword()
    {
        var armed = new StrongBox<bool>();
        var passwordOfB = UserFakers.RandomPassword();
        await using var host = await ApiHost.StartAsync(services => services.Replace(ServiceDescriptor.Singleton<IConnectionQueries>(provider => new UserCreatingQueries(provider.GetRequiredService<IVaultService>(), armed, passwordOfB))));
        await host.CreateUserAsync("usuario.a", UserFakers.RandomPassword());
        var connection = await CreateConnectionAsync(host);
        armed.Value = true;

        var response = await RevealAsync(host, IdOf(connection), passwordOfB);

        var raw = await response.Content.ReadAsStringAsync();
        Assert.That(raw, Does.Not.Contain(DatabasePassword));
        Assert.That(response.StatusCode, Is.Not.EqualTo(HttpStatusCode.OK));
        Assert.That(JsonDocument.Parse(raw).RootElement.GetProperty("type").GetString(), Is.EqualTo("CONNECTION_NOT_FOUND"));
        // O teste só vale se o B realmente virou o cofre aberto no meio da requisição.
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/public/sessions"))).GetProperty("userName").GetString(), Is.EqualTo("usuario.b"));
    }

    /// <summary>
    /// O cofre fecha depois de o handler ler a conexão e antes de ela ser gravada (um `Lock` entre a leitura e a
    /// gravação). A leitura deu certo, então nada foi decidido por um "não": a gravação responde 401
    /// `VAULT_LOCKED`, e não um 404 nem um 409. O `VaultClosingQueries` lê e fecha o cofre depois, quando armado.
    /// </summary>
    [Test]
    public async Task Update_WhenTheVaultClosesAfterTheGate_Returns401VaultLocked()
    {
        var armed = new StrongBox<bool>();
        await using var host = await ApiHost.StartAsync(services => services.Replace(ServiceDescriptor.Singleton<IConnectionQueries>(provider => new VaultClosingQueries(provider.GetRequiredService<IVaultService>(), armed))));
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var connection = await CreateConnectionAsync(host);
        armed.Value = true;

        var response = await UpdateConnectionAsync(host, IdOf(connection), Body(name: "Nova", password: null));

        await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        Assert.That(await IsUnlockedAsync(host), Is.False);
    }

    /// <summary>
    /// A consulta como a `ConnectionQueries` de verdade a responde, mas depois de armada fecha o cofre assim que lê: o
    /// que um `Lock` (sair, o quinto erro de senha, outro usuário entrando) faria entre a leitura e a gravação.
    /// Antes de armada é só a leitura, para o teste arrumar o estado pelas rotas.
    /// </summary>
    private sealed class VaultClosingQueries(IVaultService vault, StrongBox<bool> armed) : IConnectionQueries
    {
        public Task<Result<VaultConnectionRecord?, EVaultError>> GetRecordByID(Guid id, CancellationToken cancellationToken)
        {
            var read = vault.Read();

            if (armed.Value)
                vault.Lock();

            return Task.FromResult(Find(read, id));
        }
    }

    /// <summary>
    /// A consulta como a `ConnectionQueries` de verdade a responde, mas depois de armada cria um segundo usuário assim que lê:
    /// o `CreateAsync` fecha o cofre do primeiro e abre o do novo, entre a leitura da conexão e a conferência da senha. Dispara uma vez.
    /// </summary>
    private sealed class UserCreatingQueries(IVaultService vault, StrongBox<bool> armed, string passwordOfTheNewUser) : IConnectionQueries
    {
        public async Task<Result<VaultConnectionRecord?, EVaultError>> GetRecordByID(Guid id, CancellationToken cancellationToken)
        {
            var read = vault.Read();

            if (armed.Value)
            {
                armed.Value = false;
                await vault.CreateAsync("usuario.b", passwordOfTheNewUser, cancellationToken);
            }

            return Find(read, id);
        }
    }

    private static Result<VaultConnectionRecord?, EVaultError> Find(Result<VaultDocument, EVaultError> read, Guid id)
    {
        if (read.IsFailure)
            return Result.Failure<VaultConnectionRecord?, EVaultError>(read.Error);

        return Result.Success<VaultConnectionRecord?, EVaultError>(read.Value.Connections.FirstOrDefault(connection => connection.ID == id));
    }
}
