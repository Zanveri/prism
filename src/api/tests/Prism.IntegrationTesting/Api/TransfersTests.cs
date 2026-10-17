using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Fakers.Users;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;

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

    /// <summary>
    /// RN-EXPORT-011: o arquivo SQL volta para o banco. A tabela de origem tem o texto com aspa, barra invertida, quebra de linha, retorno de carro,
    /// tabulação, emoji e ideograma, o binário, o número grande, o real, o lógico, a data e hora com e sem fuso, a data, o texto vazio e o nulo; os
    /// `INSERT` de duas linhas por comando, executados um a um numa cópia vazia, dão as mesmas linhas, sem nenhuma de fora.
    /// </summary>
    [Test]
    public async Task Export_Sql_RunsBackIntoACopyOfTheTable()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host);
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var (source, copy) = ($"exporta_sql_{suffix}", $"copia_sql_{suffix}");
        const string Shape = "(id INTEGER PRIMARY KEY, texto TEXT, dado BYTEA, valor NUMERIC(30, 10), fracao DOUBLE PRECISION, ativo BOOLEAN, momento TIMESTAMP, zona TIMESTAMPTZ, dia DATE)";
        await using var database = await DatabaseObserver.OpenAsync(_settings);
        await database.ExecuteAsync($"CREATE TABLE loja.{source} {Shape}");
        await database.ExecuteAsync($"CREATE TABLE loja.{copy} {Shape}");

        try
        {
            await database.ExecuteAsync($@"INSERT INTO loja.{source} VALUES
                (1, E'O''Brien \\ a\nb\rc\td 🙂 漢字', '\x00ff10'::BYTEA, 12345678901234567890.0123456789, 0.1, TRUE, '2024-01-15 10:30:00.123456', '2024-01-15 10:30:00+00', '2024-01-15'),
                (2, '', '\x'::BYTEA, -0.5, 1e300, FALSE, NULL, NULL, NULL),
                (3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)");
            string[] names = ["id", "texto", "dado", "valor", "fracao", "ativo", "momento", "zona", "dia"];
            var request = new
            {
                source = new { kind = "query", connectionID, sql = $"SELECT * FROM loja.{source} ORDER BY id", name = source },
                columns = names.Select((name, position) => new { position, name }).ToArray(),
                count = true,
                format = "sql",
                options = new { schema = "loja", table = copy, rowsPerStatement = 2 },
                output = new { bom = false, zip = false, clipboard = false },
                windowID = 1
            };

            var id = await StartExportAsync(host, request);
            var done = await WaitForEndAsync(host, id);
            Assert.That(done.GetProperty("state").GetString(), Is.EqualTo("done"), done.ToString());
            Assert.That(done.GetProperty("summary").GetProperty("skippedRows").GetInt64(), Is.Zero);

            var script = await File.ReadAllTextAsync(ReadyPath(host, id), Encoding.UTF8);
            await TestContext.Out.WriteLineAsync(script);
            var statements = script.Split(";\n", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            Assert.That(statements, Has.Length.EqualTo(2));
            Assert.That(statements[0], Does.StartWith($"INSERT INTO \"loja\".\"{copy}\" (\"id\", \"texto\", \"dado\""));
            foreach (var statement in statements)
                await database.ExecuteAsync(statement);

            Assert.That(await database.CountAsync($"SELECT COUNT(*) FROM loja.{copy}"), Is.EqualTo(3));
            var difference = $"SELECT COUNT(*) FROM ((SELECT * FROM loja.{source} EXCEPT ALL SELECT * FROM loja.{copy}) UNION ALL (SELECT * FROM loja.{copy} EXCEPT ALL SELECT * FROM loja.{source})) diferenca";
            Assert.That(await database.CountAsync(difference), Is.Zero);
        }
        finally
        {
            await database.ExecuteAsync($"DROP TABLE loja.{source}, loja.{copy}");
        }
    }

    /// <summary>
    /// RN-EXPORT-011: no PostgreSQL, o retorno de carro vai como `\r` num `E'…'`, um literal só e sem tipo, e por isso o `json` e a lista `text[]` com ele
    /// voltam para o banco: a expressão `'…' || CHR(13) || '…'` seria `text`, que essas colunas não aceitam sem conversão. O arquivo não tem retorno de carro
    /// cru, e a cópia tem os mesmos valores, caractere a caractere (o `json` comparado pelo texto, que ele guarda como veio).
    /// </summary>
    [Test]
    public async Task Export_Sql_CarriageReturnInJsonAndList_RunsBackIntoACopyOfTheTable()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host);
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var (source, copy) = ($"exporta_cr_{suffix}", $"copia_cr_{suffix}");
        const string Shape = "(id INTEGER PRIMARY KEY, documento JSON, marcas TEXT[], texto TEXT)";
        await using var database = await DatabaseObserver.OpenAsync(_settings);
        await database.ExecuteAsync($"CREATE TABLE loja.{source} {Shape}");
        await database.ExecuteAsync($"CREATE TABLE loja.{copy} {Shape}");

        try
        {
            await database.ExecuteAsync($@"INSERT INTO loja.{source} VALUES
                (1, E'{{\r\n""a"": ""O''Brien \\\\ x""\r\n}}', ARRAY[E'x\ry', E'c:\\dir\r\n', 'z'], E'fim\r'),
                (2, E'[\r1,\r\n2]', ARRAY[E'\r'], E'\\r já escrito\r')");
            string[] names = ["id", "documento", "marcas", "texto"];
            var request = new
            {
                source = new { kind = "query", connectionID, sql = $"SELECT * FROM loja.{source} ORDER BY id", name = source },
                columns = names.Select((name, position) => new { position, name }).ToArray(),
                count = true,
                format = "sql",
                options = new { schema = "loja", table = copy, rowsPerStatement = 1 },
                output = new { bom = false, zip = false, clipboard = false },
                windowID = 1
            };

            var id = await StartExportAsync(host, request);
            var done = await WaitForEndAsync(host, id);
            Assert.That(done.GetProperty("state").GetString(), Is.EqualTo("done"), done.ToString());
            Assert.That(done.GetProperty("summary").GetProperty("skippedRows").GetInt64(), Is.Zero);

            var script = await File.ReadAllTextAsync(ReadyPath(host, id), Encoding.UTF8);
            await TestContext.Out.WriteLineAsync(script);
            Assert.That(script, Does.Not.Contain("\r"));
            Assert.That(script, Does.Not.Contain("CHR(13)"));
            Assert.That(script, Does.Contain("E'{\\r\n\"a\""));
            var statements = script.Split(";\n", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            Assert.That(statements, Has.Length.EqualTo(2));
            foreach (var statement in statements)
                await database.ExecuteAsync(statement);

            const string Columns = "id, documento::TEXT, marcas, texto";
            Assert.That(await database.CountAsync($"SELECT COUNT(*) FROM loja.{copy}"), Is.EqualTo(2));
            Assert.That(await database.CountAsync($"SELECT COUNT(*) FROM loja.{copy} WHERE strpos(documento::TEXT, chr(13)) > 0 AND strpos(marcas[1], chr(13)) > 0"), Is.EqualTo(2));
            var difference = $"SELECT COUNT(*) FROM ((SELECT {Columns} FROM loja.{source} EXCEPT ALL SELECT {Columns} FROM loja.{copy}) UNION ALL (SELECT {Columns} FROM loja.{copy} EXCEPT ALL SELECT {Columns} FROM loja.{source})) diferenca";
            Assert.That(await database.CountAsync(difference), Is.Zero);
        }
        finally
        {
            await database.ExecuteAsync($"DROP TABLE loja.{source}, loja.{copy}");
        }
    }

    /// <summary>RN-EXPORT-013: a planilha de verdade, pela rota: a pasta de trabalho compactada, a planilha com o nome da origem e as linhas, e o resumo com uma planilha.</summary>
    [Test]
    public async Task Export_Xlsx_WritesTheWorkbook()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host);

        var id = await StartExportAsync(host, TableExport(connectionID, format: "xlsx"));
        var done = await WaitForEndAsync(host, id);

        Assert.That(done.GetProperty("state").GetString(), Is.EqualTo("done"), done.ToString());
        Assert.That(done.GetProperty("summary").GetProperty("sheets").GetInt32(), Is.EqualTo(1));
        using var archive = ZipFile.OpenRead(ReadyPath(host, id));
        XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        using (var workbook = archive.GetEntry("xl/workbook.xml")!.Open())
            Assert.That(XDocument.Load(workbook).Descendants(main + "sheet").Single().Attribute("name")!.Value, Is.EqualTo("cliente"));

        using var sheet = archive.GetEntry("xl/worksheets/sheet1.xml")!.Open();
        var rows = XDocument.Load(sheet).Descendants(main + "row").ToList();
        Assert.That(rows, Has.Count.EqualTo(11));
        Assert.That(rows[1].Elements().Select(cell => cell.Value), Is.EqualTo(new[] { "1", "Cliente 1" }));
        Assert.That(rows[1].Elements().First().Attribute("t"), Is.Null);
    }

    /// <summary>RN-EXPORT-012: o XML do DBeaver e o conjunto do DbUnit, pela rota, bem formados e com as linhas da tabela.</summary>
    [Test]
    public async Task Export_XmlAndDbUnit_WriteTheDocuments()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host);

        var xml = await StartExportAsync(host, TableExport(connectionID, format: "xml", options: new { doctype = true }));
        var dbUnit = await StartExportAsync(host, TableExport(connectionID, format: "dbUnit"));
        await WaitForEndAsync(host, xml);
        await WaitForEndAsync(host, dbUnit);

        var document = XDocument.Load(ReadyPath(host, xml), LoadOptions.PreserveWhitespace);
        Assert.That(document.DocumentType?.Name, Is.EqualTo("cliente"));
        var records = document.Root!.Elements("DATA_RECORD").ToList();
        Assert.That(records, Has.Count.EqualTo(10));
        Assert.That(records[0].Elements().Select(element => $"{element.Name}={element.Value}"), Is.EqualTo(new[] { "id=1", "nome=Cliente 1" }));

        var dataset = XDocument.Load(ReadyPath(host, dbUnit)).Root!;
        Assert.That(dataset.Name.LocalName, Is.EqualTo("dataset"));
        Assert.That(dataset.Elements().First().ToString(), Is.EqualTo("<CLIENTE ID=\"1\" NOME=\"Cliente 1\" />"));
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
