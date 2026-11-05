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
/// RN-VAR-034 e 035: as três rotas das variáveis pela API de verdade, contra os três bancos. A consulta da variável: a forma da resposta, os limites (linhas, colunas
/// e, no PostgreSQL, bytes), as recusas antes do banco, a conexão somente leitura, e a sessão depois dela (o cursor fechado, o resultado atual e a contagem como
/// estavam). Os valores: a página com o `hasMore`, a busca com `%` e `_`, a descrição, o total e as recusas (a coluna binária, a que não existe, a tabela que não
/// existe). A conferência: a comparação pelo valor no tipo da coluna. Cada banco informa o seu SQL nas pontas que mudam; a tabela é do fixture, e ele a apaga.
/// </summary>
public abstract class VariableRoutesTests
{
    private const string UserName = "lucas.prado";

    private readonly string _table = $"vr{Guid.NewGuid():N}"[..14];

    private ApiHost _host = null!;
    private ConnectionSettings _settings = null!;

    protected HttpClient Client { get; private set; } = null!;

    protected string Table => _table;

    protected Guid ConnectionID { get; private set; }

    protected Guid SessionID { get; private set; }

    /// <summary>O nome como o banco o guarda (escrito sem aspas: o do Db2 vira maiúsculas).</summary>
    protected abstract string Folded(string name);

    protected abstract Task<ConnectionSettings> StartDatabaseAsync();

    protected abstract Task<ApiHost> StartHostAsync();

    /// <summary>O marcador de número `n` (a partir de 1): `$n` no PostgreSQL, `?` nos outros.</summary>
    protected abstract string M(int n);

    /// <summary>A tabela do teste: `id`, `status` (texto), `nome` (a descrição), `ch` (`CHAR(5)`), `qt` (decimal) e `foto` (binária).</summary>
    protected abstract string CreateTableSql(string table);

    /// <summary>`FROM` de uma linha só, para o `SELECT` que não lê tabela; vazio no PostgreSQL.</summary>
    protected abstract string FromDual { get; }

    /// <summary>Uma leitura de mais de 50 linhas, para a página deixar o cursor aberto.</summary>
    protected abstract string ManyRowsSql { get; }

    /// <summary>O esquema em que as tabelas do teste ficam, como o banco o guarda.</summary>
    protected abstract string DefaultSchema { get; }

    protected string Session => $"{PrismCalls.SessionsPath}/{SessionID}";

    private string ValuesPath => $"{Session}/schemas/{Uri.EscapeDataString(DefaultSchema)}/tables/{Uri.EscapeDataString(Folded(Table))}/values";

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        _settings = await StartDatabaseAsync();
        _host = await StartHostAsync();
        Client = _host.Client;
        await _host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        ConnectionID = await Client.CreateConnectionAsync(_settings);
        SessionID = await Client.OpenSessionAsync(ConnectionID);

        await Client.ExecuteAsync(SessionID, CreateTableSql(Table));
        foreach (var (id, status, nome) in new[] { (1, "aberta", "Pedido aberto"), (2, "paga", "Pedido pago"), (3, "50%_off", "Desconto"), (4, "a_b", "Sublinhado"), (5, "aberta", "Outro aberto") })
            await Client.ExecuteAsync(SessionID, $"INSERT INTO {Table} (id, status, nome, ch, qt) VALUES ({id}, '{status}', '{nome}', 'ab', 12.50)");

