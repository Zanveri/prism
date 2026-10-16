using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// As rotas da edição de registros (seção 22, "Rotas e respostas") em HTTP, contra o PostgreSQL: a página com `resultID` e `editable`,
/// o `edit-target`, o "Ver SQL" e o "Salvar", com os códigos e as extensões de cada recusa. O que cada banco faz está nos testes do
/// registro de sessões (`Infrastructure/Databases/*EditTests`).
/// </summary>
[TestFixture]
[Category("Databases")]
public sealed class DatabaseSessionEditsTests
{
    private readonly string _schema = $"rotas_{Guid.NewGuid():N}"[..18];

    private ConnectionSettings _settings = null!;

    private string Pedido => $"\"{_schema}\".\"pedido\"";

    private string Cliente => $"\"{_schema}\".\"cliente\"";

    private string Conta => $"\"{_schema}\".\"conta\"";

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        _settings = await PostgresSingleton.GetSettingsAsync();

        await using var host = await ApiHost.StartAsync();
        var session = await StartSessionAsync(host);
        foreach (var sql in new[] { $"CREATE SCHEMA {_schema}", $"CREATE TABLE {Pedido} (id integer PRIMARY KEY, status text, total integer GENERATED ALWAYS AS (id * 2) STORED)", $"INSERT INTO {Pedido} (id, status) VALUES (1, 'aberta'), (2, 'aberta')", $"CREATE TABLE {Cliente} (id integer PRIMARY KEY, nome text)", $"CREATE TABLE {Conta} (id integer PRIMARY KEY, cliente_id integer NOT NULL, saldo integer)", $"INSERT INTO {Cliente} VALUES (7, 'Ana')", $"INSERT INTO {Conta} VALUES (1, 7, 10), (2, 7, 20)" })
            await host.Client.ExecuteAsync(session, sql);
    }

    [OneTimeTearDown]
    public async Task StopAsync()
    {
        await using var host = await ApiHost.StartAsync();
        await host.Client.ExecuteAsync(await StartSessionAsync(host), $"DROP SCHEMA {_schema} CASCADE");
    }

    [Test]
    public async Task Edits_FromThePageToTheSave_FollowTheRoutesOfSection22()
    {
        await using var host = await ApiHost.StartAsync();
        var session = await StartSessionAsync(host);

        var page = await host.Client.ExecuteAsync(session, $"SELECT * FROM {Pedido}\nORDER BY 1");
        var resultID = page.GetProperty("resultID").GetGuid();
        Assert.That(page.GetProperty("editable").ToString(), Is.EqualTo("""{"known":false,"reason":null}"""));

        var target = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edit-target"), new { resultID }), HttpStatusCode.OK);
        Assert.That(target.ToString(), Is.EqualTo($$"""{"tables":[{"schema":"{{_schema}}","name":"pedido","key":[0],"editable":true,"reason":null}],"columns":[{"table":0,"baseColumn":"id","editable":true,"reason":null,"nullable":false,"generated":null},{"table":0,"baseColumn":"status","editable":true,"reason":null,"nullable":true,"generated":null},{"table":0,"baseColumn":"total","editable":false,"reason":"gerada pelo banco","nullable":true,"generated":"always"}],"rowOperations":true,"oneAtATime":false}"""));

        var changes = new object[] { new { kind = "update", table = 0, key = new[] { "1" }, set = new[] { new { column = 1, value = (string?)"paga" } } }, new { kind = "insert", table = 0, values = new[] { new { column = 0, value = (string?)"3" }, new { column = 1, value = (string?)null } } } };
        var preview = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits/preview"), new { resultID, changes }), HttpStatusCode.OK);
        Assert.That(preview.GetProperty("statements").EnumerateArray().Select(statement => statement.GetProperty("sql").GetString()), Is.EqualTo(new[] { $"UPDATE {Pedido} SET \"status\" = 'paga' WHERE \"id\" = 1", $"INSERT INTO {Pedido} (\"id\", \"status\") VALUES (3, NULL)" }));
        Assert.That(preview.GetProperty("statements").EnumerateArray().Select(statement => statement.GetProperty("values").GetArrayLength()), Is.All.Zero);
        Assert.That(preview.GetProperty("oneAtATime").GetBoolean(), Is.False);

        var saved = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes }), HttpStatusCode.OK);
        Assert.That(saved.ToString(), Is.EqualTo("""{"applied":2}"""));

        var rows = (await host.Client.ExecuteAsync(session, $"SELECT id, status FROM {Pedido} ORDER BY 1")).GetProperty("rows").ToString();
        Assert.That(rows, Is.EqualTo("""[["1","paga"],["2","aberta"],["3",null]]"""));
    }

    /// <summary>
    /// RN-EDIT-002: o resultado de junção responde, no `edit-target`, as tabelas do `FROM` com a chave de cada uma e a tabela de cada
    /// coluna; as alterações de uma linha em duas tabelas são dois `UPDATE` no "Ver SQL" e no "Salvar".
    /// </summary>
    [Test]
    public async Task Edits_OfAJoin_AnswerEachTableAndSaveOneUpdatePerTable()
    {
        await using var host = await ApiHost.StartAsync();
        var session = await StartSessionAsync(host);

        var page = await host.Client.ExecuteAsync(session, $"SELECT conta.id, conta.saldo, c.id AS cliente, c.nome FROM {Conta} conta JOIN {Cliente} c ON c.id = conta.cliente_id ORDER BY 1");
        var resultID = page.GetProperty("resultID").GetGuid();
        Assert.That(page.GetProperty("editable").ToString(), Is.EqualTo("""{"known":false,"reason":null}"""));

        var target = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edit-target"), new { resultID }), HttpStatusCode.OK);
        Assert.That(target.ToString(), Is.EqualTo($$"""{"tables":[{"schema":"{{_schema}}","name":"conta","key":[0],"editable":true,"reason":null},{"schema":"{{_schema}}","name":"cliente","key":[2],"editable":true,"reason":null}],"columns":[{"table":0,"baseColumn":"id","editable":false,"reason":"coluna da chave numa junção","nullable":false,"generated":null},{"table":0,"baseColumn":"saldo","editable":true,"reason":null,"nullable":true,"generated":null},{"table":1,"baseColumn":"id","editable":false,"reason":"coluna da chave numa junção","nullable":false,"generated":null},{"table":1,"baseColumn":"nome","editable":true,"reason":null,"nullable":true,"generated":null}],"rowOperations":false,"oneAtATime":false}"""));

        var changes = new object[] { new { kind = "update", table = 0, key = new[] { "1" }, set = new[] { new { column = 1, value = (string?)"15" } } }, new { kind = "update", table = 1, key = new[] { "7" }, set = new[] { new { column = 3, value = (string?)"Ana Maria" } } } };
        var preview = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits/preview"), new { resultID, changes }), HttpStatusCode.OK);
        Assert.That(preview.GetProperty("statements").EnumerateArray().Select(statement => statement.GetProperty("sql").GetString()), Is.EqualTo(new[] { $"UPDATE {Conta} SET \"saldo\" = 15 WHERE \"id\" = 1", $"UPDATE {Cliente} SET \"nome\" = 'Ana Maria' WHERE \"id\" = 7" }));

        var refused = await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes = new object[] { new { kind = "delete", table = 0, key = new[] { "1" } } } }), HttpStatusCode.UnprocessableEntity, "EDIT_INVALID");
        Assert.That(refused.GetProperty("change").GetInt32(), Is.Zero);

        var saved = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes }), HttpStatusCode.OK);
        Assert.That(saved.ToString(), Is.EqualTo("""{"applied":2}"""));

        var rows = (await host.Client.ExecuteAsync(session, $"SELECT conta.id, conta.saldo, c.nome FROM {Conta} conta JOIN {Cliente} c ON c.id = conta.cliente_id ORDER BY 1")).GetProperty("rows").ToString();
        Assert.That(rows, Is.EqualTo("""[["1","15","Ana Maria"],["2","20","Ana Maria"]]"""));
    }

    [Test]
    public async Task Edits_RefusalsCarryTheCodeAndTheExtensionsOfSection22()
    {
        await using var host = await ApiHost.StartAsync();
        var session = await StartSessionAsync(host);
        var resultID = (await host.Client.ExecuteAsync(session, $"SELECT * FROM {Pedido}\nORDER BY 1")).GetProperty("resultID").GetGuid();
        await host.Client.PostAsJsonAsync(Url(session, "/queries/edit-target"), new { resultID });

        var mismatch = await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes = new object[] { new { kind = "delete", table = 0, key = new[] { "999" } } } }), HttpStatusCode.UnprocessableEntity, "EDIT_ROW_MISMATCH");
        Assert.That((mismatch.GetProperty("change").GetInt32(), mismatch.GetProperty("rowsAffected").GetInt64()), Is.EqualTo((0, 0L)));

        var invalid = await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes = new object[] { new { kind = "update", table = 0, key = new[] { "1" }, set = new[] { new { column = 2, value = "4" } } } } }), HttpStatusCode.UnprocessableEntity, "EDIT_INVALID");
        Assert.That((invalid.GetProperty("change").GetInt32(), invalid.GetProperty("column").GetInt32()), Is.EqualTo((0, 2)));

        var failed = await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes = new object[] { new { kind = "insert", table = 0, values = new[] { new { column = 0, value = "1" } } } } }), HttpStatusCode.UnprocessableEntity, "SQL_EXECUTION_FAILED");
        Assert.That((failed.GetProperty("change").GetInt32(), failed.GetProperty("sqlState").GetString()), Is.EqualTo((0, "23505")));
        Assert.That(failed.GetProperty("detail").GetString(), Does.StartWith("duplicate key value violates unique constraint"));

        await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes = Array.Empty<object>() }), HttpStatusCode.UnprocessableEntity, "EDIT_INVALID");

        var union = (await host.Client.ExecuteAsync(session, $"SELECT id FROM {Pedido} UNION SELECT 1")).GetProperty("resultID").GetGuid();
        var readOnly = await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edit-target"), new { resultID = union }), HttpStatusCode.UnprocessableEntity, "RESULT_NOT_EDITABLE");
        Assert.That(readOnly.GetProperty("reason").GetString(), Is.EqualTo("união de consultas"));

        await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID, changes = new object[] { new { kind = "delete", table = 0, key = new[] { "1" } } } }), HttpStatusCode.Conflict, "RESULT_CHANGED");
        await ProblemAsync(await host.Client.PostAsJsonAsync(Url(Guid.NewGuid(), "/queries/edit-target"), new { resultID }), HttpStatusCode.NotFound, "DATABASE_SESSION_NOT_FOUND");
    }

    /// <summary>
    /// RN-SQL-024 (seção 33): o resultado que o comando seguinte leva em `keep` continua se editando pelo `resultID` dele, como as abas do
    /// script; o "Salvar" dele fecha o cursor do atual, que continua o atual. O comando sem `keep` o esquece, e as rotas da edição respondem
    /// 409 `RESULT_CHANGED` com o texto novo. O `keep` com uma entrada que não é um identificador, ou com mais de 20, é 422 `QUERY_INVALID`
    /// no campo, e nada vai ao banco.
    /// </summary>
    [Test]
    public async Task Edits_OfAKeptResult_FollowTheRoutesOfSection33()
    {
        await using var host = await ApiHost.StartAsync();
        var session = await StartSessionAsync(host);
        var guardado = $"\"{_schema}\".\"guardado\"";
        await host.Client.ExecuteAsync(session, $"CREATE TABLE {guardado} (id integer PRIMARY KEY, status text)");
        await host.Client.ExecuteAsync(session, $"INSERT INTO {guardado} VALUES (1, 'aberta'), (2, 'aberta')");

        var first = (await host.Client.ExecuteAsync(session, $"SELECT * FROM {guardado}\nORDER BY 1")).GetProperty("resultID").GetGuid();
        var current = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries"), new { sql = "SELECT * FROM generate_series(1, 500) AS n", pageSize = 50, keep = new[] { first } }), HttpStatusCode.OK);
        Assert.That(current.GetProperty("hasMore").GetBoolean(), Is.True);

        var target = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edit-target"), new { resultID = first }), HttpStatusCode.OK);
        Assert.That(target.GetProperty("rowOperations").GetBoolean(), Is.True);

        var changes = new object[] { new { kind = "update", table = 0, key = new[] { "2" }, set = new[] { new { column = 1, value = (string?)"guardada" } } } };
        var preview = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits/preview"), new { resultID = first, changes }), HttpStatusCode.OK);
        Assert.That(preview.GetProperty("statements")[0].GetProperty("sql").GetString(), Is.EqualTo($"UPDATE {guardado} SET \"status\" = 'guardada' WHERE \"id\" = 2"));

        var saved = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID = first, changes }), HttpStatusCode.OK);
        Assert.That(saved.ToString(), Is.EqualTo("""{"applied":1}"""));

        // O "Salvar" fechou o cursor do atual (RN-EDIT-009), que continua o atual: o "carregar mais" não tem mais o que ler.
        await ProblemAsync(await host.Client.PostAsync(Url(session, "/queries/next"), null), HttpStatusCode.Conflict, "NO_OPEN_CURSOR");

        var invalid = await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries"), new { sql = "SELECT 1", keep = new object?[] { first, "texto" } }), HttpStatusCode.UnprocessableEntity, "QUERY_INVALID");
        Assert.That(invalid.GetProperty("errorCodes").GetProperty("Keep").ToString(), Does.Contain("QUERY_INVALID"));
        await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries"), new { sql = "SELECT 1", keep = Enumerable.Range(0, 21).Select(_ => Guid.NewGuid()) }), HttpStatusCode.UnprocessableEntity, "QUERY_INVALID");
        await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edit-target"), new { resultID = first }), HttpStatusCode.OK);

        await host.Client.ExecuteAsync(session, "SELECT 1");
        var forgotten = await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edit-target"), new { resultID = first }), HttpStatusCode.Conflict, "RESULT_CHANGED");
        Assert.That(forgotten.GetProperty("detail").GetString(), Is.EqualTo("O resultado não está mais guardado na sessão: outro comando foi executado nela depois dele. Execute o comando de novo para editar."));

        var rows = (await host.Client.ExecuteAsync(session, $"SELECT id, status FROM {guardado} WHERE id = 2")).GetProperty("rows").ToString();
        Assert.That(rows, Is.EqualTo("""[["2","guardada"]]"""));
    }

    /// <summary>
    /// RN-SQL-024 (seção 33): no PostgreSQL o guardado edita a tabela que leu, pelo identificador dela. Quando o nome escrito sem esquema leva
    /// agora a outra tabela (um `SET search_path` depois dele), o "Salvar", que confere o nome na própria sessão, dentro da transação, responde
    /// 409 `RESULT_CHANGED` com a tabela que mudou, e nada vai para nenhuma das duas. O alvo perguntado antes da mudança vinha editável: o
    /// catálogo do `edit-target` não vai à sessão do resultado (RN-EDIT-010), e o caminho de busca dele é outro.
    /// </summary>
    [Test]
    public async Task Save_OfAKeptResult_IsRefused_WhenTheUnqualifiedNameNowLeadsToAnotherTable()
    {
        await using var host = await ApiHost.StartAsync();
        var session = await StartSessionAsync(host);
        var other = $"{_schema}_b";
        try
        {
            await host.Client.ExecuteAsync(session, $"CREATE SCHEMA \"{other}\"");
            foreach (var schema in new[] { _schema, other })
            {
                await host.Client.ExecuteAsync(session, $"CREATE TABLE \"{schema}\".\"caminho\" (id integer PRIMARY KEY, status text)");
                await host.Client.ExecuteAsync(session, $"INSERT INTO \"{schema}\".\"caminho\" VALUES (1, 'aberta')");
            }

            await host.Client.ExecuteAsync(session, $"SET search_path TO \"{_schema}\"");
            var first = (await host.Client.ExecuteAsync(session, "SELECT * FROM caminho")).GetProperty("resultID").GetGuid();
            var target = await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edit-target"), new { resultID = first }), HttpStatusCode.OK);
            Assert.That(target.GetProperty("tables")[0].GetProperty("schema").GetString(), Is.EqualTo(_schema));
            Assert.That(target.GetProperty("rowOperations").GetBoolean(), Is.True);

            await ReadAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries"), new { sql = $"SET search_path TO \"{other}\"", keep = new[] { first } }), HttpStatusCode.OK);

            var changes = new object[] { new { kind = "update", table = 0, key = new[] { "1" }, set = new[] { new { column = 1, value = (string?)"mudou" } } } };
            var refused = await ProblemAsync(await host.Client.PostAsJsonAsync(Url(session, "/queries/edits"), new { resultID = first, changes }), HttpStatusCode.Conflict, "RESULT_CHANGED");
            Assert.That(refused.GetProperty("detail").GetString(), Is.EqualTo("A tabela caminho mudou desde a consulta (a chave, as colunas ou o tipo delas). Nada foi gravado; execute o comando de novo."));

            foreach (var schema in new[] { _schema, other })
            {
                var rows = (await host.Client.ExecuteAsync(session, $"SELECT id, status FROM \"{schema}\".\"caminho\"")).GetProperty("rows").ToString();
                Assert.That(rows, Is.EqualTo("""[["1","aberta"]]"""), schema);
            }
        }
        finally
        {
            await host.Client.ExecuteAsync(session, $"DROP SCHEMA IF EXISTS \"{other}\" CASCADE");
            await host.Client.ExecuteAsync(session, $"DROP TABLE IF EXISTS \"{_schema}\".\"caminho\"");
        }
    }

    private async Task<Guid> StartSessionAsync(ApiHost host)
    {
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        return await host.Client.OpenSessionAsync(await host.Client.CreateConnectionAsync(_settings));
    }

    private static string Url(Guid sessionID, string tail)
        => $"{PrismCalls.SessionsPath}/{sessionID}{tail}";

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response, HttpStatusCode status)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(response.StatusCode, Is.EqualTo(status), body.ToString());

        return body;
    }

    private static async Task<JsonElement> ProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await ReadAsync(response, status);
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type), body.ToString());

        return body;
    }
}
