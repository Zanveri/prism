using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Extensions;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// RN-VAR-032 e 033: os `params` da rota das consultas e de tudo o que executa o comando de novo, pela API de verdade, contra os três bancos. Cada tipo de parâmetro
/// da lista da especificação (o inteiro, o `bigint` maior que 2^53 pelo texto exato, o decimal exato, o texto com aspas, barra, acento, emoji, quebra de linha, vazio e
/// de 40.000 caracteres, o booleano, a data de dia e o instante, o nulo, a lista de 3, 1.000 e 10.000 itens, o limite de linhas, o `SELECT ?` sem tipo, a conta, o `LIKE`,
/// o `BETWEEN`, o `INSERT … VALUES` e o `UPDATE … SET`), o valor de injeção que não muda nada, o marcador a mais e a menos, o filtro do resultado nas duas formas, a
/// contagem, a coluna inteira nas três formas (com marcadores no `SELECT` do `&lt;Q&gt;`), o alvo da edição, a exportação e a cópia. Cada banco informa o seu SQL nas
/// pontas que mudam (o marcador, o limite, a tabela); o resto é o mesmo roteiro. A tabela é do fixture, e o fixture a apaga.
/// </summary>
public abstract class QueryParametersTests
{
    private const string UserName = "marina.costa";

    private readonly string _table = $"pv{Guid.NewGuid():N}"[..14];

    private ApiHost _host = null!;
    private HttpClient _client = null!;
    private Guid _connectionID;
    private Guid _sessionID;

    /// <summary>A tabela como o banco a guarda (escrita sem aspas, a do Db2 vira maiúsculas).</summary>
    protected abstract string Folded(string name);

    protected abstract Task<ConnectionSettings> StartDatabaseAsync();

    protected abstract Task<ApiHost> StartHostAsync();

    /// <summary>O marcador de número `n` (a partir de 1): `$n` no PostgreSQL, `?` nos outros.</summary>
    protected abstract string M(int n);

    protected abstract string CreateTableSql(string table);

    /// <summary>`FROM` de uma linha só, para o `SELECT` que não lê tabela; vazio no PostgreSQL.</summary>
    protected abstract string FromDual { get; }

    /// <summary>O `SELECT` das primeiras linhas, com o limite no marcador `n`: `LIMIT`, `FETCH FIRST` ou `FIRST`.</summary>
    protected abstract string LimitedIds(string table, int n);

    /// <summary>O limite no fim do comando (o `ORDER BY` já escrito): `LIMIT n`, `FETCH FIRST n ROWS ONLY`. No Informix, o `LIMIT` do fim leva ao caminho por lotes.</summary>
    protected abstract string TailLimit(int n);

    protected abstract string LengthOfBig(string table, int n);

    /// <summary>O esquema (ou dono) em que as tabelas do teste ficam, como o banco o guarda.</summary>
    protected abstract string DefaultSchema { get; }

    /// <summary>`SELECT ?` sozinho funciona (PostgreSQL com `$1`); no Db2 e no Informix o banco o recusa (a sonda S-VAR-1), e só `? + 1` passa.</summary>
    protected virtual bool BareMarkerWorks => false;

    /// <summary>`SELECT $1 + $2` com dois marcadores sem tipo é recusado no PostgreSQL ("operator is not unique").</summary>
    protected virtual bool TwoUntypedMarkersAdd => true;

    /// <summary>O banco guarda o emoji e o ✓ (o Informix de teste é 8859-1 e recusa os dois).</summary>
    protected virtual bool Emoji => true;

    /// <summary>O -2^63 vai como número inteiro (o Informix o recebe como decimal).</summary>
    protected virtual bool MinimumBigInt => true;

    /// <summary>O texto vazio volta vazio (o Informix o guarda como nulo).</summary>
    protected virtual bool EmptyTextIsKept => true;

    /// <summary>O limite de dígitos do `number` no driver da IBM (31); nulo no PostgreSQL, que tem o `numeric` sem esse limite.</summary>
    protected virtual int? DecimalDigitLimit => 31;

    private string Table => _table;

    private string Session => $"{PrismCalls.SessionsPath}/{_sessionID}";

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        var settings = await StartDatabaseAsync();
        _host = await StartHostAsync();
        _client = _host.Client;
        await _host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        _connectionID = await _client.CreateConnectionAsync(settings);
        _sessionID = await _client.OpenSessionAsync(_connectionID);