        await Client.ExecuteAsync(SessionID, $"INSERT INTO {Table} (id, nome) VALUES (6, 'Sem status')");
    }

    [OneTimeTearDown]
    public async Task StopAsync()
    {
        await Client.ExecuteRawAsync(SessionID, $"DROP TABLE {Table}");
        await _host.DisposeAsync();
    }

    private static object P(string type, string? value)
        => new { type, value };

    protected async Task<HttpResponseMessage> VariableAsync(object body, string? session = null)
        => await Client.PostAsJsonAsync($"{session ?? Session}/queries/variable", body);

    protected static async Task<JsonElement> OkAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());

        return body;
    }

    protected static async Task<JsonElement> ProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That((response.StatusCode, body.GetProperty("type").GetString()), Is.EqualTo((status, type)), body.ToString());

        return body;
    }

    /// <summary>O campo de `errors` e de `errorCodes` da recusa no campo, com o código dado.</summary>
    private static void AssertField(JsonElement problem, string field, string code)
    {
        Assert.That(problem.GetProperty("errors").GetProperty(field).GetArrayLength(), Is.EqualTo(1), problem.ToString());
        Assert.That(problem.GetProperty("errorCodes").GetProperty(field)[0].GetString(), Is.EqualTo(code));
    }

    protected static string?[][] Rows(JsonElement body)
        => [.. body.GetProperty("rows").EnumerateArray().Select(row => row.EnumerateArray().Select(cell => cell.ValueKind == JsonValueKind.Null ? null : cell.GetString()).ToArray())];

    private async Task<JsonElement> ValuesAsync(object body)
        => await OkAsync(await Client.PostAsJsonAsync(ValuesPath, body));

    private static IEnumerable<string?> ValuesOf(JsonElement page)
        => page.GetProperty("values").EnumerateArray().Select(value => value.GetProperty("value").GetString());

    [Test]
    public async Task VariableQuery_AnswersColumnsAndWholeRows()
    {
        var body = await OkAsync(await VariableAsync(new { sql = $"SELECT id, status FROM {Table} WHERE id <= {M(1)} ORDER BY id", @params = new[] { P("number", "2") } }));

        var columns = body.GetProperty("columns").EnumerateArray().Select(column => (column.GetProperty("name").GetString(), column.GetProperty("kind").GetString())).ToList();
        Assert.That(columns, Is.EqualTo(new[] { (Folded("id"), "number"), (Folded("status"), "text") }));
        Assert.That(body.GetProperty("columns")[0].GetProperty("type").GetString(), Is.Not.Empty);
        Assert.That(Rows(body), Is.EqualTo(new[] { new[] { "1", "aberta" }, new[] { "2", "paga" } }));
        Assert.That(body.GetProperty("elapsedMs").GetInt64(), Is.GreaterThanOrEqualTo(0));
    }

    [Test]
    public async Task VariableQuery_StopsAtTheLimits()
    {
        var rows = await ProblemAsync(await VariableAsync(new { sql = $"SELECT id FROM {Table}", maxRows = 2 }), HttpStatusCode.UnprocessableEntity, "VARIABLE_QUERY_TOO_LARGE");
        var exact = await OkAsync(await VariableAsync(new { sql = $"SELECT id FROM {Table}", maxRows = 6 }));
        var wide = string.Join(", ", Enumerable.Range(1, 101).Select(n => $"{n} AS c{n}"));
        var columns = await ProblemAsync(await VariableAsync(new { sql = $"SELECT {wide}{FromDual}" }), HttpStatusCode.UnprocessableEntity, "VARIABLE_QUERY_TOO_LARGE");

        Assert.That((rows.GetProperty("reason").GetString(), rows.GetProperty("limit").GetInt64()), Is.EqualTo(("rows", 2L)));
        Assert.That(Rows(exact), Has.Length.EqualTo(6));
        Assert.That((columns.GetProperty("reason").GetString(), columns.GetProperty("limit").GetInt64()), Is.EqualTo(("columns", 100L)));
        Assert.That(columns.GetProperty("detail").GetString(), Is.EqualTo("A consulta de uma variável tem até 100 colunas, e esta tem 101."));
    }

    [Test]
    public async Task VariableQuery_RefusesBeforeTheDatabase()
    {
        var delete = await ProblemAsync(await VariableAsync(new { sql = $"DELETE FROM {Table}" }), HttpStatusCode.UnprocessableEntity, "VARIABLE_QUERY_NOT_READ");
        await ProblemAsync(await VariableAsync(new { sql = $"SELECT 1{FromDual}; SELECT 2{FromDual}" }), HttpStatusCode.UnprocessableEntity, "MULTIPLE_STATEMENTS_NOT_SUPPORTED");
        await ProblemAsync(await VariableAsync(new { sql = $"SELECT id FROM {Table} WHERE id = {M(1)}", @params = new[] { P("number", "1"), P("number", "2") } }), HttpStatusCode.UnprocessableEntity, "QUERY_PARAMETERS_MISMATCH");
        var maxRows = await ProblemAsync(await VariableAsync(new { sql = "SELECT 1", maxRows = 0 }), HttpStatusCode.UnprocessableEntity, "QUERY_INVALID");
        var empty = await ProblemAsync(await VariableAsync(new { sql = " " }), HttpStatusCode.UnprocessableEntity, "QUERY_INVALID");
        var count = Rows(await OkAsync(await VariableAsync(new { sql = $"SELECT COUNT(*) FROM {Table}" })));

        Assert.That(delete.GetProperty("detail").GetString(), Is.EqualTo("A consulta de uma variável tem de ser uma leitura: um DELETE não é."));
        Assert.That(delete.GetProperty("reason").GetString(), Is.EqualTo("um DELETE não é leitura"));
        AssertField(maxRows, "maxRows", "QUERY_INVALID");
        AssertField(empty, "sql", "QUERY_INVALID");
        Assert.That(count[0][0], Is.EqualTo("6"));
    }

    /// <summary>RN-VAR-034: a consulta da variável fecha o cursor da página, e o resultado atual continua o atual (as células, a contagem do último comando).</summary>
    [Test]
    public async Task VariableQuery_ClosesTheCursorAndKeepsTheCurrentResult()
    {
        var page = await OkAsync(await Client.PostAsJsonAsync($"{Session}/queries", new { sql = ManyRowsSql, pageSize = 50 }));
        var resultID = page.GetProperty("resultID").GetGuid();

        await OkAsync(await VariableAsync(new { sql = $"SELECT id FROM {Table}" }));
        var next = await Client.PostAsync($"{Session}/queries/next", null);
        var cells = await Client.PostAsJsonAsync($"{Session}/results/{resultID}/cells", new { cells = new[] { new { row = 0, column = 0 } } });
        var count = await OkAsync(await Client.PostAsync($"{Session}/queries/count", null));

        Assert.That(page.GetProperty("hasMore").GetBoolean(), Is.True);
        await ProblemAsync(next, HttpStatusCode.Conflict, "NO_OPEN_CURSOR");
        Assert.That(cells.StatusCode, Is.EqualTo(HttpStatusCode.OK), await cells.Content.ReadAsStringAsync());
        Assert.That(count.GetProperty("total").GetInt64(), Is.GreaterThan(50), "a contagem é a do último comando da aba, e não a da variável");
    }

    /// <summary>RN-VAR-034 e 035: a conexão somente leitura roda a consulta da variável (uma leitura) e os valores; o que não é leitura é a recusa da variável.</summary>
    [Test]
    public async Task ReadOnlyConnection_RunsTheVariableQueryAndTheValues()
    {
        var created = await Client.PostAsJsonAsync("/api/user/connections", new { folderID = (Guid?)null, name = "Somente leitura", engine = (int)_settings.Engine, host = _settings.Host, port = _settings.Port, database = _settings.Database, userName = _settings.UserName, password = _settings.Password, readOnly = true });
        var connectionID = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var session = $"{PrismCalls.SessionsPath}/{await Client.OpenSessionAsync(connectionID)}";

        var read = await OkAsync(await VariableAsync(new { sql = $"SELECT status FROM {Table} WHERE id = 2" }, session));
        await ProblemAsync(await VariableAsync(new { sql = $"DELETE FROM {Table}" }, session), HttpStatusCode.UnprocessableEntity, "VARIABLE_QUERY_NOT_READ");
        var values = await OkAsync(await Client.PostAsJsonAsync($"{session}/schemas/{Uri.EscapeDataString(DefaultSchema)}/tables/{Uri.EscapeDataString(Folded(Table))}/values", new { column = Folded("status") }));
        var check = await OkAsync(await Client.PostAsJsonAsync($"{session}/schemas/{Uri.EscapeDataString(DefaultSchema)}/tables/{Uri.EscapeDataString(Folded(Table))}/values/check", new { column = Folded("status"), values = new[] { P("text", "paga") } }));

        Assert.That(Rows(read), Is.EqualTo(new[] { new[] { "paga" } }));
        Assert.That(ValuesOf(values), Has.Member("paga"));
        Assert.That(check.GetProperty("missing").GetArrayLength(), Is.Zero);
    }

    [Test]
    public async Task Values_PagesInOrder_WithTheTotal()
    {
        var first = await ValuesAsync(new { column = Folded("status"), limit = 2, total = true });
        var second = await ValuesAsync(new { column = Folded("status"), offset = 2, limit = 2 });
        var countOnly = await ValuesAsync(new { column = Folded("status"), limit = 0, total = true });

        Assert.That(first.GetProperty("kind").GetString(), Is.EqualTo("text"));
        Assert.That(ValuesOf(first), Is.EqualTo(new[] { "50%_off", "a_b" }));
        Assert.That((first.GetProperty("hasMore").GetBoolean(), first.GetProperty("total").GetInt64()), Is.EqualTo((true, 4L)));
        Assert.That(ValuesOf(second), Is.EqualTo(new[] { "aberta", "paga" }));
        Assert.That((second.GetProperty("hasMore").GetBoolean(), second.GetProperty("total").ValueKind), Is.EqualTo((false, JsonValueKind.Null)));
        Assert.That((countOnly.GetProperty("values").GetArrayLength(), countOnly.GetProperty("total").GetInt64()), Is.EqualTo((0, 4L)));
    }

    /// <summary>RN-VAR-035: o `%` e o `_` da busca são o texto, e não o curinga; sem diferenciar maiúsculas.</summary>
    [Test]
    public async Task Values_SearchEscapesTheWildcards()
    {
        var percent = await ValuesAsync(new { column = Folded("status"), search = "%" });
        var underscore = await ValuesAsync(new { column = Folded("status"), search = "_", total = true });
        var upper = await ValuesAsync(new { column = Folded("status"), search = "ABER" });

        Assert.That(ValuesOf(percent), Is.EqualTo(new[] { "50%_off" }));
        Assert.That(ValuesOf(underscore), Is.EqualTo(new[] { "50%_off", "a_b" }));
        Assert.That(underscore.GetProperty("total").GetInt64(), Is.EqualTo(2));
        Assert.That(ValuesOf(upper), Is.EqualTo(new[] { "aberta" }));
    }

    [Test]
    public async Task Values_WithTheDescription_SearchesBothColumns()
    {
        var page = await ValuesAsync(new { column = Folded("id"), description = Folded("nome"), limit = 2 });
        var searched = await ValuesAsync(new { column = Folded("id"), description = Folded("nome"), search = "PAGO" });

        Assert.That(page.GetProperty("kind").GetString(), Is.EqualTo("number"));
        var values = page.GetProperty("values").EnumerateArray().Select(value => (value.GetProperty("value").GetString(), value.GetProperty("description").GetString(), value.GetProperty("truncated").GetBoolean())).ToList();
        Assert.That(values, Is.EqualTo(new[] { ("1", "Pedido aberto", false), ("2", "Pedido pago", false) }));
        Assert.That(page.GetProperty("hasMore").GetBoolean(), Is.True);
        Assert.That(ValuesOf(searched), Is.EqualTo(new[] { "2" }));
    }

    [Test]
    public async Task Values_RefusesWhatTheCatalogDoesNotAllow()
    {
        var binary = await ProblemAsync(await Client.PostAsJsonAsync(ValuesPath, new { column = Folded("foto") }), HttpStatusCode.UnprocessableEntity, "VALUES_INVALID");
        var unknown = await ProblemAsync(await Client.PostAsJsonAsync(ValuesPath, new { column = Folded("nada") }), HttpStatusCode.UnprocessableEntity, "VALUES_INVALID");
        var same = await ProblemAsync(await Client.PostAsJsonAsync(ValuesPath, new { column = Folded("id"), description = Folded("id") }), HttpStatusCode.UnprocessableEntity, "VALUES_INVALID");
        var limit = await ProblemAsync(await Client.PostAsJsonAsync(ValuesPath, new { column = Folded("id"), limit = 201 }), HttpStatusCode.UnprocessableEntity, "VALUES_INVALID");
        var missingTable = $"{Session}/schemas/{Uri.EscapeDataString(DefaultSchema)}/tables/{Uri.EscapeDataString(Folded(Table + "x"))}/values";
        await ProblemAsync(await Client.PostAsJsonAsync(missingTable, new { column = Folded("id") }), HttpStatusCode.NotFound, "VALUES_TABLE_NOT_FOUND");

        AssertField(binary, "column", "VALUES_INVALID");
        AssertField(unknown, "column", "VALUES_INVALID");
        AssertField(same, "description", "VALUES_INVALID");
        AssertField(limit, "limit", "VALUES_INVALID");
    }

    /// <summary>RN-VAR-035: a conferência pelo valor no tipo da coluna: `1` e `1.0`, o `CHAR` sem os espaços do fim, `12.5` e `12.50`; o que não converte falta.</summary>
    [Test]
    public async Task Check_ComparesByTheValueOfTheColumnType()
    {
        async Task<int[]> MissingAsync(string column, params object[] values)
        {
            var body = await OkAsync(await Client.PostAsJsonAsync($"{ValuesPath}/check", new { column = Folded(column), values }));

            return [.. body.GetProperty("missing").EnumerateArray().Select(index => index.GetInt32())];
        }

        var ids = await MissingAsync("id", P("number", "1"), P("number", "1.0"), P("number", "99"), P("text", "um"), P("number", "1.5"));
        var statuses = await MissingAsync("status", P("text", "aberta"), P("text", "ABERTA"), P("text", "nada"), P("text", null));
        var fixedText = await MissingAsync("ch", P("text", "ab"), P("text", "ab "), P("text", "abc"));
        var decimals = await MissingAsync("qt", P("number", "12.5"), P("number", "12.500"), P("number", "12.51"));
        var refused = await ProblemAsync(await Client.PostAsJsonAsync($"{ValuesPath}/check", new { column = Folded("id"), values = Array.Empty<object>() }), HttpStatusCode.UnprocessableEntity, "QUERY_INVALID");

        Assert.That(ids, Is.EqualTo(new[] { 2, 3, 4 }));
        Assert.That(statuses, Is.EqualTo(new[] { 1, 2, 3 }));
        Assert.That(fixedText, Is.EqualTo(new[] { 2 }));
        Assert.That(decimals, Is.EqualTo(new[] { 2 }));
        AssertField(refused, "values", "QUERY_INVALID");
    }
}

