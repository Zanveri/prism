using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.IntegrationTesting.Api;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Journal;

/// <summary>
/// RN-HIST-002 a 007, RN-AUDIT-010 a 016 e RN-DIARIO-005 e 008: as rotas de `api/user/journal` pela API de verdade (`ApiHost`).
/// </summary>
[TestFixture]
[Category("Journal")]
[Parallelizable(ParallelScope.Self)]
public sealed class UserJournalControllerTests
{
    private const string JournalPath = "/api/user/journal";
    private const string ConnectionsPath = "/api/user/connections";
    private const string SignOutPath = "/api/public/sessions";
    private const string UserPassword = "senha-forte-do-usuario-123";

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(status));
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));
    }

    private static async Task<Guid> CreateConnectionAsync(ApiHost host, string name = "MES Produção", string database = "mes_prod", string? environmentName = "Produção", string? environmentColor = "#EF4444")
    {
        var response = await host.Client.PostAsJsonAsync(ConnectionsPath, new
        {
            folderID = (Guid?)null,
            name,
            engine = 1,
            host = "pg.local",
            port = 5432,
            database,
            userName = "operador",
            password = "senha-banco-123",
            environmentName,
            environmentColor
        });
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        var json = await ReadJsonAsync(response);

        return json.GetProperty("id").GetGuid();
    }

    [Test]
    public async Task History_DefaultsToConnection_LimitAndCursor()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("ana", UserPassword);

        var journal = host.Services.GetRequiredService<IJournalService>();
        var connA = Guid.NewGuid();
        var connB = Guid.NewGuid();
        var snapA = new JournalConnectionSnapshot(connA, "Conexão A", "PostgreSQL", null, "Produção", "red", "db_a");
        var snapB = new JournalConnectionSnapshot(connB, "Conexão B", "PostgreSQL", null, "Homologação", "amber", "db_b");
        var now = new DateTimeOffset(2026, 10, 30, 14, 0, 0, TimeSpan.Zero);

        journal.Record(
            new JournalEntryStart(now.AddSeconds(1), EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", snapA, SqlText: "SELECT 1", HistoryText: "SELECT 1"),
            new JournalEntryEnd(now.AddSeconds(1).AddMilliseconds(10), 10, EJournalOutcome.Ok, RowCount: 1));
        journal.Record(
            new JournalEntryStart(now.AddSeconds(2), EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", snapB, SqlText: "SELECT 99", HistoryText: "SELECT 99"),
            new JournalEntryEnd(now.AddSeconds(2).AddMilliseconds(10), 10, EJournalOutcome.Ok, RowCount: 1));
        journal.Record(
            new JournalEntryStart(now.AddSeconds(3), EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", snapA, SqlText: "SELECT 2", HistoryText: "SELECT 2"),
            new JournalEntryEnd(now.AddSeconds(3).AddMilliseconds(15), 15, EJournalOutcome.Ok, RowCount: 2));
        journal.Record(
            new JournalEntryStart(now.AddSeconds(4), EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", snapA, SqlText: "SELECT 3", HistoryText: "SELECT 3"),
            new JournalEntryEnd(now.AddSeconds(4).AddMilliseconds(20), 20, EJournalOutcome.Ok, RowCount: 3));

        var firstResponse = await host.Client.GetAsync($"{JournalPath}/history?connectionId={connA}&limit=2");
        Assert.That(firstResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var firstPage = await ReadJsonAsync(firstResponse);
        var firstItems = firstPage.GetProperty("items").EnumerateArray().ToList();

        Assert.That(firstItems, Has.Count.EqualTo(2));
        Assert.That(firstItems[0].GetProperty("text").GetString(), Is.EqualTo("SELECT 3"));
        Assert.That(firstItems[1].GetProperty("text").GetString(), Is.EqualTo("SELECT 2"));
        Assert.That(firstPage.GetProperty("next").ValueKind, Is.EqualTo(JsonValueKind.Number));

        var nextCursor = firstPage.GetProperty("next").GetInt64();
        var secondResponse = await host.Client.GetAsync($"{JournalPath}/history?connectionId={connA}&before={nextCursor}&limit=2");
        Assert.That(secondResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var secondPage = await ReadJsonAsync(secondResponse);
        var secondItems = secondPage.GetProperty("items").EnumerateArray().ToList();

        Assert.That(secondItems, Has.Count.EqualTo(1));
        Assert.That(secondItems[0].GetProperty("text").GetString(), Is.EqualTo("SELECT 1"));
        Assert.That(secondPage.GetProperty("next").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    [Test]
    public async Task History_CollapsesConsecutiveRepeats()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("ana", UserPassword);

        var journal = host.Services.GetRequiredService<IJournalService>();
        var connId = Guid.NewGuid();
        var snap = new JournalConnectionSnapshot(connId, "MES Produção", "PostgreSQL", "Fábrica", "Produção", "red", "mes_prod");
        var t1 = new DateTimeOffset(2026, 10, 30, 14, 0, 0, TimeSpan.Zero);
        var t2 = t1.AddMinutes(2);
        var t3 = t1.AddMinutes(5);

        journal.Record(
            new JournalEntryStart(t1, EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", snap, SqlText: "SELECT * FROM apontamento WHERE turno = $1", HistoryText: "SELECT * FROM apontamento WHERE turno = @turno"),
            new JournalEntryEnd(t1.AddMilliseconds(50), 50, EJournalOutcome.Ok, RowCount: 10));
        journal.Record(
            new JournalEntryStart(t2, EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", snap, SqlText: "SELECT * FROM apontamento WHERE turno = $1", HistoryText: "SELECT * FROM apontamento WHERE turno = @turno"),
            new JournalEntryEnd(t2.AddMilliseconds(60), 60, EJournalOutcome.Ok, RowCount: 12));
        journal.Record(
            new JournalEntryStart(t3, EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", snap, SqlText: "SELECT * FROM apontamento WHERE turno = $1", HistoryText: "SELECT * FROM apontamento WHERE turno = @turno"),
            new JournalEntryEnd(t3.AddMilliseconds(70), 70, EJournalOutcome.Ok, RowCount: 15));

        var response = await host.Client.GetAsync($"{JournalPath}/history?connectionId={connId}");
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var page = await ReadJsonAsync(response);
        var items = page.GetProperty("items").EnumerateArray().ToList();

        Assert.That(items, Has.Count.EqualTo(1));
        Assert.That(items[0].GetProperty("text").GetString(), Is.EqualTo("SELECT * FROM apontamento WHERE turno = @turno"));
        Assert.That(items[0].GetProperty("repeat").GetInt32(), Is.EqualTo(3));
        Assert.That(DateTimeOffset.Parse(items[0].GetProperty("lastAt").GetString()!), Is.EqualTo(t3));
        Assert.That(items[0].GetProperty("rows").GetInt64(), Is.EqualTo(15));
    }

    [Test]
    public async Task History_SearchTreatsWildcardsLiterally_AndIgnoresAccents()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("ana", UserPassword);

        var journal = host.Services.GetRequiredService<IJournalService>();
        var connId = Guid.NewGuid();
        var snap = new JournalConnectionSnapshot(connId, "MES", "PostgreSQL", null, null, null, "mes");
        var now = new DateTimeOffset(2026, 10, 30, 14, 0, 0, TimeSpan.Zero);

        journal.Record(
            new JournalEntryStart(now, EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", snap, SqlText: "SELECT * FROM producao_diaria -- Produção 100%", HistoryText: "SELECT * FROM producao_diaria -- Produção 100%"),
            new JournalEntryEnd(now.AddMilliseconds(10), 10, EJournalOutcome.Ok, RowCount: 1));
        journal.Record(
            new JournalEntryStart(now.AddSeconds(1), EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", snap, SqlText: "SELECT * FROM producaoxdiaria -- 1000", HistoryText: "SELECT * FROM producaoxdiaria -- 1000"),
            new JournalEntryEnd(now.AddSeconds(1).AddMilliseconds(10), 10, EJournalOutcome.Ok, RowCount: 1));

        // Busca sem acento encontra "Produção".
        var accentResponse = await host.Client.GetAsync($"{JournalPath}/history?q=producao%20100%25");
        Assert.That(accentResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var accentItems = (await ReadJsonAsync(accentResponse)).GetProperty("items").EnumerateArray().ToList();
        Assert.That(accentItems, Has.Count.EqualTo(1));
        Assert.That(accentItems[0].GetProperty("text").GetString(), Does.Contain("Produção 100%"));

        // `_` e `%` são tratados literalmente, então `producao_diaria` não casa `producaoxdiaria`.
        var underscoreResponse = await host.Client.GetAsync($"{JournalPath}/history?q=producao_diaria");
        Assert.That(underscoreResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var underscoreItems = (await ReadJsonAsync(underscoreResponse)).GetProperty("items").EnumerateArray().ToList();
        Assert.That(underscoreItems, Has.Count.EqualTo(1));
        Assert.That(underscoreItems[0].GetProperty("text").GetString(), Does.Contain("producao_diaria"));
    }

    [Test]
    public async Task History_OnlyUserOrigins()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("ana", UserPassword);

        var journal = host.Services.GetRequiredService<IJournalService>();
        var connId = Guid.NewGuid();
        var snap = new JournalConnectionSnapshot(connId, "MES", "PostgreSQL", null, null, null, "mes");
        var now = new DateTimeOffset(2026, 10, 30, 14, 0, 0, TimeSpan.Zero);

        var origins = new[] { "editor", "script", "values", "statement", "rerun", "filter", "auto-refresh", "other" };
        for (var index = 0; index < origins.Length; index++)
        {
            var origin = origins[index];
            journal.Record(
                new JournalEntryStart(now.AddSeconds(index), EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", origin, snap, SqlText: $"SELECT '{origin}'", HistoryText: $"SELECT '{origin}'"),
                new JournalEntryEnd(now.AddSeconds(index).AddMilliseconds(5), 5, EJournalOutcome.Ok, RowCount: 1));
        }

        var response = await host.Client.GetAsync($"{JournalPath}/history?connectionId={connId}");
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var items = (await ReadJsonAsync(response)).GetProperty("items").EnumerateArray().Select(item => item.GetProperty("text").GetString()).ToList();

        Assert.That(items, Is.EquivalentTo(new[] { "SELECT 'editor'", "SELECT 'script'", "SELECT 'values'", "SELECT 'statement'" }));
    }

    [Test]
    public async Task Hide_RemovesFromHistory_KeepsInAudit()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("ana", UserPassword);

        var journal = host.Services.GetRequiredService<IJournalService>();
        var connId = Guid.NewGuid();
        var snap = new JournalConnectionSnapshot(connId, "MES", "PostgreSQL", null, null, null, "mes");
        var now = new DateTimeOffset(2026, 10, 30, 14, 0, 0, TimeSpan.Zero);

        journal.Record(
            new JournalEntryStart(now, EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", snap, SqlText: "SELECT 1", HistoryText: "SELECT 1"),
            new JournalEntryEnd(now.AddMilliseconds(5), 5, EJournalOutcome.Ok, RowCount: 1));
        journal.Record(
            new JournalEntryStart(now.AddSeconds(1), EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", snap, SqlText: "SELECT 2", HistoryText: "SELECT 2"),
            new JournalEntryEnd(now.AddSeconds(1).AddMilliseconds(5), 5, EJournalOutcome.Ok, RowCount: 1));

        var initialHistory = await ReadJsonAsync(await host.Client.GetAsync($"{JournalPath}/history?connectionId={connId}"));
        var firstId = initialHistory.GetProperty("items")[0].GetProperty("id").GetInt64();

        var deleteOne = await host.Client.DeleteAsync($"{JournalPath}/history/{firstId}");
        Assert.That(deleteOne.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        var deleteMissing = await host.Client.DeleteAsync($"{JournalPath}/history/999999");
        await AssertProblemAsync(deleteMissing, HttpStatusCode.NotFound, "JOURNAL_ENTRY_NOT_FOUND");

        var afterOneHistory = await ReadJsonAsync(await host.Client.GetAsync($"{JournalPath}/history?connectionId={connId}"));
        Assert.That(afterOneHistory.GetProperty("items").GetArrayLength(), Is.EqualTo(1));

        var deleteConnection = await host.Client.DeleteAsync($"{JournalPath}/history?connectionId={connId}");
        Assert.That(deleteConnection.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        var afterConnHistory = await ReadJsonAsync(await host.Client.GetAsync($"{JournalPath}/history?connectionId={connId}"));
        Assert.That(afterConnHistory.GetProperty("items").GetArrayLength(), Is.EqualTo(0));

        // Ambos os comandos continuam na Auditoria (mais o registro de "Conta criada" da criação do usuário).
        var auditResponse = await host.Client.GetAsync($"{JournalPath}/audit?kind=sql&connectionId={connId}");
        Assert.That(auditResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var auditPage = await ReadJsonAsync(auditResponse);
        Assert.That(auditPage.GetProperty("total").GetInt64(), Is.EqualTo(2));
    }

    [Test]
    public async Task Audit_AllFilters_AndTotal()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("ana", UserPassword);

        var journal = host.Services.GetRequiredService<IJournalService>();
        var connProd = Guid.NewGuid();
        var connHom = Guid.NewGuid();
        var scriptRunId = Guid.NewGuid();
        var snapProd = new JournalConnectionSnapshot(connProd, "MES Produção", "PostgreSQL", "Fábrica", "Produção", "red", "mes_prod");
        var snapHom = new JournalConnectionSnapshot(connHom, "MES Homolog", "PostgreSQL", null, null, null, "mes_hom");
        var t0 = new DateTimeOffset(2026, 10, 30, 10, 0, 0, TimeSpan.Zero);

        journal.Record(
            new JournalEntryStart(t0, EJournalKind.Sql, "DELETE", EJournalLevel.Critical, "DELETE sem WHERE: apaga todas as linhas de producao.apontamento.", "script", snapProd, ScriptRunId: scriptRunId, SqlText: "DELETE FROM producao.apontamento;", Confirmed: true, Protections: "Confirmar: só irreversíveis · Somente leitura: não"),
            new JournalEntryEnd(t0.AddMilliseconds(120), 120, EJournalOutcome.Ok, RowCount: 1204));
        journal.Record(
            new JournalEntryStart(t0.AddHours(1), EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", snapHom, SqlText: "SELECT 1;"),
            new JournalEntryEnd(t0.AddHours(1).AddMilliseconds(10), 10, EJournalOutcome.Ok, RowCount: 1));

        var queryUrl = $"{JournalPath}/audit?from={Uri.EscapeDataString(t0.AddMinutes(-5).ToString("O"))}&to={Uri.EscapeDataString(t0.AddMinutes(5).ToString("O"))}&connectionId={connProd}&environment=Produ%C3%A7%C3%A3o&level=critical&kind=sql&outcome=ok&q=apontamento&scriptRunId={scriptRunId}";
        var response = await host.Client.GetAsync(queryUrl);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var page = await ReadJsonAsync(response);

        Assert.That(page.GetProperty("total").GetInt64(), Is.EqualTo(1));
        var item = page.GetProperty("items")[0];
        Assert.That(item.GetProperty("action").GetString(), Is.EqualTo("DELETE"));
        Assert.That(item.GetProperty("level").GetString(), Is.EqualTo("critical"));
        Assert.That(item.GetProperty("kind").GetString(), Is.EqualTo("sql"));
        Assert.That(item.GetProperty("outcome").GetString(), Is.EqualTo("ok"));

        var detailId = item.GetProperty("id").GetInt64();
        var detailResponse = await host.Client.GetAsync($"{JournalPath}/audit/{detailId}");
        Assert.That(detailResponse.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var detail = await ReadJsonAsync(detailResponse);
        Assert.That(detail.GetProperty("sql").GetString(), Is.EqualTo("DELETE FROM producao.apontamento;"));
        Assert.That(detail.GetProperty("confirmed").GetBoolean(), Is.True);
        Assert.That(detail.GetProperty("scriptRunId").GetGuid(), Is.EqualTo(scriptRunId));
    }

    [Test]
    public async Task Audit_LimitAbove500_IsFilterInvalid()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("ana", UserPassword);

        var response = await host.Client.GetAsync($"{JournalPath}/audit?limit=501");

        await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "JOURNAL_FILTER_INVALID");
    }

    [Test]
    public async Task AuditFacets_IncludeDeletedConnections_Marked()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("ana", UserPassword);

        var activeId = await CreateConnectionAsync(host, "Ativa", "db_ativa", "Produção", "#EF4444");
        var deletedId = await CreateConnectionAsync(host, "Antiga", "db_antiga", "Homologação", "#F59E0B");

        var deleteResp = await host.Client.DeleteAsync($"{ConnectionsPath}/{deletedId}");
        Assert.That(deleteResp.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        var facetsResp = await host.Client.GetAsync($"{JournalPath}/audit/facets");
        Assert.That(facetsResp.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var facets = await ReadJsonAsync(facetsResp);

        var connections = facets.GetProperty("connections").EnumerateArray().ToList();
        var activeFacet = connections.Single(c => c.GetProperty("id").GetGuid() == activeId);
        var deletedFacet = connections.Single(c => c.GetProperty("id").GetGuid() == deletedId);

        Assert.That(activeFacet.GetProperty("deleted").GetBoolean(), Is.False);
        Assert.That(deletedFacet.GetProperty("deleted").GetBoolean(), Is.True);
        var environmentNames = facets.GetProperty("environments").EnumerateArray().Select(env => env.GetProperty("name").GetString()).ToList();
        Assert.That(environmentNames, Is.EquivalentTo(new[] { "Homologação", "Produção" }));
        Assert.That(facets.GetProperty("count").GetInt64(), Is.GreaterThanOrEqualTo(3));
        Assert.That(facets.GetProperty("sizeBytes").GetInt64(), Is.GreaterThan(0));
    }

    [Test]
    public async Task Settings_InvalidRetention_IsSettingsInvalid()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("ana", UserPassword);

        var response = await host.Client.PutAsJsonAsync($"{JournalPath}/settings", new { retentionDays = 45 });

        await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "JOURNAL_SETTINGS_INVALID");
    }

    [Test]
    public async Task Settings_Shorten_RecordsHigh()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("ana", UserPassword);

        var getInitial = await ReadJsonAsync(await host.Client.GetAsync($"{JournalPath}/settings"));
        Assert.That(getInitial.GetProperty("retentionDays").GetInt32(), Is.EqualTo(90));

        var shortenResp = await host.Client.PutAsJsonAsync($"{JournalPath}/settings", new { retentionDays = 30 });
        Assert.That(shortenResp.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var shortened = await ReadJsonAsync(shortenResp);
        Assert.That(shortened.GetProperty("retentionDays").GetInt32(), Is.EqualTo(30));

        var auditResp = await ReadJsonAsync(await host.Client.GetAsync($"{JournalPath}/audit?kind=security&level=high"));
        var items = auditResp.GetProperty("items").EnumerateArray().ToList();
        Assert.That(items.Any(item => item.GetProperty("action").GetString() == "Guarda do diário encurtada"), Is.True);
    }

    [Test]
    public async Task Purge_WrongPassword_422_CountsTowardFive()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("ana", UserPassword);

        var before = new DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero);

        for (var attempt = 1; attempt <= 4; attempt++)
        {
            var wrong = await host.Client.PostAsJsonAsync($"{JournalPath}/audit/purge", new { before, password = "senha-errada-qualquer" });
            await AssertProblemAsync(wrong, HttpStatusCode.UnprocessableEntity, "INVALID_PASSWORD");
        }

        var fifth = await host.Client.PostAsJsonAsync($"{JournalPath}/audit/purge", new { before, password = "senha-errada-qualquer" });
        await AssertProblemAsync(fifth, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    [Test]
    public async Task Purge_DeletesBefore_AndRecordsCritical()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("ana", UserPassword);

        var journal = host.Services.GetRequiredService<IJournalService>();
        var oldDate = new DateTimeOffset(2026, 8, 15, 10, 0, 0, TimeSpan.Zero);
        var cutoff = new DateTimeOffset(2026, 9, 1, 0, 0, 0, TimeSpan.Zero);

        journal.Record(
            new JournalEntryStart(oldDate, EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", SqlText: "SELECT 'antigo'"),
            new JournalEntryEnd(oldDate.AddMilliseconds(5), 5, EJournalOutcome.Ok, RowCount: 1));
        journal.Record(
            new JournalEntryStart(oldDate.AddMinutes(1), EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", SqlText: "SELECT 'antigo 2'"),
            new JournalEntryEnd(oldDate.AddMinutes(1).AddMilliseconds(5), 5, EJournalOutcome.Ok, RowCount: 1));

        var purgeResp = await host.Client.PostAsJsonAsync($"{JournalPath}/audit/purge", new { before = cutoff, password = UserPassword });
        Assert.That(purgeResp.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var purgeBody = await ReadJsonAsync(purgeResp);
        Assert.That(purgeBody.GetProperty("deleted").GetInt64(), Is.EqualTo(2));

        var auditResp = await ReadJsonAsync(await host.Client.GetAsync($"{JournalPath}/audit?level=critical"));
        var items = auditResp.GetProperty("items").EnumerateArray().ToList();
        Assert.That(items, Has.Count.EqualTo(1));
        Assert.That(items[0].GetProperty("action").GetString(), Is.EqualTo("2 registros apagados, anteriores a 01/09/2026"));
    }

    [Test]
    public async Task LockedVault_401()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("ana", UserPassword);

        var signOut = await host.Client.DeleteAsync(SignOutPath);
        Assert.That(signOut.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        var response = await host.Client.GetAsync($"{JournalPath}/history");

        await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    [Test]
    public async Task UnavailableJournal_503()
    {
        await using var host = await ApiHost.StartAsync();
        await File.WriteAllTextAsync(Path.Combine(host.DataDirectory, "journal"), "bloqueio");

        await host.CreateUserAsync("ana", UserPassword);

        var response = await host.Client.GetAsync($"{JournalPath}/history");

        await AssertProblemAsync(response, HttpStatusCode.ServiceUnavailable, "JOURNAL_UNAVAILABLE");
    }
}
