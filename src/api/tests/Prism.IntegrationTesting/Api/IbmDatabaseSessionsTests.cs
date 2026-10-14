using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Extensions;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// As rotas de sessão, catálogo e consulta e o teste de conexão, pela API de verdade, contra o Db2 e o Informix com a carga `loja`. As
/// rotas são as mesmas do PostgreSQL (`DatabaseSessionsTests` confere cada uma em detalhe): aqui um roteiro só percorre todas, para
/// provar que os dois drivers atendem a tela sem mudança nelas. Cada passo escreve o status e o corpo na saída do teste.
/// </summary>
public abstract class IbmDatabaseSessionsTests
{
    private const string UserName = "marina.costa";

    private ConnectionSettings _settings = null!;

    /// <summary>O nome como o banco o guarda quando é escrito sem aspas: maiúsculas no Db2, minúsculas no Informix.</summary>
    protected abstract string Name(string name);

    protected abstract string SyntaxErrorSqlState { get; }

    /// <summary>RN-CAT-002: as regras que o banco guarda para a chave da carga, escrita sem regra nenhuma.</summary>
    protected abstract string DefaultForeignKeyRule { get; }

    /// <summary>Uma consulta que leva cerca de um minuto no banco, para o cancelamento ter o que interromper.</summary>
    private const string SlowQuery = "SELECT COUNT(*) FROM loja.pedido a, loja.pedido b, loja.pedido c WHERE c.numero <= 1600 AND MOD(a.numero + b.numero + c.numero, 7) = 3";

    protected abstract Task<ConnectionSettings> StartDatabaseAsync();

    /// <summary>RN-GRADE-011: um filtro que só este banco recusa, pelas aspas ou pelos comentários dele; nulo onde não há.</summary>
    protected virtual string? InvalidFilterOfThisDatabase => null;

    [OneTimeSetUp]
    public async Task StartAsync()
        => _settings = await StartDatabaseAsync();

    /// <summary>
    /// A API parte com a pasta de drivers em que o gerenciador instalou o driver da IBM (<see cref="IbmDriverSingleton"/>): sem ele,
    /// abrir sessão nestes bancos responderia 422 `DRIVER_NOT_INSTALLED` (RN-DRIVER-006).
    /// </summary>
    protected static async Task<ApiHost> StartHostAsync()
    {
        var drivers = await IbmDriverSingleton.GetDirectoryAsync();

        return await ApiHost.StartAsync(services => services.UseDriverSource(directory: drivers));
    }

    /// <summary>Lê o corpo, registra o passo na saída do teste e confere o status.</summary>
    private static async Task<JsonElement> StepAsync(string step, HttpResponseMessage response, HttpStatusCode expected)
    {
        var text = await response.Content.ReadAsStringAsync();
        await TestContext.Out.WriteLineAsync($"{step} -> {(int)response.StatusCode} {(text.Length > 600 ? text[..600] + "…" : text)}");
        Assert.That(response.StatusCode, Is.EqualTo(expected), $"{step}: {text}");

        return text.Length == 0 ? default : JsonSerializer.Deserialize<JsonElement>(text);
    }

    private static string?[] Names(JsonElement list)
        => [.. list.EnumerateArray().Select(item => item.GetProperty("name").GetString())];