[TestFixture]
[Category("Api")]
public sealed class PostgresVariableRoutesTests : VariableRoutesTests
{
    protected override string Folded(string name) => name;

    protected override Task<ConnectionSettings> StartDatabaseAsync() => PostgresSingleton.GetSettingsAsync();

    protected override Task<ApiHost> StartHostAsync() => ApiHost.StartAsync();

    protected override string M(int n) => $"${n}";

    protected override string CreateTableSql(string table)
        => $"CREATE TABLE {table} (id integer PRIMARY KEY, status varchar(40), nome varchar(40), ch character(5), qt numeric(10,2), foto bytea)";

    protected override string FromDual => string.Empty;

    protected override string ManyRowsSql => "SELECT g FROM generate_series(1, 120) g";

    protected override string DefaultSchema => "public";

    /// <summary>RN-VAR-034: mais de 16 MiB de valores param a leitura (`reason` `bytes`).</summary>
    [Test]
    public async Task VariableQuery_StopsAtSixteenMebibytes()
    {
        var problem = await ProblemAsync(await VariableAsync(new { sql = "SELECT repeat('x', 1048576) FROM generate_series(1, 17)" }), HttpStatusCode.UnprocessableEntity, "VARIABLE_QUERY_TOO_LARGE");

        Assert.That((problem.GetProperty("reason").GetString(), problem.GetProperty("limit").GetInt64()), Is.EqualTo(("bytes", 16L * 1024 * 1024)));
    }

