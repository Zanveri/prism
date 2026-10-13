using Prism.IntegrationTesting.Api.Support;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// RN-SCRIPT-002 e RN-LOG-001: o log da API nunca leva o texto do SQL de um script, nem o nome dele, em nenhum dos caminhos das rotas `api/user/scripts`
/// (criar, ler, alterar, recusar, excluir, a falha de disco). Roda a API como processo, e não no `ApiHost`: só o processo liga o Serilog e escreve `logs/`.
/// Por isso o teste começa conferindo que o log existe e registrou a falha de disco: procurar uma marca num log que nunca foi escrito passaria sem provar nada.
/// Não precisa de PostgreSQL: os scripts só falam com o arquivo do cofre.
/// </summary>
[TestFixture]
[Category("Api")]
public sealed class ScriptsLogTests
{
    /// <summary>Sorteada a cada execução: é um texto que só este teste produz, e é isso que dá valor a "não aparece no log".</summary>
    private static readonly string Run = Guid.NewGuid().ToString("N")[..8];

    private static readonly string MarkedSql = $"SELECT 'SQL-MARCADO-{Run}' FROM clientes";
    private static readonly string MarkedName = $"NOME-MARCADO-{Run}";

    private const string ScriptsPath = "/api/user/scripts";

    private static readonly TimeSpan ShutdownTimeout = TimeSpan.FromSeconds(15);

    [Test]
    public async Task Logs_DoNotContainTheSqlNorTheNameOfTheScripts()
    {
        using var parent = ApiProcess.StartParentStandIn();
        using var api = await ApiProcess.StartAsync(parentProcessID: parent.Id);
        await api.Client.CreateUserAsync("marina.costa", $"senha-{Run}-forte");
        var temporary = Path.Combine(api.DataDirectory, "vaults", "marina.costa.vault.json.tmp");

        var created = await api.Client.PostAsJsonAsync(ScriptsPath, new { name = MarkedName, sql = MarkedSql, connectionID = Guid.CreateVersion7(), database = $"banco-{Run}" });
        Assert.That(created.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        Assert.That((await api.Client.GetAsync($"{ScriptsPath}/{id}")).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await api.Client.GetAsync(ScriptsPath)).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        // As recusas: o nome repetido, o nome inválido e o SQL grande demais (com a marca dentro).
        Assert.That((await api.Client.PostAsJsonAsync(ScriptsPath, new { name = MarkedName, sql = MarkedSql })).StatusCode, Is.EqualTo(HttpStatusCode.Conflict));
        Assert.That((await api.Client.PostAsJsonAsync(ScriptsPath, new { name = $"{MarkedName}\u0001", sql = MarkedSql })).StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That((await api.Client.PostAsJsonAsync(ScriptsPath, new { name = "Grande", sql = MarkedSql + new string(' ', 1024 * 1024) })).StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        // Gravar por cima, e a falha de disco: uma pasta no lugar do temporário da gravação. O log registra a classe do erro, e nunca a exceção, que traria o caminho.
        var patch = new HttpRequestMessage(HttpMethod.Patch, ScriptsPath) { Content = JsonContent.Create(new { id, sql = MarkedSql + " WHERE 1 = 1" }) };
        Assert.That((await api.Client.SendAsync(patch)).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Directory.CreateDirectory(temporary);
        Assert.That((await api.Client.PostAsJsonAsync(ScriptsPath, new { name = $"{MarkedName} 2", sql = MarkedSql })).StatusCode, Is.EqualTo(HttpStatusCode.ServiceUnavailable));
        Directory.Delete(temporary);
        Assert.That((await api.Client.DeleteAsync($"{ScriptsPath}/{id}")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        // O desligamento de verdade: o host é descartado e o Serilog grava até o fim antes de o arquivo ser lido.
        Assert.That(await ApiProcess.StopThroughParentAsync(parent, api, ShutdownTimeout), Is.Zero);
        var logs = api.ReadLogs();

        Assert.That(logs, Is.Not.Empty, "A API não escreveu nenhum arquivo em logs/.");
        Assert.That(logs.Values.Any(log => log.Contains("O arquivo do cofre falhou em Write", StringComparison.Ordinal)), Is.True, "O log não registra a falha de disco: o teste não prova nada se o log não está ligado.");
        foreach (var (file, log) in logs)
        {
            Assert.That(log, Does.Not.Contain("SQL-MARCADO"), $"{file} tem o SQL de um script.");
            Assert.That(log, Does.Not.Contain("NOME-MARCADO"), $"{file} tem o nome de um script.");
            Assert.That(log, Does.Not.Contain(Run), $"{file} tem uma marca do teste.");
        }
    }
}
