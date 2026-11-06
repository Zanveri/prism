using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// O Commit manual pelas rotas (seção 22: RN-TX-001 a 005, 009 e 013; `POST` e `PATCH database-sessions`, `transaction/commit` e `transaction/rollback`), pela
/// API de verdade contra o PostgreSQL de teste: o modo na abertura, o estado da transação em cada resposta e nas recusas, e o que fica no banco.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class ManualCommitTests
{
    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<JsonElement> AssertStatusAsync(HttpResponseMessage response, HttpStatusCode status, string? type = null)
    {
        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(status), body.ToString());
        if (type is not null)
            Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));

        return body;
    }

    private static string Count(JsonElement page)
        => page.GetProperty("rows")[0][0].GetString()!;

    [Test]
    public async Task ManualCommit_OpensConfirmsAndRefusesThroughTheRoutes()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("joana.lima", UserFakers.RandomPassword());
        var connection = await host.Client.CreateConnectionAsync(await PostgresSingleton.GetSettingsAsync());
        var table = $"loja.transacao_{Guid.NewGuid():N}";
        var auto = await host.Client.OpenSessionAsync(connection);
        await host.Client.ExecuteAsync(auto, $"CREATE TABLE {table} (id integer PRIMARY KEY)");

        try
        {
            // RN-TX-001: a sessão abre no modo pedido, sem transação até o primeiro comando.
            var opened = await AssertStatusAsync(await host.Client.PostAsJsonAsync(PrismCalls.SessionsPath, new { connectionID = connection, transactionMode = "manual" }), HttpStatusCode.Created);
            Assert.That((opened.GetProperty("transactionsAvailable").GetBoolean(), opened.GetProperty("transaction").GetProperty("mode").GetString(), opened.GetProperty("transaction").GetProperty("open").GetBoolean()), Is.EqualTo((true, "manual", false)));
            var session = opened.GetProperty("id").GetGuid();

            // RN-TX-004: em Auto-commit o BEGIN digitado abre a transação explícita na aba, o ROLLBACK a encerra, e as formas não suportadas são recusadas.
            var begin = await host.Client.ExecuteAsync(auto, "BEGIN");
            Assert.That((begin.GetProperty("transaction").GetProperty("mode").GetString(), begin.GetProperty("transaction").GetProperty("open").GetBoolean(), begin.GetProperty("transaction").GetProperty("commands").GetInt32()), Is.EqualTo(("autoCommit", true, 0)));
            var rolledBackAuto = await host.Client.ExecuteAsync(auto, "ROLLBACK");
            Assert.That(rolledBackAuto.GetProperty("transaction").GetProperty("open").GetBoolean(), Is.False);
            var unsupported = await AssertStatusAsync(await host.Client.ExecuteRawAsync(auto, "COMMIT PREPARED 'x'"), HttpStatusCode.UnprocessableEntity, "TRANSACTION_CONTROL_NOT_SUPPORTED");
            Assert.That(unsupported.GetProperty("detail").GetString(), Does.Contain("PREPARE TRANSACTION"));

            // RN-TX-002 e 003: o primeiro comando abre a transação; o que ele gravou não é visto por outra sessão até o Commit.
            var inserted = await host.Client.ExecuteAsync(session, $"INSERT INTO {table} VALUES (1)");
            var transaction = inserted.GetProperty("transaction");
            Assert.That((transaction.GetProperty("open").GetBoolean(), transaction.GetProperty("commands").GetInt32(), transaction.GetProperty("openedAt").ValueKind), Is.EqualTo((true, 1, JsonValueKind.String)));
            Assert.That(Count(await host.Client.ExecuteAsync(auto, $"SELECT COUNT(*) FROM {table}")), Is.EqualTo("0"));

            // RN-TX-005: com a transação aberta, a aba não passa a Auto-commit.
            var refused = await AssertStatusAsync(await host.Client.PatchAsJsonAsync(PrismCalls.SessionsPath, new { id = session, transactionMode = "autoCommit" }), HttpStatusCode.Conflict, "TRANSACTION_OPEN");
            Assert.That(refused.GetProperty("transaction").GetProperty("open").GetBoolean(), Is.True);

            var committed = await AssertStatusAsync(await host.Client.PostAsync($"{PrismCalls.SessionsPath}/{session}/transaction/commit", null), HttpStatusCode.OK);
            Assert.That((committed.GetProperty("commands").GetInt32(), committed.GetProperty("transaction").GetProperty("open").GetBoolean()), Is.EqualTo((1, false)));
            Assert.That(Count(await host.Client.ExecuteAsync(auto, $"SELECT COUNT(*) FROM {table}")), Is.EqualTo("1"));

            // RN-TX-009: no PostgreSQL o erro deixa a transação com erro; até o Rollback, o comando novo e o Commit são recusados sem ir ao banco.
            var failed = await AssertStatusAsync(await host.Client.ExecuteRawAsync(session, "SELEC 1"), HttpStatusCode.UnprocessableEntity, "SQL_EXECUTION_FAILED");
            Assert.That(failed.GetProperty("transaction").GetProperty("failed").GetBoolean(), Is.True);
            await AssertStatusAsync(await host.Client.ExecuteRawAsync(session, "SELECT 1"), HttpStatusCode.Conflict, "TRANSACTION_FAILED");
            await AssertStatusAsync(await host.Client.PostAsync($"{PrismCalls.SessionsPath}/{session}/transaction/commit", null), HttpStatusCode.Conflict, "TRANSACTION_FAILED");
            await AssertStatusAsync(await host.Client.PostAsync($"{PrismCalls.SessionsPath}/{session}/transaction/rollback", null), HttpStatusCode.OK);
            await AssertStatusAsync(await host.Client.PostAsync($"{PrismCalls.SessionsPath}/{session}/transaction/rollback", null), HttpStatusCode.Conflict, "NO_OPEN_TRANSACTION");

            // RN-TX-004: o COMMIT digitado é o botão, e responde como comando sem linhas.
            await host.Client.ExecuteAsync(session, $"INSERT INTO {table} VALUES (2)");
            var typed = await host.Client.ExecuteAsync(session, "COMMIT");
            Assert.That((typed.GetProperty("rowsAffected").GetInt32(), typed.GetProperty("transaction").GetProperty("open").GetBoolean()), Is.EqualTo((0, false)));
            Assert.That(Count(await host.Client.ExecuteAsync(auto, $"SELECT COUNT(*) FROM {table}")), Is.EqualTo("2"));

            var back = await AssertStatusAsync(await host.Client.PatchAsJsonAsync(PrismCalls.SessionsPath, new { id = session, transactionMode = "autoCommit" }), HttpStatusCode.OK);
            Assert.That(back.GetProperty("transaction").GetProperty("mode").GetString(), Is.EqualTo("autoCommit"));
            await AssertStatusAsync(await host.Client.PatchAsJsonAsync(PrismCalls.SessionsPath, new { id = session, transactionMode = "explicito" }), HttpStatusCode.UnprocessableEntity, "TRANSACTION_MODE_INVALID");
        }
        finally
        {
            await host.Client.ExecuteAsync(auto, $"DROP TABLE {table}");
        }
    }
}