    /// <summary>RN-VAR-034: em Auto-commit a consulta roda numa transação só de leitura, e o que grava por dentro de uma função é a recusa do banco.</summary>
    [Test]
    public async Task VariableQuery_RunsInAReadOnlyTransaction()
    {
        await Client.ExecuteAsync(SessionID, $"CREATE FUNCTION {Table}_grava() RETURNS integer LANGUAGE sql AS $$ INSERT INTO {Table} (id) VALUES (950) RETURNING id $$");
        try
        {
            var readOnly = Rows(await OkAsync(await VariableAsync(new { sql = "SELECT current_setting('transaction_read_only')" })));
            var refused = await ProblemAsync(await VariableAsync(new { sql = $"SELECT {Table}_grava()" }), HttpStatusCode.UnprocessableEntity, "SQL_EXECUTION_FAILED");
            var written = Rows(await OkAsync(await VariableAsync(new { sql = $"SELECT COUNT(*) FROM {Table} WHERE id = 950" })));

            Assert.That(readOnly[0][0], Is.EqualTo("on"));
            Assert.That(refused.GetProperty("sqlState").GetString(), Is.EqualTo("25006"));
            Assert.That(written[0][0], Is.EqualTo("0"));
        }
        finally
        {
            await Client.ExecuteAsync(SessionID, $"DROP FUNCTION {Table}_grava()");
        }
    }

