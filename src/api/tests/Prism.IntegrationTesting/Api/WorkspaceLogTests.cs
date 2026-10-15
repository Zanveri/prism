using Prism.IntegrationTesting.Api.Support;
using System.Net;
using System.Net.Http.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// Seção 24 e RN-LOG-001: o log das rotas `api/user/workspace` registra só a contagem de abas, e nunca o texto do SQL de uma aba, o banco, o esquema nem a
/// tabela, em nenhum dos caminhos (gravar, ler, recusar a forma e o tamanho, a falha de disco). Roda a API como processo, e não no `ApiHost`: só o processo liga o
/// Serilog e escreve `logs/`. Por isso o teste começa conferindo que o log existe e registrou a contagem e a falha de disco: procurar uma marca num log que nunca
/// foi escrito passaria sem provar nada. Não precisa de PostgreSQL: as abas só falam com o arquivo do cofre.
/// </summary>
[TestFixture]
[Category("Api")]
public sealed class WorkspaceLogTests
{
    /// <summary>Sorteada a cada execução: é um texto que só este teste produz, e é isso que dá valor a "não aparece no log".</summary>
    private static readonly string Run = Guid.NewGuid().ToString("N")[..8];

    private static readonly string MarkedSql = $"SELECT 'SQL-MARCADO-{Run}' FROM clientes";
    private static readonly string MarkedDatabase = $"banco_marcado_{Run}";
    private static readonly string MarkedSchema = $"ESQUEMA-MARCADO-{Run}";
    private static readonly string MarkedTable = $"TABELA-MARCADA-{Run}";

    private const string WorkspacePath = "/api/user/workspace";

    private static readonly TimeSpan ShutdownTimeout = TimeSpan.FromSeconds(15);

    [Test]
    public async Task Logs_HaveOnlyTheTabCount()
    {
        using var parent = ApiProcess.StartParentStandIn();
        using var api = await ApiProcess.StartAsync(parentProcessID: parent.Id);
        await api.Client.CreateUserAsync("marina.costa", $"senha-{Run}-forte");
        var temporary = Path.Combine(api.DataDirectory, "vaults", "marina.costa.vault.json.tmp");
        var connectionID = Guid.CreateVersion7();
        object[] tabs =
        [
            new { kind = "query", connectionID, database = MarkedDatabase, sql = MarkedSql, scriptID = Guid.CreateVersion7(), dirty = true, sqlTooLarge = false },
            new { kind = "table", connectionID, database = MarkedDatabase, schema = MarkedSchema, table = MarkedTable, view = "data" },
            new { kind = "query", connectionID = (Guid?)null, sql = "", sqlTooLarge = true },
        ];

        Assert.That((await api.Client.PutAsJsonAsync(WorkspacePath, new { tabs, activeIndex = 1 })).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That((await api.Client.GetAsync(WorkspacePath)).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        // As recusas: a forma (com as marcas dentro) e o texto grande demais.
        Assert.That((await api.Client.PutAsJsonAsync(WorkspacePath, new { tabs = new object[] { new { kind = $"tipo-{MarkedTable}", sql = MarkedSql } }, activeIndex = 0 })).StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That((await api.Client.PutAsJsonAsync(WorkspacePath, new { tabs = new object[] { new { kind = "query", sql = MarkedSql + new string(' ', 1024 * 1024) } }, activeIndex = 0 })).StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        // A falha de disco: uma pasta no lugar do temporário da gravação. O log registra a classe do erro, e nunca a exceção, que traria o caminho.
        Directory.CreateDirectory(temporary);
        Assert.That((await api.Client.PutAsJsonAsync(WorkspacePath, new { tabs = tabs[..2], activeIndex = 0 })).StatusCode, Is.EqualTo(HttpStatusCode.ServiceUnavailable));
        Directory.Delete(temporary);

        // O desligamento de verdade: o host é descartado e o Serilog grava até o fim antes de o arquivo ser lido.
        Assert.That(await ApiProcess.StopThroughParentAsync(parent, api, ShutdownTimeout), Is.Zero);
        var logs = api.ReadLogs();

        Assert.That(logs, Is.Not.Empty, "A API não escreveu nenhum arquivo em logs/.");
        Assert.That(logs.Values.Any(log => log.Contains("Área de trabalho gravada com 3 abas.", StringComparison.Ordinal)), Is.True, "O log não registra a contagem da gravação: o teste não prova nada se o log não está ligado.");
        Assert.That(logs.Values.Any(log => log.Contains("Área de trabalho lida com 3 abas.", StringComparison.Ordinal)), Is.True, "O log não registra a contagem da leitura.");
        Assert.That(logs.Values.Any(log => log.Contains("O arquivo do cofre falhou em Write", StringComparison.Ordinal)), Is.True, "O log não registra a falha de disco.");
        foreach (var (file, log) in logs)
        {
            Assert.That(log, Does.Not.Contain("SQL-MARCADO"), $"{file} tem o SQL de uma aba.");
            Assert.That(log, Does.Not.Contain(MarkedDatabase), $"{file} tem o banco de uma aba.");
            Assert.That(log, Does.Not.Contain("ESQUEMA-MARCADO"), $"{file} tem o esquema de uma aba.");
            Assert.That(log, Does.Not.Contain("TABELA-MARCADA"), $"{file} tem a tabela de uma aba.");
            Assert.That(log, Does.Not.Contain(Run), $"{file} tem uma marca do teste.");
        }
    }
}
