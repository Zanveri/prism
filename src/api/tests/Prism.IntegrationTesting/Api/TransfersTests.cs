using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Fakers.Users;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// As rotas `api/user/transfers` (seção 6 e RN-EXPORT-016 a 018), pela API de verdade contra o PostgreSQL de teste com a carga `loja`: o 202 antes do
/// banco, o trabalho até o `done` com o arquivo pronto na pasta `transfers` da pasta de dados, o `DELETE` que esquece e apaga, e as recusas antes do
/// trabalho. Cada teste sobe uma API própria, com o cofre e a pasta de dados próprios.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class TransfersTests
{
    private const string UserName = "marina.costa";
    private const string TransfersPath = "/api/user/transfers";
    private const string ExportsPath = "/api/user/transfers/exports";

    private ConnectionSettings _settings = null!;

    [OneTimeSetUp]
    public async Task StartAsync()
        => _settings = await PostgresSingleton.GetSettingsAsync();

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<JsonElement> AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(status), body.ToString());
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));

        return body;
    }

    private async Task<Guid> StartUserAsync(ApiHost host)
    {
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());

        return await host.Client.CreateConnectionAsync(_settings);
    }

    private static object TableExport(Guid connectionID, string format = "csv", object? options = null, object? output = null)
        => new
        {
            source = new { kind = "table", connectionID, schema = "loja", table = "cliente" },
            columns = new[] { new { position = 0, name = "id" }, new { position = 1, name = "nome" } },
            count = true,
            format,
            options,
            output = output ?? new { bom = false, zip = false, clipboard = false },
            windowID = 1
        };

    private static async Task<Guid> StartExportAsync(ApiHost host, object request)
    {
        var response = await host.Client.PostAsJsonAsync(ExportsPath, request);
        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Accepted), body.ToString());

        return body.GetProperty("id").GetGuid();
    }

    /// <summary>Consulta o trabalho como a tela, até ele sair do `running`.</summary>
    private static async Task<JsonElement> WaitForEndAsync(ApiHost host, Guid id)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (true)
        {
            var response = await host.Client.GetAsync($"{TransfersPath}/{id}");
            var body = await ReadJsonAsync(response);
            Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());

            if (body.GetProperty("state").GetString() != "running")
                return body;

            Assert.That(DateTime.UtcNow, Is.LessThan(deadline), "O trabalho não terminou em 30 segundos.");
            await Task.Delay(100);
        }
    }

    private static string ReadyPath(ApiHost host, Guid id)
        => Path.Combine(host.DataDirectory, "transfers", $"{id:D}.ready");

    /// <summary>RN-API-005: as rotas novas ficam atrás da barreira do cofre.</summary>
    [Test]
    public async Task Routes_WithVaultLocked_Return401VaultLocked()
    {
        await using var host = await ApiHost.StartAsync();
        var id = Guid.CreateVersion7();
        var routes = new (HttpMethod Method, string Path)[]
        {
            (HttpMethod.Post, ExportsPath),
            (HttpMethod.Get, TransfersPath),
            (HttpMethod.Get, $"{TransfersPath}/{id}"),
            (HttpMethod.Delete, $"{TransfersPath}/{id}")
        };

        foreach (var (method, path) in routes)
            await AssertProblemAsync(await host.Client.SendAsync(new HttpRequestMessage(method, path)), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    [Test]
    public async Task Export_Table_Returns202_AndEndsDoneWithTheReadyFile()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host);

        var id = await StartExportAsync(host, TableExport(connectionID, output: new { bom = true, zip = false, clipboard = false }));
        var done = await WaitForEndAsync(host, id);

        Assert.That(done.GetProperty("state").GetString(), Is.EqualTo("done"), done.ToString());
        Assert.That(done.GetProperty("kind").GetString(), Is.EqualTo("export"));
        Assert.That(done.GetProperty("connectionID").GetGuid(), Is.EqualTo(connectionID));
        Assert.That(done.GetProperty("windowID").GetInt64(), Is.EqualTo(1));
        Assert.That(done.GetProperty("rows").GetInt64(), Is.EqualTo(10));
        Assert.That(done.GetProperty("total").GetInt64(), Is.EqualTo(10));
        Assert.That(done.GetProperty("error").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(done.GetProperty("targetConnectionID").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(done.GetProperty("uncertain").GetBoolean(), Is.False);
        var summary = done.GetProperty("summary");
        Assert.That(summary.GetProperty("rows").GetInt64(), Is.EqualTo(10));
        Assert.That(summary.GetProperty("sheets").ValueKind, Is.EqualTo(JsonValueKind.Null));

        var bytes = await File.ReadAllBytesAsync(ReadyPath(host, id));
        Assert.That(summary.GetProperty("bytes").GetInt64(), Is.EqualTo(bytes.Length));
        Assert.That(bytes.Take(3), Is.EqualTo(new byte[] { 0xEF, 0xBB, 0xBF }));
        var lines = Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3).Split("\r\n");
        Assert.That(lines[0], Is.EqualTo("id;nome"));
        Assert.That(lines[1], Is.EqualTo("1;Cliente 1"));
        Assert.That(lines, Has.Length.EqualTo(12));

        var list = await ReadJsonAsync(await host.Client.GetAsync(TransfersPath));
        Assert.That(list.EnumerateArray().Select(transfer => transfer.GetProperty("id").GetGuid()), Is.EqualTo(new[] { id }));
    }

    /// <summary>RN-EXPORT-016: o `DELETE` do trabalho que terminou o esquece e apaga o arquivo; depois dele, o trabalho é 404.</summary>
    [Test]
    public async Task Delete_Done_Returns204_AndForgetsTheTransferAndItsFile()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host);
        var id = await StartExportAsync(host, TableExport(connectionID));
        await WaitForEndAsync(host, id);

        var response = await host.Client.DeleteAsync($"{TransfersPath}/{id}");

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(File.Exists(ReadyPath(host, id)), Is.False);
        await AssertProblemAsync(await host.Client.GetAsync($"{TransfersPath}/{id}"), HttpStatusCode.NotFound, "TRANSFER_NOT_FOUND");
        await AssertProblemAsync(await host.Client.DeleteAsync($"{TransfersPath}/{id}"), HttpStatusCode.NotFound, "TRANSFER_NOT_FOUND");
    }

    /// <summary>RN-EXPORT-002 e 014: o resultado com o filtro junto, num .zip com o nome do arquivo dentro dele.</summary>
    [Test]
    public async Task Export_QueryWithFilter_IntoZip_WritesTheFilteredRows()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host);
        var request = new
        {
            source = new { kind = "query", connectionID, sql = "SELECT numero, observacao FROM loja.pedido ORDER BY numero", filter = "numero <= 1003", name = "pedido" },
            columns = new[] { new { position = 0, name = "numero" }, new { position = 1, name = "observacao" } },
            count = false,
            format = "json",
            output = new { bom = false, zip = true, entryName = "pedido.json", clipboard = false },
            windowID = 3
        };

        var id = await StartExportAsync(host, request);
        var done = await WaitForEndAsync(host, id);

        Assert.That(done.GetProperty("state").GetString(), Is.EqualTo("done"), done.ToString());
        Assert.That(done.GetProperty("total").ValueKind, Is.EqualTo(JsonValueKind.Null));
        using var zip = ZipFile.OpenRead(ReadyPath(host, id));
        var entry = zip.Entries.Single();
        Assert.That(entry.FullName, Is.EqualTo("pedido.json"));
        using var reader = new StreamReader(entry.Open(), Encoding.UTF8);
        var json = JsonDocument.Parse(await reader.ReadToEndAsync()).RootElement;
        var rows = json.GetProperty("pedido").EnumerateArray().ToList();
        Assert.That(rows.Select(row => row.GetProperty("numero").GetInt32()), Is.EqualTo(new[] { 1001, 1002, 1003 }));
    }

    /// <summary>RN-EXPORT-017: o erro do banco vem como veio, com o SQLSTATE, no trabalho que falhou.</summary>
    [Test]
    public async Task Export_DatabaseError_EndsFailedWithTheDatabaseMessage()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host);
        var request = new
        {
            source = new { kind = "query", connectionID, sql = "SELECT * FROM loja.nao_existe" },
            columns = new[] { new { position = 0, name = "id" } },
            count = false,
            format = "csv",
            output = new { bom = false, zip = false, clipboard = false },
            windowID = 1
        };

        var id = await StartExportAsync(host, request);
        var failed = await WaitForEndAsync(host, id);

        Assert.That(failed.GetProperty("state").GetString(), Is.EqualTo("failed"), failed.ToString());
        var error = failed.GetProperty("error");
        Assert.That(error.GetProperty("code").GetString(), Is.EqualTo("SQL_EXECUTION_FAILED"));
        Assert.That(error.GetProperty("message").GetString(), Does.Contain("nao_existe"));
        Assert.That(error.GetProperty("sqlState").GetString(), Is.EqualTo("42P01"));
        Assert.That(File.Exists(ReadyPath(host, id)), Is.False);
    }

    /// <summary>Seção 6: as recusas da forma do pedido vêm no campo, pelo caminho em camelCase, todas de uma vez.</summary>
    [Test]
    public async Task Export_InvalidOptions_Returns422OnTheirFields()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host);

        var response = await host.Client.PostAsJsonAsync(ExportsPath, TableExport(connectionID, format: "txt", options: new { minWidth = 0, maxWidth = 100001 }));

        var body = await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "EXPORT_OPTIONS_INVALID");
        Assert.That(body.GetProperty("errors").EnumerateObject().Select(field => field.Name), Is.EquivalentTo(new[] { "options.minWidth", "options.maxWidth" }));
        Assert.That(body.GetProperty("errorCodes").GetProperty("options.minWidth")[0].GetString(), Is.EqualTo("EXPORT_OPTIONS_INVALID"));
    }

    [Test]
    public async Task Export_NotARead_Returns422ExportSourceNotRead_WithoutGoingToTheDatabase()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host);
        var request = new
        {
            source = new { kind = "query", connectionID, sql = "DELETE FROM loja.pedido" },
            columns = new[] { new { position = 0, name = "id" } },
            count = false,
            format = "csv",
            output = new { bom = false, zip = false, clipboard = false },
            windowID = 1
        };

        var response = await host.Client.PostAsJsonAsync(ExportsPath, request);

        var body = await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "EXPORT_SOURCE_NOT_READ");
        Assert.That(body.GetProperty("reason").GetString(), Is.Not.Empty);
        var list = await ReadJsonAsync(await host.Client.GetAsync(TransfersPath));
        Assert.That(list.GetArrayLength(), Is.Zero);
    }

    [Test]
    public async Task Export_UnknownConnection_Returns404ConnectionNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await StartUserAsync(host);

        var response = await host.Client.PostAsJsonAsync(ExportsPath, TableExport(Guid.CreateVersion7()));

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
    }

    [Test]
    public async Task Get_Unknown_Returns404TransferNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await StartUserAsync(host);

        await AssertProblemAsync(await host.Client.GetAsync($"{TransfersPath}/{Guid.CreateVersion7()}"), HttpStatusCode.NotFound, "TRANSFER_NOT_FOUND");
    }

    /// <summary>RN-EXPORT-016: excluir a conexão cancela as exportações dela, com o motivo `connectionDeleted`.</summary>
    [Test]
    public async Task DeleteConnection_CancelsItsExports()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host);
        var request = new
        {
            source = new { kind = "query", connectionID, sql = "SELECT numero, pg_sleep(0.05) AS espera FROM generate_series(1, 2000) AS numero" },
            columns = new[] { new { position = 0, name = "numero" } },
            count = false,
            format = "csv",
            output = new { bom = false, zip = false, clipboard = false },
            windowID = 1
        };
        var id = await StartExportAsync(host, request);

        var deleted = await host.Client.DeleteAsync($"/api/user/connections/{connectionID}");
        var canceled = await WaitForEndAsync(host, id);

        Assert.That(deleted.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(canceled.GetProperty("state").GetString(), Is.EqualTo("canceled"), canceled.ToString());
        Assert.That(canceled.GetProperty("reason").GetString(), Is.EqualTo("connectionDeleted"));
    }
}
