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
/// RN-SQL-017: `POST api/user/database-sessions/{id}/results/{resultID}/cells`, pela API de verdade contra o PostgreSQL de teste. A grade
/// recebe o valor cortado (RN-SQL-011) e copiar e exportar pedem o completo por esta rota: o que volta é igual, byte por byte, ao que foi
/// gravado, também nas páginas do "carregar mais", e larga tudo quando a sessão executa outro comando.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class DatabaseSessionCellsTests
{
    private const string UserName = "marina.costa";

    /// <summary>Um JSON longo, como o do defeito relatado: acentos, aspas, barra invertida, quebra de linha e um caractere de dois `char`, num texto de 50.000.</summary>
    private static readonly string LongText = BuildLongText(50000);

    /// <summary>300.000 bytes sorteados (com semente: a falha se repete), todos os 256 valores entre eles.</summary>
    private static readonly byte[] LongBinary = BuildBinary(300000);

    private ConnectionSettings _settings = null!;

    [OneTimeSetUp]
    public async Task StartAsync()
        => _settings = await PostgresSingleton.GetSettingsAsync();

    private static string BuildLongText(int length)
    {
        var text = new StringBuilder("{\"itens\":[");
        for (var index = 0; text.Length < length; index++)
            text.Append($"{{\"id\":{index},\"descrição\":\"Ação nº {index} — \\\"aspas\\\" e barra \\\\ em São Paulo 😀\"}},\n");

        // O corte cai entre um caractere e outro, nunca no meio do par de `char` do emoji.
        var cut = char.IsHighSurrogate(text[length - 1]) ? length - 1 : length;

        return text.ToString(0, cut).PadRight(length, ' ');
    }

    private static byte[] BuildBinary(int length)
    {
        var bytes = new byte[length];
        new Random(17).NextBytes(bytes);
        for (var value = 0; value < 256; value++)
            bytes[value] = (byte)value;

        return bytes;
    }

    private static string Url(Guid sessionID, string tail)
        => $"{PrismCalls.SessionsPath}/{sessionID}{tail}";

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

    private static Task<HttpResponseMessage> CellsAsync(ApiHost host, Guid sessionID, Guid resultID, object body)
        => host.Client.PostAsJsonAsync(Url(sessionID, $"/results/{resultID}/cells"), body);

    /// <summary>
    /// A tabela temporária da sessão, com 60 linhas: na linha 3 o texto longo e um binário curto; na 55 (a sexta da segunda página de 50)
    /// o texto e o binário longos. A primeira página volta com o `resultID`.
    /// </summary>
    private async Task<(Guid Session, JsonElement First)> StartWithLongCellsAsync(ApiHost host)
    {
        await host.CreateUserAsync(UserName, UserFakers.RandomPassword());
        var sessionID = await host.Client.OpenSessionAsync(await host.Client.CreateConnectionAsync(_settings));
        var text = LongText.Replace("'", "''");
        await host.Client.ExecuteAsync(sessionID, "CREATE TEMP TABLE documento (id integer PRIMARY KEY, corpo text, dados bytea)");
        await host.Client.ExecuteAsync(sessionID, $"INSERT INTO documento SELECT i, CASE WHEN i IN (3, 55) THEN '{text}' ELSE 'curto' END, CASE WHEN i = 55 THEN '\\x{Convert.ToHexString(LongBinary)}'::bytea ELSE '\\x00ff'::bytea END FROM generate_series(0, 59) AS i");

        var first = await host.Client.PostAsJsonAsync(Url(sessionID, "/queries"), new { sql = "SELECT id, corpo, dados FROM documento ORDER BY id", pageSize = 50 });
        var body = await ReadJsonAsync(first);
        Assert.That(first.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());

        return (sessionID, body);
    }

    [Test]
    public async Task Cells_ReturnTheWholeValues_ByteForByte_AlsoFromTheNextPage()
    {
        await using var host = await ApiHost.StartAsync();
        var (sessionID, first) = await StartWithLongCellsAsync(host);
        var resultID = first.GetProperty("resultID").GetGuid();
        var next = await host.Client.PostAsync(Url(sessionID, "/queries/next"), null);
        var nextBody = await ReadJsonAsync(next);

        var response = await CellsAsync(host, sessionID, resultID, new { cells = new[] { new { row = 55, column = 1 }, new { row = 55, column = 2 }, new { row = 3, column = 1 }, new { row = 3, column = 2 }, new { row = 0, column = 0 } } });
        var body = await ReadJsonAsync(response);

        // A grade continua com o valor cortado (RN-SQL-011), e a página diz que nenhuma célula ficou sem valor completo.
        Assert.That(first.GetProperty("rows")[3][1].GetString(), Is.EqualTo(LongText[..10000]));
        Assert.That(first.GetProperty("truncatedCells").EnumerateArray().Select(cell => cell.EnumerateArray().Select(index => index.GetInt32()).ToArray()), Is.EqualTo(new[] { new[] { 3, 1 } }));
        Assert.That(first.GetProperty("cellsWithoutFullValue").GetArrayLength(), Is.Zero);
        Assert.That(next.StatusCode, Is.EqualTo(HttpStatusCode.OK), nextBody.ToString());
        Assert.That(nextBody.GetProperty("resultID").GetGuid(), Is.EqualTo(resultID));
        Assert.That(nextBody.GetProperty("truncatedCells").EnumerateArray().Select(cell => cell.EnumerateArray().Select(index => index.GetInt32()).ToArray()), Is.EqualTo(new[] { new[] { 5, 1 }, new[] { 5, 2 } }));
        Assert.That(nextBody.GetProperty("cellsWithoutFullValue").GetArrayLength(), Is.Zero);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());
        var values = body.GetProperty("values").EnumerateArray().ToList();
        Assert.That(values.Select(value => (value.GetProperty("row").GetInt32(), value.GetProperty("column").GetInt32())), Is.EqualTo(new[] { (55, 1), (55, 2), (3, 1), (3, 2), (0, 0) }));
        Assert.That(Encoding.UTF8.GetBytes(values[0].GetProperty("value").GetString()!), Is.EqualTo(Encoding.UTF8.GetBytes(LongText)));
        Assert.That(values[0].GetProperty("value").GetString(), Has.Length.EqualTo(50000));
        var binary = values[1].GetProperty("value").GetString()!;
        Assert.That(binary, Does.StartWith("0x"));
        Assert.That(Convert.FromHexString(binary.AsSpan(2)), Is.EqualTo(LongBinary));
        Assert.That(binary, Does.StartWith(nextBody.GetProperty("rows")[5][2].GetString()!), "O completo começa pelo que a grade mostra.");
        Assert.That(values[2].GetProperty("value").GetString(), Is.EqualTo(LongText));
        // A célula que não foi cortada não tem valor completo: a tela já tem o valor inteiro.
        Assert.That(values[3].GetProperty("value").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(values[4].GetProperty("value").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    /// <summary>RN-SQL-017: a sessão larga os valores quando executa outro comando; o ID de antes não é mais um resultado dela.</summary>
    [Test]
    public async Task Cells_AfterAnotherCommand_Return404ResultNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        var (sessionID, first) = await StartWithLongCellsAsync(host);
        var resultID = first.GetProperty("resultID").GetGuid();
        var cell = new { cells = new[] { new { row = 3, column = 1 } } };
        var before = await CellsAsync(host, sessionID, resultID, cell);
        Assert.That(before.StatusCode, Is.EqualTo(HttpStatusCode.OK));

        await host.Client.ExecuteAsync(sessionID, "SELECT 1");

        await AssertProblemAsync(await CellsAsync(host, sessionID, resultID, cell), HttpStatusCode.NotFound, "RESULT_NOT_FOUND");
        await AssertProblemAsync(await CellsAsync(host, Guid.NewGuid(), resultID, cell), HttpStatusCode.NotFound, "DATABASE_SESSION_NOT_FOUND");
    }

    /// <summary>
    /// RN-SQL-017: lista vazia ou ausente, acima de 10.000 células, posição negativa, linha que ainda não foi entregue (a segunda página
    /// não foi pedida) e coluna que o resultado não tem: 422 `CELLS_INVALID`.
    /// </summary>
    [Test]
    public async Task Cells_Invalid_Return422CellsInvalid()
    {
        await using var host = await ApiHost.StartAsync();
        var (sessionID, first) = await StartWithLongCellsAsync(host);
        var resultID = first.GetProperty("resultID").GetGuid();

        foreach (var body in new object[]
                 {
                     new { cells = Array.Empty<object>() },
                     new { },
                     new { cells = Enumerable.Range(0, 10001).Select(row => new { row = row % 50, column = 1 }).ToArray() },
                     new { cells = new[] { new { row = -1, column = 1 } } },
                     new { cells = new[] { new { row = 3, column = 1 }, new { row = 50, column = 1 } } },
                     new { cells = new[] { new { row = 3, column = 3 } } }
                 })
            await AssertProblemAsync(await CellsAsync(host, sessionID, resultID, body), HttpStatusCode.UnprocessableEntity, "CELLS_INVALID");

        var limit = await CellsAsync(host, sessionID, resultID, new { cells = Enumerable.Range(0, 10000).Select(row => new { row = row % 50, column = 1 }).ToArray() });
        Assert.That(limit.StatusCode, Is.EqualTo(HttpStatusCode.OK));
    }
}