        await _client.ExecuteAsync(_sessionID, CreateTableSql(Table));
        await _client.ExecuteAsync(_sessionID, CreateTableSql($"{Table}x"));
        for (var n = 1; n <= 20; n++)
            await _client.ExecuteAsync(_sessionID, $"INSERT INTO {Table} (id, i, s) VALUES ({n}, {n * 10}, 'linha {n}')");
    }

    [OneTimeTearDown]
    public async Task StopAsync()
    {
        foreach (var table in new[] { Table, $"{Table}x" })
            await _client.ExecuteRawAsync(_sessionID, $"DROP TABLE {table}");

        await _host.DisposeAsync();
    }

    private static object P(string type, string? value)
        => new { type, value };

    private static object Number(long value)
        => P("number", value.ToString(System.Globalization.CultureInfo.InvariantCulture));

    private async Task<HttpResponseMessage> PostAsync(string sql, IReadOnlyList<object>? parameters = null, string? filter = null, int? pageSize = null)
        => await _client.PostAsJsonAsync($"{Session}/queries", new { sql, @params = parameters, filter, pageSize });

    private async Task<JsonElement> OkAsync(string sql, IReadOnlyList<object>? parameters = null, string? filter = null, int? pageSize = null)
    {
        var response = await PostAsync(sql, parameters, filter, pageSize);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), $"{sql} :: {body}");

        return body;
    }

    private async Task<JsonElement> ProblemAsync(string sql, IReadOnlyList<object>? parameters, HttpStatusCode status, string type, string? filter = null)
    {
        var response = await PostAsync(sql, parameters, filter);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That((response.StatusCode, body.GetProperty("type").GetString()), Is.EqualTo((status, type)), $"{sql} :: {body}");

        return body;
    }

    private static string?[][] Rows(JsonElement body)
        => [.. body.GetProperty("rows").EnumerateArray().Select(row => row.EnumerateArray().Select(cell => cell.ValueKind == JsonValueKind.Null ? null : cell.GetString()).ToArray())];

    private async Task<string?[][]> SelectAsync(string sql, params object[] parameters)
        => Rows(await OkAsync(sql, parameters));

    private async Task<string?> ScalarAsync(string sql, params object[] parameters)
        => (await SelectAsync(sql, parameters))[0][0];

    private Task<JsonElement> ExecuteWithAsync(string sql, params object[] parameters)
        => OkAsync(sql, parameters);

    /// <summary>Apaga as linhas de um teste (os ids a partir de 1.000 são dos testes; os de 1 a 20 são da carga).</summary>
    private Task CleanAsync()
        => _client.ExecuteAsync(_sessionID, $"DELETE FROM {Table} WHERE id >= 1000");

    [Test]
    public async Task Integers_BigIntsAndDecimals_TravelWithTheExactValue()
    {
        await ExecuteWithAsync($"INSERT INTO {Table} (id, i, b, d) VALUES ({M(1)}, {M(2)}, {M(3)}, {M(4)})", Number(1001), Number(-7), P("number", "9007199254740993"), P("number", "12345678901234.5678"));
        await ExecuteWithAsync($"INSERT INTO {Table} (id, i, b, d) VALUES ({M(1)}, {M(2)}, {M(3)}, {M(4)})", Number(1002), Number(2147483647), P("number", "-9223372036854775807"), P("number", "0.0001"));

        var row = (await SelectAsync($"SELECT i, b, d FROM {Table} WHERE id = {M(1)}", Number(1001)))[0];
        var exact = await ScalarAsync($"SELECT COUNT(*) FROM {Table} WHERE b = {M(1)}", P("number", "9007199254740993"));
        var neighbour = await ScalarAsync($"SELECT COUNT(*) FROM {Table} WHERE b = {M(1)}", P("number", "9007199254740992"));
        var negative = (await SelectAsync($"SELECT i, b, d FROM {Table} WHERE id = {M(1)}", Number(1002)))[0];
        var decimalMatch = await ScalarAsync($"SELECT COUNT(*) FROM {Table} WHERE d = {M(1)}", P("number", "12345678901234.5678"));
        await CleanAsync();

        Assert.That(row, Is.EqualTo(new[] { "-7", "9007199254740993", "12345678901234.5678" }));
        Assert.That((exact, neighbour), Is.EqualTo(("1", "0")));
        Assert.That(negative, Is.EqualTo(new[] { "2147483647", "-9223372036854775807", "0.0001" }));
        Assert.That(decimalMatch, Is.EqualTo("1"));
    }

    [Test]
    public async Task MinimumBigInt_FollowsTheEngine()
    {
        var sql = $"INSERT INTO {Table} (id, b) VALUES ({M(1)}, {M(2)})";
        var parameters = new[] { Number(1003), P("number", "-9223372036854775808") };

        if (MinimumBigInt)
        {
            await ExecuteWithAsync(sql, parameters);
            Assert.That(await ScalarAsync($"SELECT b FROM {Table} WHERE id = {M(1)}", Number(1003)), Is.EqualTo("-9223372036854775808"));
        }
        else
        {
            // O `INT8` do Informix não guarda -2^63 (é o nulo dele): o banco recusa, com a mensagem dele.
            var problem = await ProblemAsync(sql, parameters, HttpStatusCode.UnprocessableEntity, "SQL_EXECUTION_FAILED");
            Assert.That(problem.GetProperty("detail").GetString(), Does.Contain("1284").Or.Contain("fit"));
        }

        await CleanAsync();
    }

    [Test]
    public async Task Texts_WithQuotesBackslashAccentsBreaksAndEmpty_TravelAsTheyAre()
    {
        var texts = new List<string> { "O'Brien", "a\\b\\", "\"aspas\" e 'simples'", "ação ünï", "linha1\nlinha2\r\nlinha3\ttab", "%_! ?", "{ $1 } -- /* x */" };
        if (EmptyTextIsKept)
            texts.Add(string.Empty);

        // O Informix de teste é 8859-1 (a sonda S-VAR-1): o ✓ é recusado pelo banco, como o emoji.
        if (Emoji)
            texts.Add("ok ✓");

        for (var index = 0; index < texts.Count; index++)
        {
            await ExecuteWithAsync($"INSERT INTO {Table} (id, s) VALUES ({M(1)}, {M(2)})", Number(1100 + index), P("text", texts[index]));
            var stored = await ScalarAsync($"SELECT s FROM {Table} WHERE id = {M(1)}", Number(1100 + index));
            var matches = await ScalarAsync($"SELECT COUNT(*) FROM {Table} WHERE s = {M(1)} AND id >= 1000", P("text", texts[index]));

            Assert.That((stored, matches), Is.EqualTo((texts[index], "1")), $"texto {index}");
        }

        await CleanAsync();
    }

    [Test]
    public async Task Emoji_FollowsTheEngine()
    {
        var sql = $"INSERT INTO {Table} (id, s) VALUES ({M(1)}, {M(2)})";
        var parameters = new[] { Number(1150), P("text", "ok 😀 ok") };

        if (Emoji)
        {
            await ExecuteWithAsync(sql, parameters);
            Assert.That(await ScalarAsync($"SELECT s FROM {Table} WHERE id = {M(1)}", Number(1150)), Is.EqualTo("ok 😀 ok"));
        }
        else
        {
            // O Informix não guarda o emoji nos locais de banco dele (a sonda S-VAR-1): o erro é o do banco, como veio.
            await ProblemAsync(sql, parameters, HttpStatusCode.UnprocessableEntity, "SQL_EXECUTION_FAILED");
        }

        await CleanAsync();
    }

    [Test]
    public async Task Text_Of40000Characters_ReachesTheBigColumn()
    {
        await ExecuteWithAsync($"INSERT INTO {Table} (id, big) VALUES ({M(1)}, {M(2)})", Number(1160), P("text", new string('x', 40_000)));

        var length = await ScalarAsync(LengthOfBig(Table, 1), Number(1160));
        await CleanAsync();

        Assert.That(length, Is.EqualTo("40000"));
    }

    [Test]
    public async Task Booleans_ComparedAndStored()
    {
        await ExecuteWithAsync($"INSERT INTO {Table} (id, bo) VALUES ({M(1)}, {M(2)})", Number(1201), P("boolean", "true"));
        await ExecuteWithAsync($"INSERT INTO {Table} (id, bo) VALUES ({M(1)}, {M(2)})", Number(1202), P("boolean", "false"));
        await ExecuteWithAsync($"INSERT INTO {Table} (id, bo) VALUES ({M(1)}, {M(2)})", Number(1203), P("boolean", null));

        var yes = await SelectAsync($"SELECT id FROM {Table} WHERE bo = {M(1)} AND id >= 1000", P("boolean", "true"));
        var no = await SelectAsync($"SELECT id FROM {Table} WHERE bo = {M(1)} AND id >= 1000", P("boolean", "false"));
        var nulls = await SelectAsync($"SELECT id FROM {Table} WHERE bo IS NULL AND id >= 1000");
        await CleanAsync();

        Assert.That(yes.Select(row => row[0]), Is.EqualTo(new[] { "1201" }));
        Assert.That(no.Select(row => row[0]), Is.EqualTo(new[] { "1202" }));
        Assert.That(nulls.Select(row => row[0]), Is.EqualTo(new[] { "1203" }));
    }

    [Test]
    public async Task Dates_AndInstants_AgainstDateAndTimestampColumns()
    {
        await ExecuteWithAsync($"INSERT INTO {Table} (id, dt, ts) VALUES ({M(1)}, {M(2)}, {M(3)})", Number(1301), P("date", "2026-10-20"), P("timestamp", "2026-10-20 10:30:05.25"));
        await ExecuteWithAsync($"INSERT INTO {Table} (id, dt, ts) VALUES ({M(1)}, {M(2)}, {M(3)})", Number(1302), P("date", "2026-10-21"), P("timestamp", "2026-10-21 00:00:00"));

        var dayOnDate = await SelectAsync($"SELECT id FROM {Table} WHERE dt = {M(1)} AND id >= 1000", P("date", "2026-10-20"));
        var dayOnTimestamp = await SelectAsync($"SELECT id FROM {Table} WHERE ts = {M(1)} AND id >= 1000", P("date", "2026-10-21"));
        var instantOnTimestamp = await SelectAsync($"SELECT id FROM {Table} WHERE ts = {M(1)} AND id >= 1000", P("timestamp", "2026-10-20 10:30:05.25"));
        var instantOnDate = await SelectAsync($"SELECT id FROM {Table} WHERE dt = {M(1)} AND id >= 1000", P("timestamp", "2026-10-20 10:30:05"));
        var back = (await SelectAsync($"SELECT dt FROM {Table} WHERE id = {M(1)}", Number(1301)))[0][0];
        await CleanAsync();

        Assert.That(dayOnDate.Select(row => row[0]), Is.EqualTo(new[] { "1301" }));
        Assert.That(dayOnTimestamp.Select(row => row[0]), Is.EqualTo(new[] { "1302" }));
        Assert.That(instantOnTimestamp.Select(row => row[0]), Is.EqualTo(new[] { "1301" }));
        Assert.That(instantOnDate.Select(row => row[0]), Is.EqualTo(new[] { "1301" }));
        Assert.That(back, Does.StartWith("2026-10-20"));
    }

    [Test]
    public async Task Nulls_OfEachType_InTheInsertAndTheWhere()
    {
        await ExecuteWithAsync($"INSERT INTO {Table} (id, i, b, d, s, bo, dt, ts) VALUES ({M(1)}, {M(2)}, {M(3)}, {M(4)}, {M(5)}, {M(6)}, {M(7)}, {M(8)})",
            Number(1401), P("number", null), P("number", null), P("number", null), P("text", null), P("boolean", null), P("date", null), P("timestamp", null));

        var allNull = await SelectAsync($"SELECT id FROM {Table} WHERE id = {M(1)} AND i IS NULL AND b IS NULL AND d IS NULL AND s IS NULL AND bo IS NULL AND dt IS NULL AND ts IS NULL", Number(1401));
        var equalsNull = await SelectAsync($"SELECT id FROM {Table} WHERE i = {M(1)} AND id >= 1000", P("number", null));
        var orNull = await SelectAsync($"SELECT id FROM {Table} WHERE (s IS NULL OR s = {M(1)}) AND id >= 1000", P("text", null));
        await CleanAsync();

        Assert.That(allNull.Select(row => row[0]), Is.EqualTo(new[] { "1401" }));
        Assert.That(equalsNull, Is.Empty);
        Assert.That(orNull.Select(row => row[0]), Is.EqualTo(new[] { "1401" }));
    }

    [TestCase(3, 2)]
    [TestCase(1, 1)]
    [TestCase(1000, 20)]
    [TestCase(10000, 20)]
    public async Task Lists_OfItemsInAnIn_AreOneMarkerEach(int items, int expected)
    {
        var markers = string.Join(", ", Enumerable.Range(1, items).Select(M));
        var parameters = items == 3 ? new[] { Number(2), Number(4), Number(99) } : [.. Enumerable.Range(1, items).Select(item => Number(item))];

        var count = await ScalarAsync($"SELECT COUNT(*) FROM {Table} WHERE id IN ({markers})", parameters);

        Assert.That(count, Is.EqualTo(expected.ToString()));
    }

    [Test]
    public async Task Limit_FetchFirstAndFirst_TakeAMarker()
    {
        var rows = await SelectAsync(LimitedIds(Table, 1), Number(3));

        Assert.That(rows.Select(row => row[0]), Is.EqualTo(new[] { "1", "2", "3" }));
    }

    [Test]
    public async Task SelectOfAMarker_TheSumAndTheCast_FollowTheEngine()
    {
        var five = Number(5);
        if (BareMarkerWorks)
            Assert.That(await ScalarAsync($"SELECT {M(1)}{FromDual}", five), Is.EqualTo("5"));
        else
            await ProblemAsync($"SELECT {M(1)}{FromDual}", [five], HttpStatusCode.UnprocessableEntity, "SQL_EXECUTION_FAILED");

        Assert.That(await ScalarAsync($"SELECT {M(1)} + 1{FromDual}", five), Is.EqualTo("6"));
        Assert.That(await ScalarAsync($"SELECT CAST({M(1)} AS INTEGER){FromDual}", five), Is.EqualTo("5"));
        Assert.That(await ScalarAsync($"SELECT CAST({M(1)} AS INTEGER) + CAST({M(2)} AS INTEGER){FromDual}", five, Number(6)), Is.EqualTo("11"));

        if (TwoUntypedMarkersAdd)
            Assert.That(await ScalarAsync($"SELECT {M(1)} + {M(2)}{FromDual}", five, Number(6)), Is.EqualTo("11"));
        else
        {
            var problem = await ProblemAsync($"SELECT {M(1)} + {M(2)}{FromDual}", [five, Number(6)], HttpStatusCode.UnprocessableEntity, "SQL_EXECUTION_FAILED");
            Assert.That(problem.GetProperty("detail").GetString(), Does.Contain("operator is not unique"));
        }
    }

    [Test]
    public async Task Like_Between_AndUpdate_TakeParameters()
    {
        var like = await ScalarAsync($"SELECT COUNT(*) FROM {Table} WHERE s LIKE {M(1)}", P("text", "linha 1%"));
        var between = await ScalarAsync($"SELECT COUNT(*) FROM {Table} WHERE i BETWEEN {M(1)} AND {M(2)}", Number(30), Number(60));
        var update = await ExecuteWithAsync($"UPDATE {Table} SET s = {M(1)}, i = {M(2)} WHERE id = {M(3)}", P("text", "mudou 'assim'"), Number(777), Number(20));
        var changed = (await SelectAsync($"SELECT s, i FROM {Table} WHERE id = {M(1)}", Number(20)))[0];
        await ExecuteWithAsync($"UPDATE {Table} SET s = {M(1)}, i = {M(2)} WHERE id = {M(3)}", P("text", "linha 20"), Number(200), Number(20));

        Assert.That((like, between), Is.EqualTo(("11", "4")));
        Assert.That(update.GetProperty("rowsAffected").GetInt64(), Is.EqualTo(1));
        Assert.That(changed, Is.EqualTo(new[] { "mudou 'assim'", "777" }));
    }

    [Test]
    public async Task InjectionValue_IsOnlyAValue()
    {
        const string Injection = "'; DROP TABLE x; --";

        await ExecuteWithAsync($"INSERT INTO {Table} (id, s) VALUES ({M(1)}, {M(2)})", Number(1501), P("text", Injection));
        var matches = await ScalarAsync($"SELECT COUNT(*) FROM {Table} WHERE s = {M(1)}", P("text", Injection));
        var rows = await ScalarAsync($"SELECT COUNT(*) FROM {Table}");
        var none = await ScalarAsync($"SELECT COUNT(*) FROM {Table} WHERE s = {M(1)}", P("text", "' OR '1'='1"));
        await CleanAsync();

        Assert.That((matches, rows, none), Is.EqualTo(("1", "21", "0")));
    }

    [Test]
    public async Task MarkersThatDoNotMatchTheValues_AreRefusedBeforeTheDatabase()
    {
        var fewer = await ProblemAsync($"SELECT id FROM {Table} WHERE id = {M(1)} OR id = {M(2)}", [Number(1)], HttpStatusCode.UnprocessableEntity, "QUERY_PARAMETERS_MISMATCH");
        var more = await ProblemAsync($"SELECT id FROM {Table} WHERE id = {M(1)}", [Number(1), Number(2), Number(3)], HttpStatusCode.UnprocessableEntity, "QUERY_PARAMETERS_MISMATCH");
        var none = await ProblemAsync($"SELECT id FROM {Table}", [Number(1)], HttpStatusCode.UnprocessableEntity, "QUERY_PARAMETERS_MISMATCH");
        await ProblemAsync($"INSERT INTO {Table} (id) VALUES ({M(1)})", [Number(1601), Number(1602)], HttpStatusCode.UnprocessableEntity, "QUERY_PARAMETERS_MISMATCH");
        var inserted = await ScalarAsync($"SELECT COUNT(*) FROM {Table} WHERE id >= 1000");

        Assert.That((fewer.GetProperty("markers").GetInt32(), fewer.GetProperty("values").GetInt32()), Is.EqualTo((2, 1)));
        Assert.That(fewer.GetProperty("detail").GetString(), Is.EqualTo("O comando tem 2 marcadores, e veio 1 valor."));
        Assert.That((more.GetProperty("markers").GetInt32(), more.GetProperty("values").GetInt32()), Is.EqualTo((1, 3)));
        Assert.That((none.GetProperty("markers").GetInt32(), none.GetProperty("values").GetInt32()), Is.EqualTo((0, 1)));
        Assert.That(inserted, Is.EqualTo("0"));
    }

    [Test]
    public async Task ParamsOutOfShape_AreQueryInvalidOnTheField()
    {
        var number = await ProblemAsync($"SELECT {M(1)}{FromDual}", [P("number", "12abc")], HttpStatusCode.UnprocessableEntity, "QUERY_INVALID");
        var type = await ProblemAsync($"SELECT {M(1)}{FromDual}", [P("int", "1")], HttpStatusCode.UnprocessableEntity, "QUERY_INVALID");
        var date = await ProblemAsync($"SELECT {M(1)}{FromDual}", [Number(1), P("date", "2026-02-30")], HttpStatusCode.UnprocessableEntity, "QUERY_INVALID");

        Assert.That(number.GetProperty("errors").GetProperty("params[0].value").GetArrayLength(), Is.EqualTo(1));
        Assert.That(type.GetProperty("errors").GetProperty("params[0].type").GetArrayLength(), Is.EqualTo(1));
        Assert.That(date.GetProperty("errorCodes").GetProperty("params[1].value")[0].GetString(), Is.EqualTo("QUERY_INVALID"));
    }

    [Test]
    public async Task DecimalOverTheLimit_IsRefusedOnTheIbmEnginesAndSentToPostgreSql()
    {
        var digits = new string('9', (DecimalDigitLimit ?? 31) + 1);

        if (DecimalDigitLimit is not null)
        {
            var problem = await ProblemAsync($"SELECT CAST({M(1)} AS DECIMAL(31, 0)){FromDual}", [P("number", digits)], HttpStatusCode.UnprocessableEntity, "QUERY_INVALID");
            Assert.That(problem.GetProperty("errors").GetProperty("params[0].value")[0].GetString(), Does.StartWith($"O número tem {digits.Length} dígitos, e "));
        }
        else
            Assert.That(await ScalarAsync($"SELECT CAST({M(1)} AS numeric){FromDual}", P("number", digits)), Is.EqualTo(digits));
    }

    [Test]
    public async Task Filter_JoinedAndWrapped_KeepTheParameters()
    {
        var sql = $"SELECT id, i FROM {Table} WHERE i > {M(1)} ORDER BY id";

        var merged = await OkAsync(sql, [Number(100)], filter: "id < 15");
        var mergedOrder = await OkAsync(sql, [Number(100)], filter: "id < 15 ORDER BY id DESC");
        var wrapped = await OkAsync($"SELECT id, i FROM {Table} WHERE i > {M(1)} ORDER BY CASE WHEN id = {M(2)} THEN 0 ELSE 1 END, id", [Number(100), Number(13)], filter: "ORDER BY id DESC");
        var refused = await ProblemAsync(sql, [Number(100)], HttpStatusCode.UnprocessableEntity, "FILTER_INVALID", filter: $"id < {M(2)}");

        Assert.That(merged.GetProperty("filterApplied").GetString(), Is.EqualTo("merged"));
        Assert.That(Rows(merged).Select(row => row[0]), Is.EqualTo(new[] { "11", "12", "13", "14" }));
        Assert.That(Rows(mergedOrder).Select(row => row[0]), Is.EqualTo(new[] { "14", "13", "12", "11" }));
        Assert.That(wrapped.GetProperty("filterApplied").GetString(), Is.EqualTo("wrapped"));
        Assert.That(Rows(wrapped).Select(row => row[0]), Is.EqualTo(new[] { "20", "19", "18", "17", "16", "15", "14", "13", "12", "11" }));
        Assert.That(refused.GetProperty("errors").GetProperty("Filter")[0].GetString(), Is.EqualTo("O filtro não pode ter marcador de parâmetro ($1 ou ?)."));
    }

    [Test]
    public async Task Count_RunsTheCommandAgainWithTheSameValues()
    {
        await OkAsync($"SELECT id FROM {Table} WHERE i > {M(1)} AND s LIKE {M(2)}", [Number(100), P("text", "linha 1%")]);

        var response = await _client.PostAsync($"{Session}/queries/count", null);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        Assert.That(body.GetProperty("total").GetInt64(), Is.EqualTo(9));
    }

    [Test]
    public async Task EditTarget_OfACommandWithMarkers_ReadsTheTableByTheKey()
    {
        var page = await OkAsync($"SELECT CAST({M(1)} AS INTEGER) AS rotulo, id, s FROM {Table} WHERE i > {M(2)}", [Number(1), Number(100)]);

        var response = await _client.PostAsJsonAsync($"{Session}/queries/edit-target", new { resultID = page.GetProperty("resultID").GetGuid() });
        var target = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), target.ToString());
        Assert.That(target.GetProperty("tables")[0].GetProperty("name").GetString(), Is.EqualTo(Folded(Table)));
        Assert.That(target.GetProperty("tables")[0].GetProperty("editable").GetBoolean(), Is.True);
    }

    /// <summary>A coluna inteira de um resultado cujo `&lt;Q&gt;` leva parâmetros: a contagem, o "Salvar" e o que ficou no banco.</summary>
    private async Task WholeColumnAsync(string sql, object[] parameters, int resultColumnOfS, int expectedRows, string value)
    {
        var page = await OkAsync(sql, parameters);
        var resultID = page.GetProperty("resultID").GetGuid();
        var whole = new { kind = "updateAll", table = 0, set = new[] { new { column = resultColumnOfS, value = (string?)value } } };

        var counted = await _client.PostAsJsonAsync($"{Session}/queries/edits/count", new { resultID, changes = new object[] { whole } });
        var countedBody = await counted.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(counted.StatusCode, Is.EqualTo(HttpStatusCode.OK), countedBody.ToString());
        Assert.That(countedBody.GetProperty("rows").GetInt64(), Is.EqualTo(expectedRows), countedBody.ToString());

        var saved = await _client.PostAsJsonAsync($"{Session}/queries/edits", new { resultID, changes = new object[] { new { whole.kind, whole.table, whole.set, rows = expectedRows } } });
        var savedBody = await saved.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(saved.StatusCode, Is.EqualTo(HttpStatusCode.OK), savedBody.ToString());

        Assert.That(await ScalarAsync($"SELECT COUNT(*) FROM {Table} WHERE s = {M(1)}", P("text", value)), Is.EqualTo(expectedRows.ToString()));
        await _client.ExecuteAsync(_sessionID, $"UPDATE {Table} SET s = 'linha ' || CAST(id AS VARCHAR(10))");
    }

    [Test]
    public async Task WholeColumn_DirectForm_DropsTheMarkersOfTheSelectAndNumbersTheConditionAgain()
        => await WholeColumnAsync($"SELECT CAST({M(1)} AS INTEGER) AS rotulo, id, i, s FROM {Table} WHERE i > {M(2)} AND i < {M(3)}", [Number(1), Number(20), Number(100)], 3, 7, "direta");

    [Test]
    public async Task WholeColumn_KeyForm_CarriesTheMarkersOfTheQ()
        => await WholeColumnAsync($"SELECT CAST({M(1)} AS INTEGER) AS rotulo, p.id, p.i, p.s FROM {Table} p WHERE p.i > {M(2)} AND p.i < {M(3)}", [Number(1), Number(20), Number(100)], 3, 7, "chave");

    [Test]
    public async Task WholeColumn_OrderedAndLimited_CarriesTheMarkersOfTheQ()
        => await WholeColumnAsync($"SELECT id, i, s FROM {Table} WHERE i > {M(1)} ORDER BY id {TailLimit(2)}", [Number(20), Number(5)], 2, 5, "limite");

    [Test]
    public async Task Export_OfACommandWithParameters_WritesTheRowsOfTheValues()
    {
        var request = new
        {
            source = new { kind = "query", connectionID = _connectionID, sql = $"SELECT id, s FROM {Table} WHERE i > {M(1)} AND i < {M(2)} ORDER BY id", name = "exporta", @params = new[] { Number(100), Number(140) } },
            columns = new[] { new { position = 0, name = Folded("id") }, new { position = 1, name = Folded("s") } },
            count = true,
            format = "csv",
            options = (object?)null,
            output = new { bom = false, zip = false, clipboard = false },
            windowID = 1
        };

        var text = await TransferCalls.ExportTextAsync(_host, request);

        Assert.That(text, Does.Contain("11;linha 11").And.Contain("13;linha 13").And.Not.Contain("14;linha 14").And.Not.Contain("10;linha 10"));
    }

    [Test]
    public async Task Export_WithMarkersThatDoNotMatch_Returns422BeforeTheJob()
    {
        var response = await _client.PostAsJsonAsync(TransferCalls.ExportsPath, new
        {
            source = new { kind = "query", connectionID = _connectionID, sql = $"SELECT id FROM {Table} WHERE i > {M(1)} AND i < {M(2)}", name = "exporta", @params = new[] { Number(100) } },
            columns = new[] { new { position = 0, name = Folded("id") } },
            count = false,
            format = "csv",
            output = new { bom = false, zip = false, clipboard = false },
            windowID = 1
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.That((response.StatusCode, body.GetProperty("type").GetString()), Is.EqualTo((HttpStatusCode.UnprocessableEntity, "QUERY_PARAMETERS_MISMATCH")), body.ToString());
        Assert.That((body.GetProperty("markers").GetInt32(), body.GetProperty("values").GetInt32()), Is.EqualTo((2, 1)));
    }

    [Test]
    public async Task Export_WithParamsOutOfShape_IsExportOptionsInvalidOnTheField()
    {
        var response = await _client.PostAsJsonAsync(TransferCalls.ExportsPath, new
        {
            source = new { kind = "query", connectionID = _connectionID, sql = $"SELECT id FROM {Table} WHERE i > {M(1)}", name = "exporta", @params = new[] { P("number", "x") } },
            columns = new[] { new { position = 0, name = Folded("id") } },
            count = false,
            format = "csv",
            output = new { bom = false, zip = false, clipboard = false },
            windowID = 1
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.That((response.StatusCode, body.GetProperty("type").GetString()), Is.EqualTo((HttpStatusCode.UnprocessableEntity, "EXPORT_OPTIONS_INVALID")), body.ToString());
        Assert.That(body.GetProperty("errors").TryGetProperty("source.params[0].value", out _), Is.True, body.ToString());
    }

    [Test]
    public async Task Copy_OfACommandWithParameters_CopiesTheRowsOfTheValues()
    {
        var response = await _client.PostAsJsonAsync("/api/user/transfers/copies", new
        {
            source = new { kind = "query", connectionID = _connectionID, sql = $"SELECT id, s FROM {Table} WHERE i > {M(1)} AND i < {M(2)} ORDER BY id", name = "copia", @params = new[] { Number(100), Number(140) } },
            columns = new[] { new { position = 0, name = Folded("id") }, new { position = 1, name = Folded("s") } },
            count = true,
            target = new { connectionID = _connectionID, schema = DefaultSchema, table = Folded($"{Table}x") },
            mapping = new[] { new { source = 0, target = Folded("id") }, new { source = 1, target = Folded("s") } },
            load = new { empty = false, commitEvery = 100 },
            windowID = 1
        });
        var started = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Accepted), started.ToString());

        var id = started.GetProperty("id").GetGuid();
        var deadline = DateTime.UtcNow.AddSeconds(90);
        JsonElement done;
        while (true)
        {
            done = await _client.GetFromJsonAsync<JsonElement>($"/api/user/transfers/{id}");
            if (done.GetProperty("state").GetString() != "running")
                break;

            Assert.That(DateTime.UtcNow, Is.LessThan(deadline), "A cópia não terminou em 90 segundos.");
            await Task.Delay(100);
        }

        Assert.That(done.GetProperty("state").GetString(), Is.EqualTo("done"), done.ToString());
        Assert.That(done.GetProperty("committed").GetInt64(), Is.EqualTo(3));
        var copied = await SelectAsync($"SELECT id, s FROM {Table}x ORDER BY id");
        Assert.That(copied.Select(row => $"{row[0]}:{row[1]}"), Is.EqualTo(new[] { "11:linha 11", "12:linha 12", "13:linha 13" }));
        Assert.That(Encoding.UTF8.GetByteCount(done.ToString()), Is.GreaterThan(0));
    }
}

[TestFixture]
[Category("Api")]
public sealed class PostgresQueryParametersTests : QueryParametersTests
{
    protected override string Folded(string name) => name;

    protected override Task<ConnectionSettings> StartDatabaseAsync() => PostgresSingleton.GetSettingsAsync();

    protected override Task<ApiHost> StartHostAsync() => ApiHost.StartAsync();

    protected override string M(int n) => $"${n}";

    protected override string CreateTableSql(string table)
        => $"CREATE TABLE {table} (id integer PRIMARY KEY, i integer, b bigint, d numeric(18,4), s text, bo boolean, dt date, ts timestamp, big text)";

    protected override string FromDual => string.Empty;

    protected override string LimitedIds(string table, int n) => $"SELECT id FROM {table} ORDER BY id LIMIT {M(n)}";

    protected override string TailLimit(int n) => $"LIMIT {M(n)}";

    protected override string LengthOfBig(string table, int n) => $"SELECT length(big) FROM {table} WHERE id = {M(n)}";

    protected override string DefaultSchema => "public";

    protected override bool BareMarkerWorks => true;

    protected override bool TwoUntypedMarkersAdd => false;

    protected override int? DecimalDigitLimit => null;
}

[TestFixture]
[Category("Api")]
[Category("Db2")]
public sealed class Db2QueryParametersTests : QueryParametersTests
{
    protected override string Folded(string name) => name.ToUpperInvariant();

    protected override Task<ConnectionSettings> StartDatabaseAsync() => Db2Singleton.GetSettingsAsync();

    protected override async Task<ApiHost> StartHostAsync()
        => await ApiHost.StartAsync(services => services.UseDriverSource(directory: IbmDriverSingleton.GetDirectoryAsync().GetAwaiter().GetResult()));

    protected override string M(int n) => "?";

    protected override string CreateTableSql(string table)
        => $"CREATE TABLE {table} (id INTEGER NOT NULL PRIMARY KEY, i INTEGER, b BIGINT, d DECIMAL(18,4), s VARCHAR(2000), bo BOOLEAN, dt DATE, ts TIMESTAMP, big CLOB(1M))";

    protected override string FromDual => " FROM sysibm.sysdummy1";

    protected override string LimitedIds(string table, int n) => $"SELECT id FROM {table} ORDER BY id FETCH FIRST {M(n)} ROWS ONLY";

    protected override string TailLimit(int n) => $"FETCH FIRST {M(n)} ROWS ONLY";

    protected override string LengthOfBig(string table, int n) => $"SELECT LENGTH(big) FROM {table} WHERE id = {M(n)}";

    protected override string DefaultSchema => "DB2INST1";
}

[TestFixture]
[Category("Api")]
[Category("Informix")]
public sealed class InformixQueryParametersTests : QueryParametersTests
{
    protected override string Folded(string name) => name.ToLowerInvariant();

    protected override Task<ConnectionSettings> StartDatabaseAsync() => InformixSingleton.GetSettingsAsync();

    protected override async Task<ApiHost> StartHostAsync()
        => await ApiHost.StartAsync(services => services.UseDriverSource(directory: IbmDriverSingleton.GetDirectoryAsync().GetAwaiter().GetResult()));

    protected override string M(int n) => "?";

    protected override string CreateTableSql(string table)
        => $"CREATE TABLE {table} (id INTEGER NOT NULL PRIMARY KEY, i INTEGER, b INT8, d DECIMAL(18,4), s LVARCHAR(2000), bo BOOLEAN, dt DATE, ts DATETIME YEAR TO FRACTION(5), big TEXT)";

    protected override string FromDual => " FROM systables WHERE tabid = 1";

    protected override string LimitedIds(string table, int n) => $"SELECT FIRST {M(n)} id FROM {table} ORDER BY id";

    protected override string TailLimit(int n) => $"LIMIT {M(n)}";

    protected override string LengthOfBig(string table, int n) => $"SELECT LENGTH(big) FROM {table} WHERE id = {M(n)}";

    protected override string DefaultSchema => "informix";

    protected override bool Emoji => false;

    protected override bool MinimumBigInt => false;

    protected override bool EmptyTextIsKept => false;
}