    /// <summary>RN-VAR-034: no Commit manual a consulta roda dentro da transação da aba: vê o que ela gravou e não confirmou, e não a encerra.</summary>
    [Test]
    public async Task VariableQuery_InManualCommit_RunsInTheTabTransaction()
    {
        var opened = await Client.PostAsJsonAsync(PrismCalls.SessionsPath, new { connectionID = ConnectionID, transactionMode = "manual" });
        var manual = (await opened.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var session = $"{PrismCalls.SessionsPath}/{manual}";
        await Client.ExecuteAsync(manual, $"INSERT INTO {Table} (id, status) VALUES (960, 'pendente')");

        var seen = Rows(await OkAsync(await VariableAsync(new { sql = $"SELECT status, current_setting('transaction_read_only') FROM {Table} WHERE id = 960" }, session)));
        var still = await OkAsync(await Client.PostAsync($"{session}/transaction/rollback", null));
        var after = Rows(await OkAsync(await VariableAsync(new { sql = $"SELECT COUNT(*) FROM {Table} WHERE id = 960" }, session)));

        Assert.That(seen, Is.EqualTo(new[] { new[] { "pendente", "off" } }));
        Assert.That(still.ValueKind, Is.EqualTo(JsonValueKind.Object));
        Assert.That(after[0][0], Is.EqualTo("0"));
    }
}

[TestFixture]
[Category("Api")]
[Category("Db2")]
public sealed class Db2VariableRoutesTests : VariableRoutesTests
{
    protected override string Folded(string name) => name.ToUpperInvariant();