    [Test]
    public async Task Routes_ServeTheDatabase()
    {
        await using var host = await StartHostAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var client = host.Client;
        var connectionID = await client.CreateConnectionAsync(_settings);
        var schema = Uri.EscapeDataString(Name("loja"));
        var table = Uri.EscapeDataString(Name("pedido"));

        // RN-CONN-013: testar a conexão gravada, sem redigitar a senha.
        await StepAsync("POST connections/test", await client.PostAsJsonAsync("/api/user/connections/test", new { id = connectionID, name = "Teste", engine = (int)_settings.Engine, host = _settings.Host, port = _settings.Port, database = _settings.Database, userName = _settings.UserName }), HttpStatusCode.NoContent);

        var opened = await StepAsync("POST database-sessions", await client.OpenSessionRawAsync(connectionID), HttpStatusCode.Created);
        var session = $"{PrismCalls.SessionsPath}/{opened.GetProperty("id").GetGuid()}";

        // RN-ARVORE-006: os bancos do servidor, com o da sessão primeiro.
        var databases = await StepAsync("GET databases", await client.GetAsync($"{session}/databases"), HttpStatusCode.OK);
        var schemas = await StepAsync("GET schemas", await client.GetAsync($"{session}/schemas"), HttpStatusCode.OK);
        var tables = await StepAsync("GET objects?kind=tables", await client.GetAsync($"{session}/schemas/{schema}/objects?kind=tables"), HttpStatusCode.OK);
        var views = await StepAsync("GET objects?kind=views", await client.GetAsync($"{session}/schemas/{schema}/objects?kind=views"), HttpStatusCode.OK);
        var routines = await StepAsync("GET objects?kind=routines", await client.GetAsync($"{session}/schemas/{schema}/objects?kind=routines"), HttpStatusCode.OK);
        var columns = await StepAsync("GET columns", await client.GetAsync($"{session}/schemas/{schema}/tables/{table}/columns"), HttpStatusCode.OK);
        var indexes = await StepAsync("GET indexes", await client.GetAsync($"{session}/schemas/{schema}/tables/{table}/indexes"), HttpStatusCode.OK);
        var foreignKeys = await StepAsync("GET foreign-keys", await client.GetAsync($"{session}/schemas/{schema}/tables/{table}/foreign-keys"), HttpStatusCode.OK);
        // RN-CAT-004, 005, 006, 008 e 010: as rotas novas do catálogo, com o corpo de cada uma na saída (é o exemplo do contrato).
        var referencedBy = await StepAsync("GET referenced-by", await client.GetAsync($"{session}/schemas/{schema}/tables/{Uri.EscapeDataString(Name("cliente"))}/referenced-by"), HttpStatusCode.OK);
        var checks = await StepAsync("GET checks", await client.GetAsync($"{session}/schemas/{schema}/tables/{table}/checks"), HttpStatusCode.OK);
        var definition = await StepAsync("GET views/definition", await client.GetAsync($"{session}/schemas/{schema}/views/{Uri.EscapeDataString(Name("pedido_resumo"))}/definition"), HttpStatusCode.OK);
        var diagram = await StepAsync("GET diagram", await client.GetAsync($"{session}/schemas/{schema}/diagram"), HttpStatusCode.OK);
        var properties = await StepAsync("GET properties", await client.GetAsync($"{session}/properties"), HttpStatusCode.OK);
        var quoted = await StepAsync("GET columns (nome com aspas)", await client.GetAsync($"{session}/schemas/{schema}/tables/{Uri.EscapeDataString("O'Brien \"x\"")}/columns"), HttpStatusCode.OK);

        // RN-SQL-004 a 006: 200 linhas, as 200 seguintes do mesmo cursor, e o total por contagem.
        var first = await StepAsync("POST queries (SELECT de 1.000 linhas)", await client.ExecuteRawAsync(opened.GetProperty("id").GetGuid(), "SELECT numero, valor, criado_em, observacao FROM loja.pedido ORDER BY numero"), HttpStatusCode.OK);
        var second = await StepAsync("POST queries/next", await client.PostAsync($"{session}/queries/next", null), HttpStatusCode.OK);
        var total = await StepAsync("POST queries/count", await client.PostAsync($"{session}/queries/count", null), HttpStatusCode.OK);

        // RN-SQL-016: a primeira página e o "carregar mais" no tamanho pedido, e o tamanho fora da faixa recusado sem ir ao banco.
        var small = await StepAsync("POST queries (pageSize 50)", await client.PostAsJsonAsync($"{session}/queries", new { sql = "SELECT numero FROM loja.pedido ORDER BY numero", pageSize = 50 }), HttpStatusCode.OK);
        var smallNext = await StepAsync("POST queries/next (pageSize 50)", await client.PostAsync($"{session}/queries/next", null), HttpStatusCode.OK);
        var outOfRange = await StepAsync("POST queries (pageSize 1001)", await client.PostAsJsonAsync($"{session}/queries", new { sql = "SELECT numero FROM loja.pedido", pageSize = 1001 }), HttpStatusCode.UnprocessableEntity);

        // RN-GRADE-011: o filtro junto ao comando, por fora da união, e as recusas, com as aspas e os comentários deste banco.
        var merged = await StepAsync("POST queries (filtro junto)", await client.PostAsJsonAsync($"{session}/queries", new { sql = "SELECT numero FROM loja.pedido WHERE numero <= 1010 ORDER BY numero", filter = "numero > 1005 ORDER BY numero DESC" }), HttpStatusCode.OK);
        var wrapped = await StepAsync("POST queries (filtro por fora)", await client.PostAsJsonAsync($"{session}/queries", new { sql = "SELECT numero FROM loja.pedido UNION SELECT numero FROM loja.pedido", filter = "numero < 1004 ORDER BY numero DESC" }), HttpStatusCode.OK);
        var invalidFilter = await StepAsync("POST queries (filtro com ;)", await client.PostAsJsonAsync($"{session}/queries", new { sql = "SELECT numero FROM loja.pedido", filter = "numero = 1; DELETE FROM loja.pedido" }), HttpStatusCode.UnprocessableEntity);
        if (InvalidFilterOfThisDatabase is { } ofThisDatabase)
            Assert.That((await StepAsync("POST queries (filtro com o comentário deste banco aberto)", await client.PostAsJsonAsync($"{session}/queries", new { sql = "SELECT numero FROM loja.pedido", filter = ofThisDatabase }), HttpStatusCode.UnprocessableEntity)).GetProperty("type").GetString(), Is.EqualTo("FILTER_INVALID"));

        // RN-SQL-008, 009, 003 e 001.
        var updated = await StepAsync("POST queries (UPDATE)", await client.ExecuteRawAsync(opened.GetProperty("id").GetGuid(), "UPDATE loja.cliente SET nome = nome WHERE id <= 4"), HttpStatusCode.OK);
        var syntax = await StepAsync("POST queries (erro de sintaxe)", await client.ExecuteRawAsync(opened.GetProperty("id").GetGuid(), "SELEC 1"), HttpStatusCode.UnprocessableEntity);
        var refused = await StepAsync("POST queries (COMMIT)", await client.ExecuteRawAsync(opened.GetProperty("id").GetGuid(), "COMMIT"), HttpStatusCode.UnprocessableEntity);
        var several = await StepAsync("POST queries (dois comandos num envio)", await client.ExecuteRawAsync(opened.GetProperty("id").GetGuid(), "UPDATE loja.cliente SET nome = nome WHERE id = 1; UPDATE loja.cliente SET nome = nome WHERE id = 2"), HttpStatusCode.UnprocessableEntity);

        // RN-SQL-010: o cancelamento se repete até a consulta voltar, porque o primeiro pode chegar antes de ela estar no banco.
        var running = client.ExecuteRawAsync(opened.GetProperty("id").GetGuid(), SlowQuery);
        while (await Task.WhenAny(running, Task.Delay(250)) != running)
            Assert.That((await client.PostAsync($"{session}/queries/cancel", null)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        var canceled = await StepAsync("POST queries (consulta lenta, cancelada por queries/cancel)", await running, HttpStatusCode.UnprocessableEntity);
        var afterwards = await StepAsync("POST queries (depois do cancelamento)", await client.ExecuteRawAsync(opened.GetProperty("id").GetGuid(), "SELECT id FROM loja.cliente ORDER BY id"), HttpStatusCode.OK);
        await StepAsync("DELETE database-sessions", await client.DeleteAsync(session), HttpStatusCode.NoContent);
        await StepAsync("GET schemas (sessão fechada)", await client.GetAsync($"{session}/schemas"), HttpStatusCode.NotFound);

        Assert.That(opened.GetProperty("engine").GetInt32(), Is.EqualTo((int)_settings.Engine));
        Assert.That(opened.GetProperty("database").GetString(), Is.EqualTo(_settings.Database));
        Assert.That(opened.GetProperty("serverVersion").GetString(), Is.Not.Empty);
        Assert.That(databases[0].EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "name", "isCurrent" }));
        Assert.That((databases[0].GetProperty("name").GetString(), databases[0].GetProperty("isCurrent").GetBoolean()), Is.EqualTo((Name(_settings.Database), true)));
        Assert.That(databases.EnumerateArray().Skip(1).Select(item => item.GetProperty("isCurrent").GetBoolean()), Is.All.False);
        Assert.That(Names(schemas), Has.Member(Name("loja")));
        var loja = schemas.EnumerateArray().Single(item => item.GetProperty("name").GetString() == Name("loja"));
        Assert.That((loja.GetProperty("tables").GetInt32(), loja.GetProperty("views").GetInt32(), loja.GetProperty("routines").GetInt32()), Is.EqualTo((3, 1, 1)));
        Assert.That(tables.EnumerateArray().Select(item => item.GetProperty("comment").ValueKind), Is.All.EqualTo(JsonValueKind.Null));
        Assert.That(columns.EnumerateArray().Select(item => (item.GetProperty("defaultValue").ValueKind, item.GetProperty("generated").ValueKind)), Is.All.EqualTo((JsonValueKind.Null, JsonValueKind.Null)));
        Assert.That(indexes.EnumerateArray().Select(item => item.GetProperty("method").ValueKind), Is.All.EqualTo(JsonValueKind.String));
        Assert.That(foreignKeys[0].GetProperty("onDelete").GetString(), Is.EqualTo(DefaultForeignKeyRule));
        Assert.That(foreignKeys[0].GetProperty("onUpdate").GetString(), Is.EqualTo(DefaultForeignKeyRule));
        Assert.That(schemas.EnumerateArray().Last().GetProperty("isSystem").GetBoolean(), Is.True);
        Assert.That(Names(tables), Is.SupersetOf(new[] { Name("cliente"), Name("pedido"), "O'Brien \"x\"" }));
        Assert.That(Names(views), Is.EqualTo(new[] { Name("pedido_resumo") }));
        Assert.That(Names(routines), Is.EqualTo(new[] { Name("dobro") }));
        Assert.That(Names(columns), Is.EqualTo(new[] { Name("id"), Name("numero"), Name("cliente_id"), Name("valor"), Name("criado_em"), Name("observacao") }));
        Assert.That(columns[0].GetProperty("isPrimaryKey").GetBoolean(), Is.True);
        Assert.That(Names(indexes), Is.SupersetOf(new[] { Name("uk_pedido_numero"), Name("ix_pedido_cliente_data") }));
        Assert.That(foreignKeys[0].GetProperty("name").GetString(), Is.EqualTo(Name("fk_pedido_cliente")));
        Assert.That(foreignKeys[0].GetProperty("referencedTable").GetString(), Is.EqualTo(Name("cliente")));
        Assert.That(Names(quoted), Is.EqualTo(new[] { Name("id"), "nome completo" }));
        Assert.That(referencedBy.EnumerateArray().Select(item => (item.GetProperty("name").GetString(), item.GetProperty("referencingSchema").GetString(), item.GetProperty("referencingTable").GetString())), Is.EqualTo(new[] { (Name("fk_pedido_cliente"), Name("loja"), Name("pedido")) }));
        Assert.That(checks.GetArrayLength(), Is.Zero);
        Assert.That(definition.GetProperty("definition").GetString(), Does.StartWith("create view ").IgnoreCase.And.Contain("pedido_resumo").IgnoreCase);
        Assert.That(Names(diagram.GetProperty("tables")), Is.SupersetOf(new[] { Name("cliente"), Name("pedido"), "O'Brien \"x\"" }));
        Assert.That(Names(diagram.GetProperty("foreignKeys")), Is.EqualTo(new[] { Name("fk_pedido_cliente") }));
        Assert.That(properties.GetArrayLength(), Is.GreaterThan(1));
        Assert.That(first.GetProperty("rows").GetArrayLength(), Is.EqualTo(200));
        Assert.That(first.GetProperty("hasMore").GetBoolean(), Is.True);
        Assert.That(first.GetProperty("rows")[0].EnumerateArray().Select(cell => cell.GetString()), Is.EqualTo(new[] { "1001", "1.50", "2026-01-01 00:01:00.000000", "Pedido 1" }));
        Assert.That(second.GetProperty("rows").GetArrayLength(), Is.EqualTo(200));
        Assert.That(second.GetProperty("rows")[0][0].GetString(), Is.EqualTo("1201"));
        Assert.That(total.GetProperty("total").GetInt64(), Is.EqualTo(1000));
        Assert.That(small.GetProperty("rows").GetArrayLength(), Is.EqualTo(50));
        Assert.That(smallNext.GetProperty("rows").GetArrayLength(), Is.EqualTo(50));
        Assert.That(smallNext.GetProperty("rows")[0][0].GetString(), Is.EqualTo("1051"));
        Assert.That(outOfRange.GetProperty("type").GetString(), Is.EqualTo("QUERY_INVALID"));
        Assert.That(merged.GetProperty("rows").EnumerateArray().Select(row => row[0].GetString()), Is.EqualTo(new[] { "1010", "1009", "1008", "1007", "1006" }));
        Assert.That(merged.GetProperty("filterApplied").GetString(), Is.EqualTo("merged"));
        Assert.That(wrapped.GetProperty("rows").EnumerateArray().Select(row => row[0].GetString()), Is.EqualTo(new[] { "1003", "1002", "1001" }));
        Assert.That((wrapped.GetProperty("filterApplied").GetString(), wrapped.GetProperty("editable").GetProperty("reason").GetString()), Is.EqualTo(("wrapped", "união de consultas")));
        Assert.That(invalidFilter.GetProperty("errorCodes").GetProperty("Filter")[0].GetString(), Is.EqualTo("FILTER_INVALID"));
        Assert.That(updated.GetProperty("rowsAffected").GetInt64(), Is.EqualTo(4));
        Assert.That(syntax.GetProperty("type").GetString(), Is.EqualTo("SQL_EXECUTION_FAILED"));
        Assert.That(syntax.GetProperty("sqlState").GetString(), Is.EqualTo(SyntaxErrorSqlState));
        Assert.That(refused.GetProperty("type").GetString(), Is.EqualTo("TRANSACTION_CONTROL_NOT_SUPPORTED"));
        Assert.That(several.GetProperty("type").GetString(), Is.EqualTo("MULTIPLE_STATEMENTS_NOT_SUPPORTED"));
        Assert.That(canceled.GetProperty("type").GetString(), Is.EqualTo("SQL_EXECUTION_FAILED"));
        Assert.That(afterwards.GetProperty("rows").GetArrayLength(), Is.EqualTo(10));
    }

    /// <summary>RN-SESSAO-003: a falha ao abrir responde 422 com a mensagem do banco no detalhe.</summary>
    [Test]
    public async Task Open_WrongDatabasePassword_Returns422DatabaseConnectionFailed_WithTheDatabaseMessage()
    {
        await using var host = await StartHostAsync();
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var connectionID = await host.Client.CreateConnectionAsync(_settings, password: $"errada-{Guid.NewGuid():N}");

        var body = await StepAsync("POST database-sessions (senha errada)", await host.Client.OpenSessionRawAsync(connectionID), HttpStatusCode.UnprocessableEntity);

        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo("DATABASE_CONNECTION_FAILED"));
        Assert.That(body.GetProperty("detail").GetString(), Does.Contain("SQL30082N"));
    }
}

[TestFixture]
[Category("Api")]
[Category("Db2")]
public sealed class Db2DatabaseSessionsTests : IbmDatabaseSessionsTests
{
    protected override string SyntaxErrorSqlState => "42601";

