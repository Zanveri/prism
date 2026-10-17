using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// A importação de dados até o fim (seção 36, RN-IMPORT-012 a 016, rota `POST api/user/transfers/imports`), pela API de verdade contra o PostgreSQL de
/// teste: o 202 antes do banco, a conferência, o `DELETE` antes da carga, a confirmação a cada N linhas ou numa transação só, o erro do banco na linha do
/// arquivo com o que ficou gravado, e as recusas antes do trabalho. As tabelas de destino ficam num esquema do fixture, que ele mesmo apaga no fim; cada
/// teste cria a sua. O arquivo é posto na pasta `transfers` como o processo principal do Electron o copia (`&lt;fileId&gt;.in`, RN-IMPORT-017).
/// </summary>
[TestFixture]
[Category("Api")]
public sealed class ImportJobsTests
{
    private const string UserName = "marina.costa";
    private const string ImportsPath = "/api/user/transfers/imports";
    private const string TransfersPath = "/api/user/transfers";

    private readonly string _schema = $"carga_{Guid.NewGuid():N}"[..18];

    private ConnectionSettings _settings = null!;

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        _settings = await PostgresSingleton.GetSettingsAsync();

        await using var host = await ApiHost.StartAsync();
        var (_, session) = await StartUserAsync(host);
        await host.Client.ExecuteAsync(session, $"CREATE SCHEMA {_schema}");
    }

    [OneTimeTearDown]
    public async Task StopAsync()
    {
        await using var host = await ApiHost.StartAsync();
        var (_, session) = await StartUserAsync(host);
        await host.Client.ExecuteAsync(session, $"DROP SCHEMA {_schema} CASCADE");
    }

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

    /// <summary>O usuário, a conexão com o PostgreSQL de teste e uma sessão nela, para criar a tabela do teste e ler o que a importação gravou.</summary>
    private async Task<(Guid ConnectionID, Guid SessionID)> StartUserAsync(ApiHost host)
    {
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var connectionID = await host.Client.CreateConnectionAsync(_settings);

        return (connectionID, await host.Client.OpenSessionAsync(connectionID));
    }

    /// <summary>RN-IMPORT-017 e 018: o arquivo como o processo principal o deixa na pasta `transfers`, com o nome tirado só do identificador.</summary>
    private static string PutFile(ApiHost host, string content)
    {
        var fileID = Guid.NewGuid().ToString("D");
        var folder = Path.Combine(host.DataDirectory, "transfers");
        Directory.CreateDirectory(folder);
        File.WriteAllBytes(Path.Combine(folder, $"{fileID}.in"), Encoding.UTF8.GetBytes(content));

        return fileID;
    }

    private static string FilePath(ApiHost host, string name)
        => Path.Combine(host.DataDirectory, "transfers", $"{name}.in");

    /// <summary>O CSV com cabeçalho `id;nome` e uma linha por número, `Nome N`.</summary>
    private static string Csv(IEnumerable<int> ids)
        => "id;nome\r\n" + string.Concat(ids.Select(id => $"{id};Nome {id}\r\n"));

    private object Import(string fileID, Guid connectionID, string table, object load, object? mapping = null)
        => new
        {
            fileID,
            format = "csv",
            reader = new { },
            values = new { @decimal = "point", thousandsDot = false, dates = "iso" },
            target = new { connectionID, schema = _schema, table },
            mapping = mapping ?? new[] { new { source = 0, target = "id" }, new { source = 1, target = "nome" } },
            load,
            windowID = 1
        };

    private static async Task<Guid> StartImportAsync(ApiHost host, object request)
    {
        var response = await host.Client.PostAsJsonAsync(ImportsPath, request);
        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Accepted), body.ToString());

        return body.GetProperty("id").GetGuid();
    }

    /// <summary>Consulta o trabalho como a tela, até ele sair do `running`.</summary>
    private static async Task<JsonElement> WaitForEndAsync(ApiHost host, Guid id)
    {
        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (true)
        {
            var response = await host.Client.GetAsync($"{TransfersPath}/{id}");
            var body = await ReadJsonAsync(response);
            Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());

            if (body.GetProperty("state").GetString() != "running")
                return body;

            Assert.That(DateTime.UtcNow, Is.LessThan(deadline), "O trabalho não terminou em 60 segundos.");
            await Task.Delay(100);
        }
    }

    private async Task CreateTableAsync(ApiHost host, Guid session, string table, params int[] rows)
    {
        await host.Client.ExecuteAsync(session, $"CREATE TABLE {_schema}.{table} (id integer PRIMARY KEY, nome varchar(20) NOT NULL)");
        foreach (var id in rows)
            await host.Client.ExecuteAsync(session, $"INSERT INTO {_schema}.{table} (id, nome) VALUES ({id}, 'Antes {id}')");
    }

    private async Task<string> RowsAsync(ApiHost host, Guid session, string table)
        => (await host.Client.ExecuteAsync(session, $"SELECT id, nome FROM {_schema}.{table} ORDER BY id")).GetProperty("rows").ToString();

    private async Task<long> CountAsync(ApiHost host, Guid session, string table)
        => long.Parse((await host.Client.ExecuteAsync(session, $"SELECT count(*) FROM {_schema}.{table}")).GetProperty("rows")[0][0].GetString()!);

    /// <summary>RN-API-005: a rota nova fica atrás da barreira do cofre.</summary>
    [Test]
    public async Task Import_WithVaultLocked_Returns401VaultLocked()
    {
        await using var host = await ApiHost.StartAsync();

        await AssertProblemAsync(await host.Client.PostAsJsonAsync(ImportsPath, new { }), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    /// <summary>
    /// RN-IMPORT-012 e 015: 1.234 linhas confirmadas a cada 500, em lotes de mais de um comando; o item diz as linhas lidas e as confirmadas, o tamanho do
    /// arquivo e a conexão de destino; o resumo, as contagens. O arquivo sai da pasta no fim.
    /// </summary>
    [Test]
    public async Task Import_Csv_CommitsEveryN_AndEndsDone()
    {
        await using var host = await ApiHost.StartAsync();
        var (connectionID, session) = await StartUserAsync(host);
        await CreateTableAsync(host, session, "a_cada_n");
        var content = Csv(Enumerable.Range(1, 1234));
        var fileID = PutFile(host, content);

        var id = await StartImportAsync(host, Import(fileID, connectionID, "a_cada_n", new { empty = false, commitEvery = 500, check = true }));
        var done = await WaitForEndAsync(host, id);

        Assert.That(done.GetProperty("state").GetString(), Is.EqualTo("done"), done.ToString());
        Assert.That(done.GetProperty("kind").GetString(), Is.EqualTo("import"));
        Assert.That(done.GetProperty("connectionID").GetGuid(), Is.EqualTo(connectionID));
        Assert.That(done.GetProperty("targetConnectionID").GetGuid(), Is.EqualTo(connectionID));
        Assert.That(done.GetProperty("rows").GetInt64(), Is.EqualTo(1234));
        Assert.That(done.GetProperty("committed").GetInt64(), Is.EqualTo(1234));
        Assert.That(done.GetProperty("size").GetInt64(), Is.EqualTo(Encoding.UTF8.GetByteCount(content)));
        Assert.That(done.GetProperty("uncertain").GetBoolean(), Is.False);
        Assert.That(done.GetProperty("error").ValueKind, Is.EqualTo(JsonValueKind.Null));
        var summary = done.GetProperty("summary");
        Assert.That(summary.GetProperty("rows").GetInt64(), Is.EqualTo(1234));
        Assert.That(summary.GetProperty("committed").GetInt64(), Is.EqualTo(1234));
        Assert.That(summary.GetProperty("emptied").GetBoolean(), Is.False);
        Assert.That(summary.GetProperty("shortRows").GetInt64(), Is.Zero);

        Assert.That(await CountAsync(host, session, "a_cada_n"), Is.EqualTo(1234));
        var last = (await host.Client.ExecuteAsync(session, $"SELECT id, nome FROM {_schema}.a_cada_n WHERE id = 1234")).GetProperty("rows").ToString();
        Assert.That(last, Is.EqualTo("""[["1234","Nome 1234"]]"""));
        Assert.That(File.Exists(FilePath(host, fileID)), Is.False);
        Assert.That(File.Exists(FilePath(host, id.ToString("D"))), Is.False);

        Assert.That((await host.Client.DeleteAsync($"{TransfersPath}/{id}")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
    }

    /// <summary>
    /// RN-IMPORT-016: a chave repetida na linha 1.101 do arquivo, sem a conferência: o erro do banco como veio, com o SQLSTATE, a linha do arquivo e o lado,
    /// e as 1.000 linhas das confirmações anteriores, que ficam na tabela. As do lote que falhou voltam atrás.
    /// </summary>
    [Test]
    public async Task Import_DatabaseRefusal_StopsAtTheFileLine_AndKeepsWhatWasCommitted()
    {
        await using var host = await ApiHost.StartAsync();
        var (connectionID, session) = await StartUserAsync(host);
        await CreateTableAsync(host, session, "repetida");
        var fileID = PutFile(host, Csv(Enumerable.Range(1, 1099).Append(1050).Concat(Enumerable.Range(1101, 100))));

        var id = await StartImportAsync(host, Import(fileID, connectionID, "repetida", new { empty = false, commitEvery = 500, check = false }));
        var failed = await WaitForEndAsync(host, id);

        Assert.That(failed.GetProperty("state").GetString(), Is.EqualTo("failed"), failed.ToString());
        Assert.That(failed.GetProperty("phase").GetString(), Is.EqualTo("loading"));
        Assert.That(failed.GetProperty("committed").GetInt64(), Is.EqualTo(1000));
        Assert.That(failed.GetProperty("uncertain").GetBoolean(), Is.False);
        var error = failed.GetProperty("error");
        Assert.That(error.GetProperty("code").GetString(), Is.EqualTo("SQL_EXECUTION_FAILED"));
        Assert.That(error.GetProperty("sqlState").GetString(), Is.EqualTo("23505"));
        Assert.That(error.GetProperty("line").GetInt64(), Is.EqualTo(1101));
        Assert.That(error.GetProperty("side").GetString(), Is.EqualTo("target"));
        Assert.That(error.GetProperty("committed").GetInt64(), Is.EqualTo(1000));
        Assert.That(error.GetProperty("uncertain").GetBoolean(), Is.False);
        Assert.That(failed.GetProperty("summary").ValueKind, Is.EqualTo(JsonValueKind.Null));

        Assert.That(await CountAsync(host, session, "repetida"), Is.EqualTo(1000));
        Assert.That(File.Exists(FilePath(host, id.ToString("D"))), Is.False);
    }

    /// <summary>
    /// RN-IMPORT-012 e 013: a conferência acha o valor que não converte antes de tocar na tabela: com "Esvaziar a tabela antes", as linhas que estavam
    /// lá continuam; o erro diz a linha e a coluna do arquivo, e a fase é a conferência.
    /// </summary>
    [Test]
    public async Task Import_CheckFailure_StopsBeforeTouchingTheTable()
    {
        await using var host = await ApiHost.StartAsync();
        var (connectionID, session) = await StartUserAsync(host);
        await CreateTableAsync(host, session, "conferida", 9);
        var fileID = PutFile(host, "id;nome\r\n1;Ana\r\nx;Bia\r\n");

        var id = await StartImportAsync(host, Import(fileID, connectionID, "conferida", new { empty = true, commitEvery = (int?)null, check = true }));
        var failed = await WaitForEndAsync(host, id);

        Assert.That(failed.GetProperty("state").GetString(), Is.EqualTo("failed"), failed.ToString());
        Assert.That(failed.GetProperty("phase").GetString(), Is.EqualTo("checking"));
        var error = failed.GetProperty("error");
        Assert.That(error.GetProperty("code").GetString(), Is.EqualTo("IMPORT_VALUE_INVALID"));
        Assert.That(error.GetProperty("sqlState").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(error.GetProperty("line").GetInt64(), Is.EqualTo(3));
        Assert.That(error.GetProperty("column").GetString(), Is.EqualTo("id"));
        Assert.That(error.GetProperty("committed").GetInt64(), Is.Zero);
        Assert.That(error.GetProperty("message").GetString(), Does.Contain("«x»"));

        Assert.That(await RowsAsync(host, session, "conferida"), Is.EqualTo("""[["9","Antes 9"]]"""));
    }

    /// <summary>RN-IMPORT-012: "Esvaziar a tabela antes" com tudo numa transação só: o `DELETE` e as linhas novas são confirmados juntos.</summary>
    [Test]
    public async Task Import_Empty_InOneTransaction_ReplacesTheRows()
    {
        await using var host = await ApiHost.StartAsync();
        var (connectionID, session) = await StartUserAsync(host);
        await CreateTableAsync(host, session, "esvaziada", 1, 9);
        var fileID = PutFile(host, Csv([1, 2]));

        var id = await StartImportAsync(host, Import(fileID, connectionID, "esvaziada", new { empty = true, commitEvery = (int?)null, check = true }));
        var done = await WaitForEndAsync(host, id);

        Assert.That(done.GetProperty("state").GetString(), Is.EqualTo("done"), done.ToString());
        var summary = done.GetProperty("summary");
        Assert.That(summary.GetProperty("emptied").GetBoolean(), Is.True);
        Assert.That(summary.GetProperty("committed").GetInt64(), Is.EqualTo(2));
        Assert.That(await RowsAsync(host, session, "esvaziada"), Is.EqualTo("""[["1","Nome 1"],["2","Nome 2"]]"""));
    }

    /// <summary>
    /// RN-IMPORT-014: as recusas antes do trabalho e sem nada ir ao banco: a forma do pedido no campo, o arquivo que não está na pasta, a conexão que não
    /// existe e a somente leitura.
    /// </summary>
    [Test]
    public async Task Import_Refusals_ComeBeforeTheJob()
    {
        await using var host = await ApiHost.StartAsync();
        var (connectionID, _) = await StartUserAsync(host);
        var fileID = PutFile(host, Csv([1]));
        var load = new { empty = false, commitEvery = 500, check = true };

        var shape = await AssertProblemAsync(await host.Client.PostAsJsonAsync(ImportsPath, Import(fileID, connectionID, "qualquer", new { commitEvery = 0 })), HttpStatusCode.UnprocessableEntity, "IMPORT_OPTIONS_INVALID");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(ImportsPath, Import(Guid.NewGuid().ToString("D"), connectionID, "qualquer", load)), HttpStatusCode.NotFound, "IMPORT_FILE_MISSING");
        await AssertProblemAsync(await host.Client.PostAsJsonAsync(ImportsPath, Import(fileID, Guid.NewGuid(), "qualquer", load)), HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");

        var response = await host.Client.PostAsJsonAsync("/api/user/connections", new { folderID = (Guid?)null, name = "Somente leitura", engine = (int)_settings.Engine, host = _settings.Host, port = _settings.Port, database = _settings.Database, userName = _settings.UserName, password = _settings.Password, readOnly = true });
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created), await response.Content.ReadAsStringAsync());
        var readOnlyID = (await ReadJsonAsync(response)).GetProperty("id").GetGuid();
        var readOnly = await AssertProblemAsync(await host.Client.PostAsJsonAsync(ImportsPath, Import(fileID, readOnlyID, "qualquer", load)), HttpStatusCode.UnprocessableEntity, "CONNECTION_READ_ONLY");

        Assert.That(shape.GetProperty("errors").EnumerateObject().Select(field => field.Name), Does.Contain("load.commitEvery"));
        Assert.That(readOnly.GetProperty("detail").GetString(), Is.EqualTo("A conexão é somente leitura, e a importação grava na tabela. Nada foi enviado ao banco."));
        Assert.That(File.Exists(FilePath(host, fileID)), Is.True);
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync(TransfersPath))).GetArrayLength(), Is.Zero);
    }
}
