using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// As rotas de sessão, catálogo e consulta (`api/user/database-sessions`) e o teste de conexão (`POST api/user/connections/test`), pela
/// API de verdade contra o PostgreSQL de teste com a carga `loja`: RN-SESSAO-001 a 005, RN-ARVORE-003, RN-SQL-001 a 013 e RN-CONN-013 e
/// 014. A barreira do cofre e o token já são provados em `FoldersTests`; aqui só se confere que as rotas novas ficam atrás deles. Cada
/// teste sobe uma API própria, com o cofre e a pasta de dados próprios; o banco é um só, e o que um teste cria nele (um esquema com
/// nome esquisito) ele mesmo apaga.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class DatabaseSessionsTests
{
    private const string UserName = "marina.costa";

    private ConnectionSettings _settings = null!;
    private DatabaseObserver _observer = null!;

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        _settings = await PostgresSingleton.GetSettingsAsync();
        _observer = await DatabaseObserver.OpenAsync(_settings);
    }

    [OneTimeTearDown]
    public async Task StopAsync()
        => await _observer.DisposeAsync();

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

    /// <summary>Como a tela escreve um nome de esquema ou de tabela na rota: `encodeURIComponent`, que deixa sem codificar `!`, `'`, `(`, `)` e `*`.</summary>
    private static string Encode(string value)
        => Uri.EscapeDataString(value).Replace("%21", "!").Replace("%27", "'").Replace("%28", "(").Replace("%29", ")").Replace("%2A", "*");

    private static string Quote(string identifier)
        => $"\"{identifier.Replace("\"", "\"\"")}\"";

    private static string Url(Guid sessionID, string tail = "")
        => $"{PrismCalls.SessionsPath}/{sessionID}{tail}";

    private static string TableUrl(Guid sessionID, string schema, string table, string route)
        => Url(sessionID, $"/schemas/{Encode(schema)}/tables/{Encode(table)}/{route}");

    /// <summary>Cria o usuário, grava a conexão com o contêiner e abre a sessão: o ponto de partida da maioria dos testes.</summary>
    private async Task<Guid> StartSessionAsync(ApiHost host)
    {
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());

        return await host.Client.OpenSessionAsync(await host.Client.CreateConnectionAsync(_settings));
    }

    private static async Task<List<JsonElement>> GetListAsync(ApiHost host, string url)
    {
        var response = await host.Client.GetAsync(url);
        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());

        return body.EnumerateArray().ToList();
    }

    private static string Marker()
        => $"marca{Guid.NewGuid():N}";

    [Test]
    public async Task Open_ForKnownConnection_Returns201WithEngineDatabaseAndVersion()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var connectionID = await host.Client.CreateConnectionAsync(_settings);

        var response = await host.Client.OpenSessionRawAsync(connectionID);

        var raw = await response.Content.ReadAsStringAsync();
        var body = JsonDocument.Parse(raw).RootElement;
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That(body.GetProperty("id").GetGuid(), Is.Not.EqualTo(Guid.Empty));
        Assert.That(response.Headers.Location?.ToString(), Is.EqualTo(Url(body.GetProperty("id").GetGuid())));
        Assert.That(body.GetProperty("connectionID").GetGuid(), Is.EqualTo(connectionID));
        // O banco vai como número (1, 2 ou 3): é o que a tela valida.
        Assert.That(body.GetProperty("engine").GetInt32(), Is.EqualTo(1));
        Assert.That(body.GetProperty("database").GetString(), Is.EqualTo(_settings.Database));
        Assert.That(body.GetProperty("serverVersion").GetString(), Is.Not.Empty);
        Assert.That(raw, Does.Not.Contain(_settings.Password));
    }

    [Test]
    public async Task Open_UnknownConnection_Returns404ConnectionNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());

        var response = await host.Client.OpenSessionRawAsync(Guid.CreateVersion7());

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
    }

    [Test]
    public async Task Open_WrongDatabasePassword_Returns422DatabaseConnectionFailed_WithTheDatabaseMessage()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var wrongPassword = UserFakers.RandomPassword();
        var connectionID = await host.Client.CreateConnectionAsync(_settings, password: wrongPassword);

        var response = await host.Client.OpenSessionRawAsync(connectionID);

        var body = await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "DATABASE_CONNECTION_FAILED");
        // RN-SESSAO-003: a mensagem original do banco, sem alteração.
        Assert.That(body.GetProperty("detail").GetString(), Does.Contain("password authentication failed"));
        Assert.That(body.ToString(), Does.Not.Contain(wrongPassword));
    }

    [Test]
    public async Task Open_WithVaultLocked_Returns401VaultLocked()
    {
        await using var host = await ApiHost.StartAsync();

        var response = await host.Client.OpenSessionRawAsync(Guid.CreateVersion7());

        await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    /// <summary>RN-API-005: toda rota nova começa por `api/user/`, e a barreira do cofre a fecha sem que o controller faça nada.</summary>
    [Test]
    public async Task Routes_WithVaultLocked_Return401VaultLocked()
    {
        await using var host = await ApiHost.StartAsync();
        var session = Url(Guid.CreateVersion7());
        var routes = new (HttpMethod Method, string Path)[]
        {
            (HttpMethod.Delete, session),
            (HttpMethod.Get, $"{session}/schemas"),
            (HttpMethod.Get, $"{session}/schemas/loja/objects?kind=tables"),
            (HttpMethod.Get, $"{session}/schemas/loja/tables/pedido/columns"),
            (HttpMethod.Get, $"{session}/schemas/loja/tables/pedido/indexes"),
            (HttpMethod.Get, $"{session}/schemas/loja/tables/pedido/foreign-keys"),
            (HttpMethod.Post, $"{session}/queries"),
            (HttpMethod.Post, $"{session}/queries/next"),
            (HttpMethod.Post, $"{session}/queries/count"),
            (HttpMethod.Post, $"{session}/queries/cancel"),
            (HttpMethod.Post, "/api/user/connections/test")
        };

        foreach (var (method, path) in routes)
        {
            var response = await host.Client.SendAsync(new HttpRequestMessage(method, path));

            await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        }
    }

    [Test]
    public async Task Close_Returns204()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var response = await host.Client.DeleteAsync(Url(sessionID));

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        // Fechada de verdade: nem o catálogo a encontra.
        await AssertProblemAsync(await host.Client.GetAsync(Url(sessionID, "/schemas")), HttpStatusCode.NotFound, "DATABASE_SESSION_NOT_FOUND");
    }

    [Test]
    public async Task Close_Unknown_Returns404DatabaseSessionNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());

        var response = await host.Client.DeleteAsync(Url(Guid.CreateVersion7()));

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "DATABASE_SESSION_NOT_FOUND");
    }

    [Test]
    public async Task Schemas_Return200()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var schemas = await GetListAsync(host, Url(sessionID, "/schemas"));

        var loja = schemas.Single(schema => schema.GetProperty("name").GetString() == "loja");
        Assert.That(loja.GetProperty("isSystem").GetBoolean(), Is.False);
        // RN-ARVORE-004: os esquemas de sistema vêm depois dos demais.
        Assert.That(schemas.Select(schema => schema.GetProperty("isSystem").GetBoolean()), Is.Ordered);
        Assert.That(schemas.Single(schema => schema.GetProperty("name").GetString() == "pg_catalog").GetProperty("isSystem").GetBoolean(), Is.True);
        // RN-CAT-010: as contagens do que a lista de objetos mostra. `loja` tem as tabelas da carga (com as partições), uma visão e uma rotina.
        Assert.That(loja.GetProperty("tables").GetInt32(), Is.EqualTo(8));
        Assert.That(loja.GetProperty("views").GetInt32(), Is.EqualTo(1));
        Assert.That(loja.GetProperty("routines").GetInt32(), Is.EqualTo(1));
    }

    [Test]
    public async Task Objects_Return200()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var tables = await GetListAsync(host, Url(sessionID, "/schemas/loja/objects?kind=tables"));
        var views = await GetListAsync(host, Url(sessionID, "/schemas/loja/objects?kind=views"));
        var routines = await GetListAsync(host, Url(sessionID, "/schemas/loja/objects?kind=routines"));

        Assert.That(tables.Select(item => item.GetProperty("name").GetString()), Does.Contain("pedido").And.Contain("cliente"));
        Assert.That(tables.Select(item => item.GetProperty("kind").GetString()), Is.All.EqualTo("table"));
        Assert.That(views.Single().GetProperty("name").GetString(), Is.EqualTo("pedido_resumo"));
        Assert.That(views.Single().GetProperty("kind").GetString(), Is.EqualTo("view"));
        Assert.That(routines.Single().GetProperty("name").GetString(), Is.EqualTo("dobro"));
        Assert.That(routines.Single().GetProperty("kind").GetString(), Is.EqualTo("function"));
        // RN-CAT-009: as duas chaves vêm em todo tipo de objeto, nulas onde não se aplicam. A carga não analisa nem comenta nada.
        Assert.That(tables.Concat(views).Concat(routines).Select(item => (item.GetProperty("estimatedRows").ValueKind, item.GetProperty("comment").ValueKind)), Is.All.EqualTo((JsonValueKind.Null, JsonValueKind.Null)));
    }

    [Test]
    public async Task Objects_InvalidKind_Returns422ObjectKindInvalid()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        foreach (var path in new[] { "/schemas/loja/objects?kind=sequences", "/schemas/loja/objects?kind=", "/schemas/loja/objects" })
            await AssertProblemAsync(await host.Client.GetAsync(Url(sessionID, path)), HttpStatusCode.UnprocessableEntity, "OBJECT_KIND_INVALID");
    }

    [Test]
    public async Task Columns_Return200()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var columns = await GetListAsync(host, TableUrl(sessionID, "loja", "pedido", "columns"));

        Assert.That(columns.Select(column => column.GetProperty("name").GetString()), Is.EqualTo(new[] { "id", "numero", "cliente_id", "valor", "criado_em", "observacao" }));
        var id = columns[0];
        Assert.That(id.GetProperty("type").GetString(), Is.EqualTo("integer"));
        Assert.That(id.GetProperty("isNullable").GetBoolean(), Is.False);
        Assert.That(id.GetProperty("isPrimaryKey").GetBoolean(), Is.True);
        Assert.That(id.GetProperty("position").GetInt32(), Is.EqualTo(1));
        Assert.That(columns[3].GetProperty("type").GetString(), Is.EqualTo("numeric(12,2)"));
        Assert.That(columns[3].GetProperty("isPrimaryKey").GetBoolean(), Is.False);
        Assert.That(columns[5].GetProperty("isNullable").GetBoolean(), Is.True);
        // RN-CAT-001: as duas chaves vêm sempre, nulas quando a coluna não tem padrão nem é gerada.
        Assert.That(columns.Select(column => (column.GetProperty("defaultValue").ValueKind, column.GetProperty("generated").ValueKind)), Is.All.EqualTo((JsonValueKind.Null, JsonValueKind.Null)));
    }

    [Test]
    public async Task Indexes_Return200()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var indexes = await GetListAsync(host, TableUrl(sessionID, "loja", "pedido", "indexes"));

        var unique = indexes.Single(index => index.GetProperty("name").GetString() == "uk_pedido_numero");
        Assert.That(unique.GetProperty("isUnique").GetBoolean(), Is.True);
        Assert.That(unique.GetProperty("columns").EnumerateArray().Select(column => column.GetString()), Is.EqualTo(new[] { "numero" }));
        var composite = indexes.Single(index => index.GetProperty("name").GetString() == "ix_pedido_cliente_data");
        Assert.That(composite.GetProperty("isUnique").GetBoolean(), Is.False);
        Assert.That(composite.GetProperty("columns").EnumerateArray().Select(column => column.GetString()), Is.EqualTo(new[] { "cliente_id", "criado_em" }));
        // RN-CAT-003.
        Assert.That(indexes.Select(index => index.GetProperty("method").GetString()), Is.All.EqualTo("btree"));
    }

    [Test]
    public async Task ForeignKeys_Return200()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var foreignKeys = await GetListAsync(host, TableUrl(sessionID, "loja", "pedido", "foreign-keys"));

        var foreignKey = foreignKeys.Single();
        Assert.That(foreignKey.GetProperty("name").GetString(), Is.EqualTo("fk_pedido_cliente"));
        Assert.That(foreignKey.GetProperty("columns").EnumerateArray().Select(column => column.GetString()), Is.EqualTo(new[] { "cliente_id" }));
        Assert.That(foreignKey.GetProperty("referencedSchema").GetString(), Is.EqualTo("loja"));
        Assert.That(foreignKey.GetProperty("referencedTable").GetString(), Is.EqualTo("cliente"));
        Assert.That(foreignKey.GetProperty("referencedColumns").EnumerateArray().Select(column => column.GetString()), Is.EqualTo(new[] { "id" }));
        // RN-CAT-002: sem regra escrita, o PostgreSQL guarda "sem ação" nas duas.
        Assert.That(foreignKey.GetProperty("onDelete").GetString(), Is.EqualTo("noAction"));
        Assert.That(foreignKey.GetProperty("onUpdate").GetString(), Is.EqualTo("noAction"));
    }

    /// <summary>
    /// RN-CAT-004, 005, 006, 008 e 010: as rotas novas do catálogo, com o contrato que a tela lê (os nomes das chaves e o nulo que vem
    /// sempre). Cada corpo vai para a saída do teste.
    /// </summary>
    [Test]
    public async Task ExtendedCatalog_Returns200WithTheContract()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var referencedBy = await GetListAsync(host, TableUrl(sessionID, "loja", "cliente", "referenced-by"));
        var checks = await GetListAsync(host, TableUrl(sessionID, "loja", "pedido", "checks"));
        var definitionResponse = await host.Client.GetAsync(Url(sessionID, "/schemas/loja/views/pedido_resumo/definition"));
        var definition = await ReadJsonAsync(definitionResponse);
        var missing = await ReadJsonAsync(await host.Client.GetAsync(Url(sessionID, "/schemas/loja/views/nao_existe/definition")));
        var diagramResponse = await host.Client.GetAsync(Url(sessionID, "/schemas/loja/diagram"));
        var diagram = await ReadJsonAsync(diagramResponse);
        var properties = await GetListAsync(host, Url(sessionID, "/properties"));
        foreach (var (route, body) in new[] { ("referenced-by", JsonSerializer.Serialize(referencedBy)), ("checks", JsonSerializer.Serialize(checks)), ("definition", definition.ToString()), ("definition (nao_existe)", missing.ToString()), ("diagram", diagram.ToString()), ("properties", JsonSerializer.Serialize(properties)) })
            await TestContext.Out.WriteLineAsync($"{route} -> {(body.Length > 1500 ? body[..1500] + "…" : body)}");

        var key = referencedBy.Single();
        Assert.That(key.EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "name", "referencingSchema", "referencingTable", "columns", "referencedColumns", "onDelete", "onUpdate" }));
        Assert.That((key.GetProperty("name").GetString(), key.GetProperty("referencingSchema").GetString(), key.GetProperty("referencingTable").GetString()), Is.EqualTo(("fk_pedido_cliente", "loja", "pedido")));
        Assert.That(key.GetProperty("columns").EnumerateArray().Select(column => column.GetString()), Is.EqualTo(new[] { "cliente_id" }));
        Assert.That(key.GetProperty("referencedColumns").EnumerateArray().Select(column => column.GetString()), Is.EqualTo(new[] { "id" }));
        Assert.That(checks, Is.Empty);
        Assert.That(definitionResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(definition.GetProperty("definition").GetString(), Does.Contain("FROM loja.pedido"));
        Assert.That(missing.GetProperty("definition").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(diagramResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(diagram.EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "tables", "foreignKeys" }));
        var cliente = diagram.GetProperty("tables").EnumerateArray().Single(table => table.GetProperty("name").GetString() == "cliente");
        Assert.That(cliente.GetProperty("columns")[0].EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "name", "type", "isNullable", "isPrimaryKey" }));
        var diagramKey = diagram.GetProperty("foreignKeys").EnumerateArray().Single(item => item.GetProperty("name").GetString() == "fk_pedido_cliente");
        Assert.That(diagramKey.EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "name", "referencingTable", "columns", "referencedSchema", "referencedTable", "referencedColumns", "onDelete", "onUpdate" }));
        Assert.That(diagram.GetProperty("tables").EnumerateArray().Select(table => table.GetProperty("name").GetString()), Does.Not.Contain("pedido_resumo"));
        Assert.That(properties.Select(property => property.GetProperty("name").GetString()), Does.Contain("encoding").And.Contain("sizeBytes"));
        Assert.That(properties.Select(property => property.EnumerateObject().Select(field => field.Name)), Is.All.EqualTo(new[] { "name", "value" }));
    }

    [Test]
    public async Task Catalog_UnknownSession_Returns404DatabaseSessionNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var unknown = Guid.CreateVersion7();

        foreach (var path in new[] { Url(unknown, "/schemas"), Url(unknown, "/schemas/loja/objects?kind=tables"), TableUrl(unknown, "loja", "pedido", "columns"), TableUrl(unknown, "loja", "pedido", "indexes"), TableUrl(unknown, "loja", "pedido", "foreign-keys"), TableUrl(unknown, "loja", "cliente", "referenced-by"), TableUrl(unknown, "loja", "pedido", "checks"), Url(unknown, "/schemas/loja/views/pedido_resumo/definition"), Url(unknown, "/schemas/loja/diagram"), Url(unknown, "/properties") })
            await AssertProblemAsync(await host.Client.GetAsync(path), HttpStatusCode.NotFound, "DATABASE_SESSION_NOT_FOUND");
    }

    /// <summary>A tabela da carga tem aspa simples, aspas duplas e espaço no nome.</summary>
    [Test]
    public async Task Columns_OfSchemaAndTableWithSpecialCharacters_Return200()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var columns = await GetListAsync(host, TableUrl(sessionID, "loja", "O'Brien \"x\"", "columns"));

        Assert.That(columns.Select(column => column.GetProperty("name").GetString()), Is.EqualTo(new[] { "id", "nome completo" }));
    }

    /// <summary>
    /// A tela codifica cada nome com `encodeURIComponent`, e o ASP.NET Core não decodifica o `%2F` do valor de rota. Os nomes têm barra,
    /// espaço, aspas duplas e, de propósito, os textos literais `%2F` e `%41`: quem decodifica duas vezes (ou em dois lugares) leria
    /// `/` e `A` no lugar deles e não acharia a tabela.
    /// </summary>
    [Test]
    public async Task Columns_OfSchemaAndTableWithSlashSpaceAndQuotes_Return200()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var schema = $"s/ \"q\" 100% %2F {suffix}";
        var table = $"t/ \"q\" %41 %2F {suffix}";

        await host.Client.ExecuteAsync(sessionID, $"CREATE SCHEMA {Quote(schema)}");

        try
        {
            await host.Client.ExecuteAsync(sessionID, $"CREATE TABLE {Quote(schema)}.{Quote(table)} (id integer PRIMARY KEY, {Quote("nome \"x\" %41")} text)");

            var columns = await GetListAsync(host, TableUrl(sessionID, schema, table, "columns"));
            var indexes = await GetListAsync(host, TableUrl(sessionID, schema, table, "indexes"));
            var foreignKeys = await GetListAsync(host, TableUrl(sessionID, schema, table, "foreign-keys"));
            var objects = await GetListAsync(host, Url(sessionID, $"/schemas/{Encode(schema)}/objects?kind=tables"));
            await host.Client.ExecuteAsync(sessionID, $"CREATE VIEW {Quote(schema)}.{Quote(table + " v")} AS SELECT id FROM {Quote(schema)}.{Quote(table)}");
            var referencedBy = await GetListAsync(host, TableUrl(sessionID, schema, table, "referenced-by"));
            var checks = await GetListAsync(host, TableUrl(sessionID, schema, table, "checks"));
            var definition = await ReadJsonAsync(await host.Client.GetAsync(Url(sessionID, $"/schemas/{Encode(schema)}/views/{Encode(table + " v")}/definition")));
            var diagram = await ReadJsonAsync(await host.Client.GetAsync(Url(sessionID, $"/schemas/{Encode(schema)}/diagram")));

            Assert.That(columns.Select(column => column.GetProperty("name").GetString()), Is.EqualTo(new[] { "id", "nome \"x\" %41" }));
            Assert.That(indexes, Has.Count.EqualTo(1));
            Assert.That(foreignKeys, Is.Empty);
            Assert.That(objects.Select(item => item.GetProperty("name").GetString()), Is.EqualTo(new[] { table }));
            Assert.That(referencedBy, Is.Empty);
            Assert.That(checks, Is.Empty);
            Assert.That(definition.GetProperty("definition").GetString(), Does.Contain(Quote(table)));
            Assert.That(diagram.GetProperty("tables").EnumerateArray().Select(item => item.GetProperty("name").GetString()), Is.EqualTo(new[] { table }));
        }
        finally
        {
            await host.Client.ExecuteAsync(sessionID, $"DROP SCHEMA {Quote(schema)} CASCADE");
        }
    }

    /// <summary>
    /// O Kestrel tira `.` e `..` (crus ou `%2E`) do caminho ANTES de rotear, e o alvo cru fica como chegou: ler os nomes dele leria posições
    /// diferentes das que o roteador casou (`.../tables/segredo/../pedido/columns` casa `loja`/`pedido` e o alvo cru diz `segredo`/`pedido`).
    /// Um caminho com esse segmento responde como a rota que não casa: 404 sem corpo. Por socket, porque o `HttpClient` normaliza a URL.
    /// </summary>
    [TestCase("/schemas/loja/tables/segredo/../pedido/columns")]
    [TestCase("/schemas/loja/tables/segredo/%2E%2E/pedido/columns")]
    [TestCase("/schemas/loja/tables/segredo/%2e%2e/pedido/columns")]
    [TestCase("/schemas/loja/tables/segredo/.%2E/pedido/columns")]
    [TestCase("/schemas/loja/tables/pedido/x/../columns")]
    [TestCase("/schemas/loja/tables/pedido/x/%2E%2E/columns")]
    [TestCase("/schemas/loja/tables/pedido/x/%2e%2e/columns")]
    [TestCase("/schemas/loja/tables/pedido/./columns")]
    [TestCase("/schemas/loja/tables/pedido/%2E/columns")]
    [TestCase("/schemas/loja/tables/pedido/%2e/columns")]
    [TestCase("/schemas/loja/tables/pedido/x/../indexes")]
    [TestCase("/schemas/loja/tables/pedido/./foreign-keys")]
    [TestCase("/schemas/loja/x/../objects?kind=tables")]
    [TestCase("/schemas/loja/x/%2E%2E/objects?kind=tables")]
    [TestCase("/schemas/loja/./objects?kind=tables")]
    public async Task Catalog_PathWithDotSegments_Returns404AsAnUnmatchedRoute(string tail)
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var (status, body) = await RawHttp.GetAsync(host, Url(sessionID, tail));
        var (unmatchedStatus, unmatchedBody) = await RawHttp.GetAsync(host, Url(sessionID, "/rota/que/nao/existe"));

        Assert.That(status, Is.EqualTo(HttpStatusCode.NotFound), body);
        Assert.That(body, Is.Empty);
        Assert.That((status, body), Is.EqualTo((unmatchedStatus, unmatchedBody)), "A resposta tem de ser a da rota que não casa.");
    }

    /// <summary>Só o segmento que é exatamente `.` ou `..` é recusado: pontos dentro de um nome são um nome como outro qualquer, e o alvo cru continua servindo os nomes de sempre.</summary>
    [Test]
    public async Task Catalog_NamesWithDotsInsideThem_Return200()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);
        var schema = $"..x {Guid.NewGuid():N}"[..14];
        const string table = "...";

        await host.Client.ExecuteAsync(sessionID, $"CREATE SCHEMA {Quote(schema)}");

        try
        {
            await host.Client.ExecuteAsync(sessionID, $"CREATE TABLE {Quote(schema)}.{Quote(table)} (id integer PRIMARY KEY)");

            var (status, body) = await RawHttp.GetAsync(host, TableUrl(sessionID, schema, table, "columns"));
            var (specialStatus, specialBody) = await RawHttp.GetAsync(host, Url(sessionID, "/schemas/loja/tables/O'Brien%20%22x%22/columns"));

            Assert.That(status, Is.EqualTo(HttpStatusCode.OK), body);
            Assert.That(body, Does.Contain("\"name\":\"id\""));
            Assert.That(specialStatus, Is.EqualTo(HttpStatusCode.OK), specialBody);
            Assert.That(specialBody, Does.Contain("nome completo"));
        }
        finally
        {
            await host.Client.ExecuteAsync(sessionID, $"DROP SCHEMA {Quote(schema)} CASCADE");
        }
    }

    [Test]
    public async Task Query_Select_Returns200WithFirst200Rows_AndHasMore()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var body = await host.Client.ExecuteAsync(sessionID, "SELECT numero, observacao FROM loja.pedido ORDER BY numero");

        var rows = body.GetProperty("rows").EnumerateArray().ToList();
        Assert.That(rows, Has.Count.EqualTo(200));
        Assert.That(body.GetProperty("hasMore").GetBoolean(), Is.True);
        Assert.That(body.GetProperty("elapsedMs").GetInt64(), Is.GreaterThanOrEqualTo(0));
        Assert.That(body.GetProperty("truncatedCells").GetArrayLength(), Is.Zero);
        Assert.That(body.GetProperty("rowsAffected").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(body.GetProperty("totalRows").ValueKind, Is.EqualTo(JsonValueKind.Null));
        var columns = body.GetProperty("columns").EnumerateArray().ToList();
        Assert.That(columns.Select(column => column.GetProperty("name").GetString()), Is.EqualTo(new[] { "numero", "observacao" }));
        Assert.That(columns.Select(column => column.GetProperty("kind").GetString()), Is.EqualTo(new[] { "number", "text" }));
        Assert.That(rows[0].EnumerateArray().Select(cell => cell.GetString()), Is.EqualTo(new[] { "1001", "Pedido 1" }));
        // RN-SQL-011: nulo viaja como nulo, e não como texto.
        Assert.That(rows[6][1].ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    /// <summary>RN-SQL-011: texto acima de 10.000 caracteres chega cortado, e a célula cortada vem como par `[linha, coluna]` (contando de zero) dentro da página.</summary>
    [Test]
    public async Task Query_LongText_Returns200WithTruncatedCells()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var body = await host.Client.ExecuteAsync(sessionID, "SELECT 1 AS curto, repeat('x', 10001) AS longo");

        var row = body.GetProperty("rows")[0];
        Assert.That(row[0].GetString(), Is.EqualTo("1"));
        Assert.That(row[1].GetString(), Has.Length.EqualTo(10000));
        Assert.That(body.GetProperty("truncatedCells").GetArrayLength(), Is.EqualTo(1));
        Assert.That(body.GetProperty("truncatedCells")[0].EnumerateArray().Select(index => index.GetInt32()), Is.EqualTo(new[] { 0, 1 }));
    }

    [Test]
    public async Task Query_Next_Returns200WithFollowingRows()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);
        await host.Client.ExecuteAsync(sessionID, "SELECT numero FROM loja.pedido ORDER BY numero");

        var response = await host.Client.PostAsync(Url(sessionID, "/queries/next"), null);

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        Assert.That(body.GetProperty("rows").GetArrayLength(), Is.EqualTo(200));
        Assert.That(body.GetProperty("rows")[0][0].GetString(), Is.EqualTo("1201"));
        Assert.That(body.GetProperty("hasMore").GetBoolean(), Is.True);
    }

    [Test]
    public async Task Query_Next_WithoutCursor_Returns409NoOpenCursor()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var response = await host.Client.PostAsync(Url(sessionID, "/queries/next"), null);

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "NO_OPEN_CURSOR");
    }

    [Test]
    public async Task Query_Count_Returns200WithTotal()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);
        await host.Client.ExecuteAsync(sessionID, "SELECT numero FROM loja.pedido ORDER BY numero");

        var response = await host.Client.PostAsync(Url(sessionID, "/queries/count"), null);

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        Assert.That(body.GetProperty("total").GetInt64(), Is.EqualTo(1000));
    }

    [Test]
    public async Task Query_Count_WithoutQuery_Returns409NoQueryToCount()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var response = await host.Client.PostAsync(Url(sessionID, "/queries/count"), null);

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "NO_QUERY_TO_COUNT");
    }

    [Test]
    public async Task Query_Update_Returns200WithRowsAffected()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        // Grava o mesmo valor: a carga `loja` é compartilhada e não pode mudar (RN-SQL-008).
        var body = await host.Client.ExecuteAsync(sessionID, "UPDATE loja.pedido SET id = id WHERE id <= 5");

        Assert.That(body.GetProperty("rowsAffected").GetInt64(), Is.EqualTo(5));
        Assert.That(body.GetProperty("elapsedMs").GetInt64(), Is.GreaterThanOrEqualTo(0));
        Assert.That(body.GetProperty("columns").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(body.GetProperty("rows").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    /// <summary>RN-SQL-013: o comando que grava e devolve linhas vai até o fim, a resposta traz as 200 primeiras e o total, e não sobra cursor.</summary>
    [Test]
    public async Task Query_WriteReturningRows_Returns200WithTotalRows_AndNoCursor()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var body = await host.Client.ExecuteAsync(sessionID, "UPDATE loja.pedido SET id = id RETURNING id, numero");

        Assert.That(body.GetProperty("rows").GetArrayLength(), Is.EqualTo(200));
        Assert.That(body.GetProperty("hasMore").GetBoolean(), Is.False);
        Assert.That(body.GetProperty("totalRows").GetInt64(), Is.EqualTo(1000));
        await AssertProblemAsync(await host.Client.PostAsync(Url(sessionID, "/queries/next"), null), HttpStatusCode.Conflict, "NO_OPEN_CURSOR");
        // Contar seria gravar de novo: o total que veio com a resposta é o que a contagem devolve.
        var count = await ReadJsonAsync(await host.Client.PostAsync(Url(sessionID, "/queries/count"), null));
        Assert.That(count.GetProperty("total").GetInt64(), Is.EqualTo(1000));
    }

    [Test]
    public async Task Query_SyntaxError_Returns422SqlExecutionFailed_WithMessageAndSqlState()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var response = await host.Client.ExecuteRawAsync(sessionID, "SELECT * FRM loja.cliente");

        var body = await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "SQL_EXECUTION_FAILED");
        // RN-SQL-009: a mensagem do banco como veio, o SQLSTATE e a posição do erro (a de `FRM`, contando de 1).
        Assert.That(body.GetProperty("detail").GetString(), Does.Contain("syntax error"));
        Assert.That(body.GetProperty("sqlState").GetString(), Is.EqualTo("42601"));
        Assert.That(body.GetProperty("position").GetInt32(), Is.EqualTo(10));
        // RN-SQL-010: sem pedido de cancelamento, sem desfecho.
        Assert.That(body.TryGetProperty("outcome", out _), Is.False);
    }

    [Test]
    public async Task Query_TransactionControl_Returns422TransactionControlNotSupported()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var response = await host.Client.ExecuteRawAsync(sessionID, "BEGIN");

        var body = await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "TRANSACTION_CONTROL_NOT_SUPPORTED");
        // RN-SESSAO-005 (Ruling 135): recusado antes de executar, sem `executed`.
        Assert.That(body.TryGetProperty("executed", out _), Is.False);
        // Recusado sem ir ao banco: a sessão segue servindo.
        await host.Client.ExecuteAsync(sessionID, "SELECT 1");
    }

    [Test]
    public async Task Query_EmptySql_Returns422()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        foreach (var body in new object[] { new { sql = "" }, new { sql = "  \r\n\t " }, new { } })
            await AssertProblemAsync(await host.Client.PostAsJsonAsync(Url(sessionID, "/queries"), body), HttpStatusCode.UnprocessableEntity, "QUERY_INVALID");
    }

    /// <summary>RN-SQL-016: `pageSize` vale para a primeira página e para o "carregar mais" do mesmo cursor, que não recebe tamanho.</summary>
    [Test]
    public async Task Query_WithPageSize_Returns200WithThatManyRows_AndNextKeepsIt()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        var first = await host.Client.PostAsJsonAsync(Url(sessionID, "/queries"), new { sql = "SELECT numero FROM loja.pedido ORDER BY numero", pageSize = 50 });
        var firstBody = await ReadJsonAsync(first);
        var next = await host.Client.PostAsync(Url(sessionID, "/queries/next"), null);
        var nextBody = await ReadJsonAsync(next);

        Assert.That(first.StatusCode, Is.EqualTo(HttpStatusCode.OK), firstBody.ToString());
        Assert.That(firstBody.GetProperty("rows").GetArrayLength(), Is.EqualTo(50));
        Assert.That(firstBody.GetProperty("hasMore").GetBoolean(), Is.True);
        Assert.That(next.StatusCode, Is.EqualTo(HttpStatusCode.OK), nextBody.ToString());
        Assert.That(nextBody.GetProperty("rows").GetArrayLength(), Is.EqualTo(50));
        Assert.That(nextBody.GetProperty("rows")[0][0].GetString(), Is.EqualTo("1051"));
    }

    /// <summary>
    /// RN-SQL-016: fora de 50 a 1000, ou o que não é inteiro, é 422 `QUERY_INVALID` no campo, pelo mesmo caminho do SQL vazio, e não vai
    /// ao banco. O nulo vale como a falta do campo.
    /// </summary>
    [Test]
    public async Task Query_InvalidPageSize_Returns422QueryInvalidOnTheField()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);

        foreach (var pageSize in new[] { "49", "1001", "0", "-50", "\"texto\"", "\"200\"", "200.5" })
        {
            var response = await host.Client.PostAsync(Url(sessionID, "/queries"), new StringContent($"{{\"sql\":\"SELECT 1\",\"pageSize\":{pageSize}}}", Encoding.UTF8, "application/json"));
            var body = await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "QUERY_INVALID");
            Assert.That(body.GetProperty("errorCodes").GetProperty("PageSize")[0].GetString(), Is.EqualTo("QUERY_INVALID"), pageSize);
            Assert.That(body.GetProperty("errorCodes").TryGetProperty("Sql", out _), Is.False, pageSize);
        }

        var withNull = await host.Client.PostAsync(Url(sessionID, "/queries"), new StringContent("{\"sql\":\"SELECT numero FROM loja.pedido\",\"pageSize\":null}", Encoding.UTF8, "application/json"));
        var withNullBody = await ReadJsonAsync(withNull);
        Assert.That(withNull.StatusCode, Is.EqualTo(HttpStatusCode.OK), withNullBody.ToString());
        Assert.That(withNullBody.GetProperty("rows").GetArrayLength(), Is.EqualTo(200));
    }

    [Test]
    public async Task Query_UnknownSession_Returns404DatabaseSessionNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var unknown = Guid.CreateVersion7();

        await AssertProblemAsync(await host.Client.ExecuteRawAsync(unknown, "SELECT 1"), HttpStatusCode.NotFound, "DATABASE_SESSION_NOT_FOUND");
        foreach (var route in new[] { "next", "count", "cancel" })
            await AssertProblemAsync(await host.Client.PostAsync(Url(unknown, $"/queries/{route}"), null), HttpStatusCode.NotFound, "DATABASE_SESSION_NOT_FOUND");
    }

    [Test]
    public async Task Query_WhileBusy_Returns409SessionBusy()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);
        var marker = Marker();
        var running = host.Client.ExecuteRawAsync(sessionID, $"SELECT pg_sleep(30) AS {marker}");
        await _observer.WaitForRunningAsync(marker);

        var busy = await host.Client.ExecuteRawAsync(sessionID, "SELECT 1");
        var next = await host.Client.PostAsync(Url(sessionID, "/queries/next"), null);

        await AssertProblemAsync(busy, HttpStatusCode.Conflict, "SESSION_BUSY");
        await AssertProblemAsync(next, HttpStatusCode.Conflict, "SESSION_BUSY");
        // Não deixa o sono de 30 s para o descarte do host.
        await host.Client.PostAsync(Url(sessionID, "/queries/cancel"), null);
        await running;
    }

    [Test]
    public async Task Query_Cancel_Returns204_AndTheRunningQueryFails()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);
        var marker = Marker();
        var running = host.Client.ExecuteRawAsync(sessionID, $"SELECT pg_sleep(30) AS {marker}");
        await _observer.WaitForRunningAsync(marker);

        var cancel = await host.Client.PostAsync(Url(sessionID, "/queries/cancel"), null);

        Assert.That(cancel.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        var response = await running;
        var body = await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "SQL_EXECUTION_FAILED");
        // 57014: o banco diz que o comando foi cancelado a pedido. RN-SQL-010 (Ruling 135): a tela lê o desfecho, e não o texto.
        Assert.That(body.GetProperty("sqlState").GetString(), Is.EqualTo("57014"));
        Assert.That(body.GetProperty("outcome").GetString(), Is.EqualTo("canceled"));
    }

    /// <summary>
    /// RN-SQL-010: "cancelar" interrompe também a contagem. As 200 primeiras linhas saem na hora, e só a linha 1001 dorme: executar e paginar
    /// são rápidos, e contar fica preso no sono, em outra conexão.
    /// </summary>
    [Test]
    public async Task Query_Cancel_ReachesARunningCount()
    {
        await using var host = await ApiHost.StartAsync();
        var sessionID = await StartSessionAsync(host);
        var marker = Marker();
        await host.Client.ExecuteAsync(sessionID, $"SELECT numero, CASE WHEN numero > 1000 THEN pg_sleep(30) END AS {marker} FROM generate_series(1, 1001) AS numero");
        var counting = host.Client.PostAsync(Url(sessionID, "/queries/count"), null);
        // O banco da sessão também chega à linha 1001 e dorme (já executou o comando inteiro): só a contagem começa por `SELECT COUNT(*) FROM (`.
        await _observer.WaitForRunningAsync(marker, "SELECT COUNT(*) FROM (");

        var cancel = await host.Client.PostAsync(Url(sessionID, "/queries/cancel"), null);

        Assert.That(cancel.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        // 57014: o banco diz que a contagem, que já estava rodando, foi cancelada a pedido.
        var body = await AssertProblemAsync(await counting, HttpStatusCode.UnprocessableEntity, "SQL_EXECUTION_FAILED");
        Assert.That(body.GetProperty("sqlState").GetString(), Is.EqualTo("57014"));
        Assert.That(body.GetProperty("outcome").GetString(), Is.EqualTo("canceled"));
    }

    /// <summary>RN-COFRE-008: sair fecha o cofre e, com ele, as sessões. Depois de entrar de novo o identificador antigo não existe.</summary>
    [Test]
    public async Task SignOut_ClosesSessions()
    {
        await using var host = await ApiHost.StartAsync();
        var password = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, password);
        var sessionID = await host.Client.OpenSessionAsync(await host.Client.CreateConnectionAsync(_settings));
        var backendPid = await host.Client.BackendPidAsync(sessionID);
        await WaitForBackendAsync(backendPid, 1);

        Assert.That((await host.Client.DeleteAsync("/api/public/sessions")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That((await host.Client.PostAsJsonAsync("/api/public/sessions", new { userName = UserName, password })).StatusCode, Is.EqualTo(HttpStatusCode.OK));

        await AssertProblemAsync(await host.Client.GetAsync(Url(sessionID, "/schemas")), HttpStatusCode.NotFound, "DATABASE_SESSION_NOT_FOUND");
        // Não basta o identificador sumir do registro: a conexão com o banco tem de ter fechado.
        await WaitForBackendAsync(backendPid, 0);
    }

    /// <summary>RN-CONN-014: excluir a conexão encerra as sessões dela, e só as dela.</summary>
    [Test]
    public async Task DeleteConnection_ClosesItsSessions()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var deleted = await host.Client.CreateConnectionAsync(_settings, name: "Excluída");
        var kept = await host.Client.CreateConnectionAsync(_settings, name: "Mantida");
        var firstOfDeleted = await host.Client.OpenSessionAsync(deleted);
        var secondOfDeleted = await host.Client.OpenSessionAsync(deleted);
        var ofKept = await host.Client.OpenSessionAsync(kept);
        var pidOfFirst = await host.Client.BackendPidAsync(firstOfDeleted);
        var pidOfSecond = await host.Client.BackendPidAsync(secondOfDeleted);
        var pidOfKept = await host.Client.BackendPidAsync(ofKept);

        var response = await host.Client.DeleteAsync($"/api/user/connections/{deleted}");

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        await AssertProblemAsync(await host.Client.GetAsync(Url(firstOfDeleted, "/schemas")), HttpStatusCode.NotFound, "DATABASE_SESSION_NOT_FOUND");
        await AssertProblemAsync(await host.Client.GetAsync(Url(secondOfDeleted, "/schemas")), HttpStatusCode.NotFound, "DATABASE_SESSION_NOT_FOUND");
        Assert.That((await host.Client.GetAsync(Url(ofKept, "/schemas"))).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        // Não basta o identificador sumir do registro: a conexão com o banco tem de ter fechado, e só as da conexão excluída.
        await WaitForBackendAsync(pidOfFirst, 0);
        await WaitForBackendAsync(pidOfSecond, 0);
        await WaitForBackendAsync(pidOfKept, 1);
    }

    /// <summary>O processo do PostgreSQL com este número existe (1) ou não existe mais (0) no `pg_stat_activity`.</summary>
    private Task WaitForBackendAsync(long backendPid, long expected)
        => _observer.WaitForCountAsync($"SELECT COUNT(*) FROM pg_stat_activity WHERE pid = {backendPid}", expected, expected == 0 ? "A conexão da sessão continuou aberta no banco." : "O banco não mostrou a conexão da sessão.");

    private object TestBody(Guid? id = null, string? host = null, int? port = null, string? userName = null, string? password = null, bool withPassword = true)
    {
        var body = new Dictionary<string, object?>
        {
            ["name"] = "Teste",
            ["engine"] = (int)_settings.Engine,
            ["host"] = host ?? _settings.Host,
            ["port"] = port ?? _settings.Port,
            ["database"] = _settings.Database,
            ["userName"] = userName ?? _settings.UserName
        };
        if (id is { } connectionID)
            body["id"] = connectionID;
        if (withPassword)
            body["password"] = password ?? _settings.Password;

        return body;
    }

    private static Task<HttpResponseMessage> TestConnectionAsync(ApiHost host, object body)
        => host.Client.PostAsJsonAsync("/api/user/connections/test", body);

    [Test]
    public async Task TestConnection_WithBody_Returns204()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());

        var response = await TestConnectionAsync(host, TestBody());

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(await response.Content.ReadAsStringAsync(), Is.Empty);
    }

    /// <summary>RN-CONN-013: sem a senha no pedido e com o `id`, a API usa a senha que o cofre guarda.</summary>
    [Test]
    public async Task TestConnection_WithIdAndNoPassword_UsesTheStoredPassword_Returns204()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var connectionID = await host.Client.CreateConnectionAsync(_settings);

        var response = await TestConnectionAsync(host, TestBody(id: connectionID, withPassword: false));

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
    }

    [Test]
    public async Task TestConnection_WithIdAndPassword_UsesTheTypedPassword()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var connectionID = await host.Client.CreateConnectionAsync(_settings);

        var response = await TestConnectionAsync(host, TestBody(id: connectionID, password: UserFakers.RandomPassword()));

        await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "DATABASE_CONNECTION_FAILED");
    }

    /// <summary>
    /// RN-CONN-013: a senha gravada só é enviada ao servidor para o qual foi gravada. A conexão está gravada em 127.0.0.1:porta de um
    /// servidor de mentira, e o pedido sem senha aponta para `localhost` na mesma porta: a API recusa sem conectar. O controle é o mesmo
    /// pedido com a senha digitada, que faz o servidor de mentira ver a conexão (e a API responder que o banco não atendeu).
    /// </summary>
    [Test]
    public async Task TestConnection_WithIdAndOtherHost_WithoutPassword_Returns422_AndDoesNotConnect()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        using var decoy = new ConnectionCounter();
        var connectionID = await host.Client.CreateConnectionAsync(_settings with { Port = decoy.Port });

        var response = await TestConnectionAsync(host, TestBody(id: connectionID, host: "localhost", port: decoy.Port, withPassword: false));

        var body = await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "CONNECTION_INVALID");
        Assert.That(body.GetProperty("detail").GetString(), Is.EqualTo("Para testar com outro host ou outra porta, informe a senha da conexão."));
        Assert.That(body.GetProperty("errors").GetProperty("Password")[0].GetString(), Is.EqualTo("Para testar com outro host ou outra porta, informe a senha da conexão."));
        Assert.That(decoy.Accepted, Is.Zero, "A API conectou no servidor do pedido com a senha gravada.");

        var control = await TestConnectionAsync(host, TestBody(id: connectionID, host: "localhost", port: decoy.Port, password: UserFakers.RandomPassword()));
        await AssertProblemAsync(control, HttpStatusCode.UnprocessableEntity, "DATABASE_CONNECTION_FAILED");
        Assert.That(decoy.Accepted, Is.GreaterThan(0), "O servidor de mentira não viu a conexão do controle: a prova acima não vale.");
    }

    [Test]
    public async Task TestConnection_WithIdAndOtherPort_WithoutPassword_Returns422()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        using var decoy = new ConnectionCounter();
        var connectionID = await host.Client.CreateConnectionAsync(_settings);

        var response = await TestConnectionAsync(host, TestBody(id: connectionID, port: decoy.Port, withPassword: false));

        var body = await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "CONNECTION_INVALID");
        Assert.That(body.GetProperty("detail").GetString(), Is.EqualTo("Para testar com outro host ou outra porta, informe a senha da conexão."));
        Assert.That(decoy.Accepted, Is.Zero, "A API conectou no servidor do pedido com a senha gravada.");
    }

    /// <summary>
    /// O host é comparado de forma exata (depois de aparado, como a gravação o faz): só as maiúsculas mudando já é outro servidor. Em
    /// `localhost` não faria diferença para a rede, mas num diretório de socket Unix ou num nome que o atacante resolve faria, e a regra
    /// não pode depender de quem está do outro lado. O servidor de mentira está em `localhost`, e o controle é o mesmo pedido com a senha
    /// digitada, que prova que `LOCALHOST` chega a ele.
    /// </summary>
    [Test]
    public async Task TestConnection_WithIdAndSameHostInOtherCase_WithoutPassword_Returns422_AndDoesNotConnect()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        using var decoy = new ConnectionCounter();
        var connectionID = await host.Client.CreateConnectionAsync(_settings with { Host = "localhost", Port = decoy.Port });

        var response = await TestConnectionAsync(host, TestBody(id: connectionID, host: "LOCALHOST", port: decoy.Port, withPassword: false));

        var body = await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "CONNECTION_INVALID");
        Assert.That(body.GetProperty("detail").GetString(), Is.EqualTo("Para testar com outro host ou outra porta, informe a senha da conexão."));
        Assert.That(decoy.Accepted, Is.Zero, "A API conectou no servidor do pedido com a senha gravada.");

        var control = await TestConnectionAsync(host, TestBody(id: connectionID, host: "LOCALHOST", port: decoy.Port, password: UserFakers.RandomPassword()));
        await AssertProblemAsync(control, HttpStatusCode.UnprocessableEntity, "DATABASE_CONNECTION_FAILED");
        Assert.That(decoy.Accepted, Is.GreaterThan(0), "O servidor de mentira não viu a conexão do controle: a prova acima não vale.");
    }

    /// <summary>Só os espaços das pontas do host são desfeitos, como a gravação os desfaz; a porta é comparada como número.</summary>
    [Test]
    public async Task TestConnection_WithIdAndTheHostWithEdgeSpaces_UsesTheStoredPassword_Returns204()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var connectionID = await host.Client.CreateConnectionAsync(_settings);

        var response = await TestConnectionAsync(host, TestBody(id: connectionID, host: $"  {_settings.Host} ", withPassword: false));

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
    }

    [Test]
    public async Task TestConnection_WithIdAndNoPassword_UnknownConnection_Returns404ConnectionNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());

        var response = await TestConnectionAsync(host, TestBody(id: Guid.CreateVersion7(), withPassword: false));

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
    }

    [Test]
    public async Task TestConnection_Unreachable_Returns422DatabaseConnectionFailed()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        // Uma porta que acabou de ser liberada: nada escuta nela.
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var closedPort = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();

        var response = await TestConnectionAsync(host, TestBody(port: closedPort));

        await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "DATABASE_CONNECTION_FAILED");
    }

    [Test]
    public async Task TestConnection_InvalidBody_Returns422ConnectionInvalid()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());

        // Host em branco; porta fora da faixa; e, sem `id`, sem senha para usar.
        await AssertProblemAsync(await TestConnectionAsync(host, TestBody(host: "  ")), HttpStatusCode.UnprocessableEntity, "CONNECTION_INVALID");
        await AssertProblemAsync(await TestConnectionAsync(host, TestBody(port: 70000)), HttpStatusCode.UnprocessableEntity, "CONNECTION_INVALID");
        await AssertProblemAsync(await TestConnectionAsync(host, TestBody(withPassword: false)), HttpStatusCode.UnprocessableEntity, "CONNECTION_INVALID");
    }
}
