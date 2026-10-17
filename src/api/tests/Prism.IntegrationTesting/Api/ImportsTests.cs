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
/// As prévias da importação de dados (seção 36, RN-IMPORT-007 a 011, rotas `imports/read` e `imports/preview`), pela API de verdade contra o PostgreSQL
/// de teste com a carga `loja`. O arquivo é posto na pasta `transfers` da pasta de dados, como o processo principal do Electron o copia
/// (`&lt;fileId&gt;.in`, RN-IMPORT-017), e as rotas o leem só pelo identificador. Cada teste sobe uma API própria, com o cofre e a pasta de dados próprios.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class ImportsTests
{
    private const string UserName = "marina.costa";
    private const string ReadPath = "/api/user/transfers/imports/read";
    private const string PreviewPath = "/api/user/transfers/imports/preview";

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

    private async Task<Guid> StartUserAsync(ApiHost host, bool readOnly = false)
    {
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        if (!readOnly)
            return await host.Client.CreateConnectionAsync(_settings);

        var response = await host.Client.PostAsJsonAsync("/api/user/connections", new { folderID = (Guid?)null, name = "Banco de teste", engine = (int)_settings.Engine, host = _settings.Host, port = _settings.Port, database = _settings.Database, userName = _settings.UserName, password = _settings.Password, readOnly = true });
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created), await response.Content.ReadAsStringAsync());

        return (await ReadJsonAsync(response)).GetProperty("id").GetGuid();
    }

    /// <summary>RN-IMPORT-017 e 018: o arquivo como o processo principal o deixa na pasta `transfers`, com o nome tirado só do identificador.</summary>
    private static string PutFile(ApiHost host, byte[] content)
    {
        var fileID = Guid.NewGuid().ToString("D");
        var folder = Path.Combine(host.DataDirectory, "transfers");
        Directory.CreateDirectory(folder);
        File.WriteAllBytes(Path.Combine(folder, $"{fileID}.in"), content);

        return fileID;
    }

    private static object Preview(string fileID, Guid connectionID, string table, object? mapping = null, string format = "csv", object? reader = null, object? values = null)
        => new { fileID, format, reader = reader ?? new { }, values = values ?? new { @decimal = "point", thousandsDot = false, dates = "iso" }, target = new { connectionID, schema = "loja", table }, mapping };

    /// <summary>RN-API-005: as rotas novas ficam atrás da barreira do cofre.</summary>
    [Test]
    public async Task Routes_WithVaultLocked_Return401VaultLocked()
    {
        await using var host = await ApiHost.StartAsync();

        foreach (var path in new[] { ReadPath, PreviewPath })
            await AssertProblemAsync(await host.Client.PostAsJsonAsync(path, new { }), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    /// <summary>RN-IMPORT-004 e 007: a codificação e o separador automáticos, o cabeçalho e as linhas como foram lidas, e o arquivo que continua lá.</summary>
    [Test]
    public async Task Read_Csv_FindsTheEncodingAndTheDelimiter()
    {
        await using var host = await ApiHost.StartAsync();
        await StartUserAsync(host);
        var fileID = PutFile(host, Encoding.Latin1.GetBytes("id;nome\r\n1;São Paulo\r\n2;\"Rua \"\"A\"\"; 3\"\r\n"));

        var response = await host.Client.PostAsJsonAsync(ReadPath, new { fileID, format = "csv", reader = new { encoding = "auto", delimiter = "auto" } });
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        Assert.That(body.GetProperty("encoding").GetProperty("name").GetString(), Is.EqualTo("windows-1252"));
        Assert.That(body.GetProperty("encoding").GetProperty("bom").GetBoolean(), Is.False);
        Assert.That(body.GetProperty("delimiter").GetString(), Is.EqualTo(";"));
        Assert.That(body.GetProperty("listKey").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(body.GetProperty("sheets").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(body.GetProperty("columns").EnumerateArray().Select(column => column.GetString()), Is.EqualTo(new[] { "id", "nome" }));
        Assert.That(body.GetProperty("shownColumns").GetInt32(), Is.EqualTo(2));
        var rows = body.GetProperty("rows").EnumerateArray().ToList();
        Assert.That(rows, Has.Count.EqualTo(2));
        Assert.That(rows[0].GetProperty("line").GetInt64(), Is.EqualTo(2));
        Assert.That(rows[0].GetProperty("values")[1].GetString(), Is.EqualTo("São Paulo"));
        Assert.That(rows[1].GetProperty("values")[1].GetString(), Is.EqualTo("Rua \"A\"; 3"));
        Assert.That(rows[1].GetProperty("short").GetBoolean(), Is.False);
        Assert.That(File.Exists(Path.Combine(host.DataDirectory, "transfers", $"{fileID}.in")), Is.True);
    }

    /// <summary>RN-IMPORT-005: o JSON de um objeto com uma lista, as chaves do arquivo inteiro e os valores na forma deles.</summary>
    [Test]
    public async Task Read_Json_FindsTheKeysOfTheWholeFile()
    {
        await using var host = await ApiHost.StartAsync();
        await StartUserAsync(host);
        var fileID = PutFile(host, Encoding.UTF8.GetBytes("""{ "pedido": [ { "id": 1, "total": 12345678901234567890.5 }, { "id": 2, "obs": null, "pago": true } ] }"""));

        var response = await host.Client.PostAsJsonAsync(ReadPath, new { fileID, format = "json" });
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        Assert.That(body.GetProperty("listKey").GetString(), Is.EqualTo("pedido"));
        Assert.That(body.GetProperty("encoding").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(body.GetProperty("columns").EnumerateArray().Select(column => column.GetString()), Is.EqualTo(new[] { "id", "total", "obs", "pago" }));
        var rows = body.GetProperty("rows").EnumerateArray().ToList();
        Assert.That(rows[0].GetProperty("values")[1].GetString(), Is.EqualTo("12345678901234567890.5"));
        Assert.That(rows[1].GetProperty("values")[2].ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(rows[1].GetProperty("values")[3].GetString(), Is.EqualTo("true"));
    }

    /// <summary>RN-IMPORT-006: as planilhas, a primeira que não é oculta, e o número, a data e o texto de cada célula.</summary>
    [Test]
    public async Task Read_Xlsx_ListsTheSheetsAndReadsTheCells()
    {
        await using var host = await ApiHost.StartAsync();
        await StartUserAsync(host);
        var fileID = PutFile(host, Workbook());

        var response = await host.Client.PostAsJsonAsync(ReadPath, new { fileID, format = "xlsx", reader = new { header = true } });
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        Assert.That(body.GetProperty("sheet").GetString(), Is.EqualTo("Pedidos"));
        var sheets = body.GetProperty("sheets").EnumerateArray().Select(sheet => (sheet.GetProperty("name").GetString(), sheet.GetProperty("hidden").GetBoolean())).ToList();
        Assert.That(sheets, Is.EqualTo(new[] { ("Rascunho", true), ("Pedidos", false) }));
        var values = body.GetProperty("rows")[0].GetProperty("values").EnumerateArray().Select(value => value.GetString()).ToList();
        Assert.That(values, Is.EqualTo(new[] { "1", "2024-01-15", "Ana" }));

        var missing = await host.Client.PostAsJsonAsync(ReadPath, new { fileID, format = "xlsx", reader = new { sheet = "Outra" } });
        var refused = await AssertProblemAsync(missing, HttpStatusCode.UnprocessableEntity, "IMPORT_FILE_UNREADABLE");
        Assert.That(refused.GetProperty("reason").GetString(), Is.EqualTo("sheet"));
    }

    /// <summary>As recusas de `imports/read`: a forma do pedido no campo, o arquivo que não está na pasta e a leitura que não segue.</summary>
    [Test]
    public async Task Read_Refusals_ComeWithTheirCodes()
    {
        await using var host = await ApiHost.StartAsync();
        await StartUserAsync(host);
        var invalid = PutFile(host, [.. Encoding.UTF8.GetBytes("a;b\r\n1;"), 0xC3, 0x28]);

        var shape = await AssertProblemAsync(await host.Client.PostAsJsonAsync(ReadPath, new { fileID = "../vault", format = "csv", reader = new { nullText = "\u0001" } }), HttpStatusCode.UnprocessableEntity, "IMPORT_OPTIONS_INVALID");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(ReadPath, new { fileID = Guid.NewGuid().ToString("D"), format = "csv" }), HttpStatusCode.NotFound, "IMPORT_FILE_MISSING");
        var unreadable = await AssertProblemAsync(await host.Client.PostAsJsonAsync(ReadPath, new { fileID = invalid, format = "csv", reader = new { encoding = "utf-8" } }), HttpStatusCode.UnprocessableEntity, "IMPORT_FILE_UNREADABLE");

        var fields = shape.GetProperty("errors").EnumerateObject().Select(field => field.Name).ToList();
        Assert.That(fields, Does.Contain("fileID"));
        Assert.That(fields, Does.Contain("reader.nullText"));
        Assert.That(unreadable.GetProperty("reason").GetString(), Is.EqualTo("encoding"));
        Assert.That(unreadable.GetProperty("line").GetInt64(), Is.EqualTo(2));
        Assert.That(unreadable.GetProperty("detail").GetString(), Is.EqualTo("O arquivo não é UTF-8 válido na linha 2. Escolha a codificação dele."));
    }

    /// <summary>
    /// RN-IMPORT-009 a 011: a tabela lida numa conexão à parte, com as colunas, a classe e as chaves que apontam para ela; o mapeamento pelo nome; e a
    /// prévia convertida, em que o PostgreSQL diz o que não converte (o inteiro fora da faixa), e o Prism, o que não tem a forma canônica.
    /// </summary>
    [Test]
    public async Task Preview_Postgres_MapsByNameAndAsksTheDatabase()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host);
        var fileID = PutFile(host, Encoding.UTF8.GetBytes("ID;Nome\r\n1;Ana\r\n99999999999;Bia\r\n1,5;Carla\r\n"));

        var response = await host.Client.PostAsJsonAsync(PreviewPath, Preview(fileID, connectionID, "cliente"));
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        var table = body.GetProperty("table");
        Assert.That(table.GetProperty("schema").GetString(), Is.EqualTo("loja"));
        Assert.That(table.GetProperty("oneAtATime").GetBoolean(), Is.False);
        var columns = table.GetProperty("columns").EnumerateArray().ToList();
        Assert.That(columns.Select(column => column.GetProperty("name").GetString()), Is.EqualTo(new[] { "id", "nome" }));
        Assert.That(columns.Select(column => column.GetProperty("class").GetString()), Is.EqualTo(new[] { "number", "text" }));
        Assert.That(columns.All(column => column.GetProperty("importable").GetBoolean()), Is.True);
        var references = table.GetProperty("referencedBy").EnumerateArray().Select(reference => (reference.GetProperty("table").GetString(), reference.GetProperty("onDelete").GetString())).ToList();
        Assert.That(references, Does.Contain(("pedido", "noAction")));

        var mapping = body.GetProperty("mapping").EnumerateArray().Select(entry => (entry.GetProperty("source").GetInt32(), entry.GetProperty("target").GetString())).ToList();
        Assert.That(mapping, Is.EqualTo(new[] { (0, "id"), (1, "nome") }));
        var rows = body.GetProperty("rows").EnumerateArray().ToList();
        Assert.That(rows[0].GetProperty("cells")[0].GetProperty("value").GetString(), Is.EqualTo("1"));
        Assert.That(rows[0].GetProperty("cells")[0].GetProperty("problem").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(rows[1].GetProperty("cells")[0].GetProperty("problem").GetString(), Does.Contain("99999999999"));
        Assert.That(rows[1].GetProperty("cells")[1].GetProperty("value").GetString(), Is.EqualTo("Bia"));
        Assert.That(rows[2].GetProperty("cells")[0].GetProperty("problem").GetString(), Is.EqualTo("«1,5» não é um número com ponto decimal. Se o arquivo usa vírgula, escolha Vírgula em Separador decimal."));
    }

    /// <summary>As recusas de `imports/preview`: a visão, a tabela que não existe, o mapeamento no campo e a conexão somente leitura, antes do banco.</summary>
    [Test]
    public async Task Preview_Refusals_ComeWithTheirCodes()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host);
        var fileID = PutFile(host, Encoding.UTF8.GetBytes("id;nome\r\n1;Ana\r\n"));

        var view = await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, Preview(fileID, connectionID, "pedido_resumo")), HttpStatusCode.UnprocessableEntity, "IMPORT_TARGET_NOT_TABLE");
        var gone = await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, Preview(fileID, connectionID, "nao_existe")), HttpStatusCode.NotFound, "IMPORT_TABLE_NOT_FOUND");
        var mapping = await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, Preview(fileID, connectionID, "cliente", new[] { new { source = 5, target = "id" } })), HttpStatusCode.UnprocessableEntity, "IMPORT_MAPPING_INVALID");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, Preview(Guid.NewGuid().ToString("D"), connectionID, "cliente")), HttpStatusCode.NotFound, "IMPORT_FILE_MISSING");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, Preview(fileID, Guid.NewGuid(), "cliente")), HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");

        Assert.That(view.GetProperty("detail").GetString(), Is.EqualTo("Só uma tabela recebe linhas: loja.pedido_resumo é uma visão."));
        Assert.That(gone.GetProperty("detail").GetString(), Is.EqualTo("A tabela loja.nao_existe não existe mais."));
        Assert.That(mapping.GetProperty("errors").EnumerateObject().Select(field => field.Name), Does.Contain("mapping[0].source"));
    }

    /// <summary>RN-PROT-002 e RN-IMPORT-009: a conexão somente leitura é recusada pela proteção do cofre, sem ir ao banco.</summary>
    [Test]
    public async Task Preview_ReadOnlyConnection_Returns422()
    {
        await using var host = await ApiHost.StartAsync();
        var connectionID = await StartUserAsync(host, readOnly: true);
        var fileID = PutFile(host, Encoding.UTF8.GetBytes("id;nome\r\n1;Ana\r\n"));

        var refused = await AssertProblemAsync(await host.Client.PostAsJsonAsync(PreviewPath, Preview(fileID, connectionID, "cliente")), HttpStatusCode.UnprocessableEntity, "CONNECTION_READ_ONLY");

        Assert.That(refused.GetProperty("detail").GetString(), Is.EqualTo("A conexão é somente leitura, e a importação grava na tabela. Nada foi enviado ao banco."));
    }

    /// <summary>Uma pasta de trabalho pequena, como o Excel a grava: uma planilha oculta antes da de dados, a data pelo estilo e um texto compartilhado.</summary>
    private static byte[] Workbook()
    {
        const string main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        const string relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        using var buffer = new MemoryStream();
        using (var archive = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            void Add(string name, string content)
            {
                using var writer = new StreamWriter(archive.CreateEntry(name).Open(), new UTF8Encoding(false));
                writer.Write(content);
            }

            Add("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>""");
            Add("xl/workbook.xml", $"""<workbook xmlns="{main}" xmlns:r="{relationships}"><sheets><sheet name="Rascunho" sheetId="1" state="hidden" r:id="rId1"/><sheet name="Pedidos" sheetId="2" r:id="rId2"/></sheets></workbook>""");
            Add("xl/_rels/workbook.xml.rels", $"""<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{relationships}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="{relationships}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rS" Type="{relationships}/styles" Target="styles.xml"/><Relationship Id="rT" Type="{relationships}/sharedStrings" Target="sharedStrings.xml"/></Relationships>""");
            Add("xl/styles.xml", $"""<styleSheet xmlns="{main}"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>""");
            Add("xl/sharedStrings.xml", $"""<sst xmlns="{main}"><si><t>Ana</t></si></sst>""");
            Add("xl/worksheets/sheet1.xml", $"""<worksheet xmlns="{main}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>rascunho</t></is></c></row></sheetData></worksheet>""");
            Add("xl/worksheets/sheet2.xml", $"""<worksheet xmlns="{main}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>id</t></is></c><c r="B1" t="inlineStr"><is><t>criado</t></is></c><c r="C1" t="inlineStr"><is><t>nome</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2" s="1"><v>45306</v></c><c r="C2" t="s"><v>0</v></c></row></sheetData></worksheet>""");
        }

        return buffer.ToArray();
    }
}