    protected override string DefaultForeignKeyRule => "noAction";

    protected override string Name(string name)
        => name.ToUpperInvariant();

    protected override Task<ConnectionSettings> StartDatabaseAsync()
        => Db2Singleton.GetSettingsAsync();
}

[TestFixture]
[Category("Api")]
[Category("Informix")]
public sealed class InformixDatabaseSessionsTests : IbmDatabaseSessionsTests
{
    protected override string SyntaxErrorSqlState => "42000";

    protected override string DefaultForeignKeyRule => "restrict";

    /// <summary>A chave abre comentário só no Informix: no PostgreSQL o mesmo filtro chega ao banco.</summary>
    protected override string? InvalidFilterOfThisDatabase => "numero = 1 { o resto";

    protected override string Name(string name)
        => name.ToLowerInvariant();

    protected override Task<ConnectionSettings> StartDatabaseAsync()
        => InformixSingleton.GetSettingsAsync();

    /// <summary>
    /// RN-ARVORE-006: a lista traz os bancos do servidor (`sysmaster:sysdatabases`), e outro deles abre com as credenciais da conexão e o
    /// nome dele no lugar do banco dela: a sessão nova responde pelo banco sem log da carga, e a lista dela o põe primeiro.
    /// </summary>
    [Test]
    public async Task Open_AnotherDatabaseOfTheServer_Returns201AndServesThatDatabase()
    {
        var settings = await InformixSingleton.GetSettingsAsync();
        await using var host = await StartHostAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var connectionID = await host.Client.CreateConnectionAsync(settings);
        var main = (await (await host.Client.OpenSessionRawAsync(connectionID)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var listed = await (await host.Client.GetAsync($"{PrismCalls.SessionsPath}/{main}/databases")).Content.ReadFromJsonAsync<JsonElement>();
        var openedResponse = await host.Client.PostAsJsonAsync(PrismCalls.SessionsPath, new { connectionID, database = InformixSingleton.UnloggedDatabase });
        var opened = await openedResponse.Content.ReadFromJsonAsync<JsonElement>();
        await TestContext.Out.WriteLineAsync($"GET databases -> {listed}\nPOST database-sessions (database {InformixSingleton.UnloggedDatabase}) -> {(int)openedResponse.StatusCode} {opened}");
        Assert.That(openedResponse.StatusCode, Is.EqualTo(HttpStatusCode.Created), opened.ToString());
        var other = opened.GetProperty("id").GetGuid();
        var fromOther = await (await host.Client.GetAsync($"{PrismCalls.SessionsPath}/{other}/databases")).Content.ReadFromJsonAsync<JsonElement>();
        var properties = await (await host.Client.GetAsync($"{PrismCalls.SessionsPath}/{other}/properties")).Content.ReadFromJsonAsync<JsonElement>();

        var names = listed.EnumerateArray().Select(item => item.GetProperty("name").GetString()).ToList();
        Assert.That(names[0], Is.EqualTo(settings.Database));
        Assert.That(names, Is.SupersetOf(new[] { InformixSingleton.UnloggedDatabase, InformixSingleton.Utf8Database, "sysmaster" }));
        Assert.That(names.Skip(1), Is.Ordered.Using((IComparer<string?>)StringComparer.Ordinal));
        Assert.That(names, Is.All.Not.EndWith(" "));
        Assert.That(opened.GetProperty("database").GetString(), Is.EqualTo(InformixSingleton.UnloggedDatabase));
        Assert.That((fromOther[0].GetProperty("name").GetString(), fromOther[0].GetProperty("isCurrent").GetBoolean()), Is.EqualTo((InformixSingleton.UnloggedDatabase, true)));
        Assert.That(fromOther.EnumerateArray().Count(item => item.GetProperty("isCurrent").GetBoolean()), Is.EqualTo(1));
        Assert.That(properties[0].GetProperty("value").GetString(), Is.EqualTo("noLogging"));
    }
}