    protected override Task<ConnectionSettings> StartDatabaseAsync() => Db2Singleton.GetSettingsAsync();

    protected override async Task<ApiHost> StartHostAsync()
        => await ApiHost.StartAsync(services => services.UseDriverSource(directory: IbmDriverSingleton.GetDirectoryAsync().GetAwaiter().GetResult()));

    protected override string M(int n) => "?";

    protected override string CreateTableSql(string table)
        => $"CREATE TABLE {table} (id INTEGER NOT NULL PRIMARY KEY, status VARCHAR(40), nome VARCHAR(40), ch CHAR(5), qt DECIMAL(10,2), foto BLOB(1M))";

    protected override string FromDual => " FROM sysibm.sysdummy1";

    protected override string ManyRowsSql => "SELECT colname FROM syscat.columns";

    protected override string DefaultSchema => "DB2INST1";
}

/// <summary>O Informix, no que o roteiro muda; o banco (com log ou sem) é de quem herda.</summary>
public abstract class InformixVariableRoutesBase : VariableRoutesTests
{
    protected override string Folded(string name) => name.ToLowerInvariant();

    protected override async Task<ApiHost> StartHostAsync()
        => await ApiHost.StartAsync(services => services.UseDriverSource(directory: IbmDriverSingleton.GetDirectoryAsync().GetAwaiter().GetResult()));

    protected override string M(int n) => "?";

    protected override string CreateTableSql(string table)
        => $"CREATE TABLE {table} (id INTEGER NOT NULL PRIMARY KEY, status VARCHAR(40), nome VARCHAR(40), ch CHAR(5), qt DECIMAL(10,2), foto BYTE)";

    protected override string FromDual => " FROM systables WHERE tabid = 1";

    protected override string ManyRowsSql => "SELECT colname FROM syscolumns";

    protected override string DefaultSchema => "informix";
}

[TestFixture]
[Category("Api")]
[Category("Informix")]
public sealed class InformixVariableRoutesTests : InformixVariableRoutesBase
{
    protected override Task<ConnectionSettings> StartDatabaseAsync() => InformixSingleton.GetSettingsAsync();
}

/// <summary>O mesmo roteiro no `prism_sem_log`: sem transação, as leituras das variáveis dão o mesmo resultado que no banco com log.</summary>
[TestFixture]
[Category("Api")]
[Category("Informix")]
public sealed class InformixUnloggedVariableRoutesTests : InformixVariableRoutesBase
{
    protected override Task<ConnectionSettings> StartDatabaseAsync() => InformixSingleton.GetUnloggedSettingsAsync();
}
