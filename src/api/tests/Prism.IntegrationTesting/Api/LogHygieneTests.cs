using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// RN-LOG-001: o log não traz senha, string de conexão, texto de SQL nem dado de resultado, e (RN-SQL-009) a mensagem do banco vai para a
/// tela e nunca para o log. Roda a API como processo, e não no `ApiHost`: só o processo liga o Serilog e escreve `logs/`, e um teste
/// que procura uma marca num log que nunca existiu passaria sem provar nada. Por isso o teste começa conferindo que o log existe e
/// registra a sessão, e só depois procura as marcas.
/// </summary>
[TestFixture]
[Category("Api")]
public sealed class LogHygieneTests
{
    /// <summary>
    /// As marcas são sorteadas a cada execução: nenhuma senha, mesmo de mentira, fica escrita em arquivo versionado. Cada uma é um texto
    /// que só este teste produz, e é isso que dá valor a "não aparece no log".
    /// </summary>
    private static readonly string Run = Guid.NewGuid().ToString("N")[..8];

    private static readonly string MarkedPassword = $"SENHA-MARCADA-{Run}";
    private static readonly string MarkedSql = $"SQL-MARCADO-{Run}";
    private static readonly string MarkedMissingTable = $"tabela_inexistente_{Run}";
    private static readonly string MarkedDetail = $"DETALHE-MARCADO-{Run}";
    private static readonly string MarkedSchema = $"ESQUEMA-MARCADO-{Run}";
    private static readonly string MarkedTable = $"TABELA-MARCADA-{Run}";

    /// <summary>A conexão que não abre: usuário e senha marcados. A mensagem do banco ("password authentication failed for user ...") leva o usuário, e é ela que não pode ir para o log.</summary>
    private static readonly string MarkedWrongUser = $"usuariomarcado{Run}";

    private static readonly string MarkedWrongPassword = $"SENHA-ERRADA-{Run}";

    private static readonly TimeSpan ShutdownTimeout = TimeSpan.FromSeconds(15);

    [Test]
    public async Task Logs_DoNotContainPasswordSqlOrTheDatabaseMessage()
    {
        var settings = await PostgresSingleton.GetSettingsAsync();
        await using var observer = await DatabaseObserver.OpenAsync(settings);
        // A conexão do teste entra no banco com um papel só dela e a senha marcada: a senha do contêiner é sorteada, e é nela que o log
        // de uma execução bem-sucedida teria de vazar para esta prova valer.
        var role = $"marcado{Run}";
        await observer.ExecuteAsync($"CREATE ROLE {role} LOGIN PASSWORD '{MarkedPassword}'");

        try
        {
            using var parent = ApiProcess.StartParentStandIn();
            using var api = await ApiProcess.StartAsync(parentProcessID: parent.Id);
            await api.Client.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
            var connectionID = await api.Client.CreateConnectionAsync(settings, userName: role, password: MarkedPassword);
            var sessionID = await api.Client.OpenSessionAsync(connectionID);

            // O resultado e a mensagem do banco chegam à tela...
            var selected = await api.Client.ExecuteAsync(sessionID, $"SELECT '{MarkedSql}'");
            Assert.That(selected.GetProperty("rows")[0][0].GetString(), Is.EqualTo(MarkedSql));
            var missing = await api.Client.ExecuteRawAsync(sessionID, $"SELECT * FROM {MarkedMissingTable}");
            Assert.That(missing.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
            Assert.That((await missing.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString(), Does.Contain(MarkedMissingTable));
            await api.Client.ExecuteAsync(sessionID, "CREATE TEMP TABLE marcada (valor text PRIMARY KEY)");
            await api.Client.ExecuteAsync(sessionID, $"INSERT INTO marcada VALUES ('{MarkedDetail}')");
            var duplicated = await api.Client.ExecuteRawAsync(sessionID, $"INSERT INTO marcada VALUES ('{MarkedDetail}')");
            Assert.That(duplicated.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
            Assert.That((await duplicated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString(), Does.Contain(MarkedDetail), "O DETAIL do banco tem de chegar à tela.");

            // ...e as demais rotas que falam com o banco, inclusive as que recebem nomes na rota e a que recusa a conexão.
            await api.Client.ExecuteAsync(sessionID, "SELECT n FROM generate_series(1, 300) AS n");
            Assert.That((await api.Client.PostAsync($"{PrismCalls.SessionsPath}/{sessionID}/queries/next", null)).StatusCode, Is.EqualTo(HttpStatusCode.OK));
            Assert.That((await api.Client.PostAsync($"{PrismCalls.SessionsPath}/{sessionID}/queries/count", null)).StatusCode, Is.EqualTo(HttpStatusCode.OK));
            Assert.That((await api.Client.GetAsync($"{PrismCalls.SessionsPath}/{sessionID}/schemas/{MarkedSchema}/tables/{MarkedTable}/columns")).StatusCode, Is.EqualTo(HttpStatusCode.OK));
            // A falha ao conectar não traz SQL nem resultado: a única marca possível é o que o próprio banco escreve na mensagem (o usuário) e o que o Prism
            // tem na mão (a senha). A mensagem tem de chegar à tela e não pode ir para o log, e a senha errada não pode ir a lugar nenhum.
            var failed = await api.Client.OpenSessionRawAsync(await api.Client.CreateConnectionAsync(settings, name: "Senha errada", userName: MarkedWrongUser, password: MarkedWrongPassword));
            Assert.That(failed.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
            var failure = (await failed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString();
            Assert.That(failure, Does.Contain(MarkedWrongUser), "A mensagem do banco tem de chegar à tela.");
            Assert.That(failure, Does.Not.Contain(MarkedWrongPassword));
            var tested = await api.Client.PostAsJsonAsync("/api/user/connections/test", new { engine = (int)settings.Engine, host = settings.Host, port = settings.Port, database = settings.Database, userName = role, password = MarkedPassword });
            Assert.That(tested.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
            // RN-CONN-016: duplicar copia a senha marcada dentro do cofre, e o log registra só os IDs.
            Assert.That((await api.Client.PostAsync($"/api/user/connections/{connectionID}/duplicate", null)).StatusCode, Is.EqualTo(HttpStatusCode.Created));

            // O desligamento de verdade: o host é descartado e o Serilog grava até o fim antes de o arquivo ser lido.
            Assert.That(await ApiProcess.StopThroughParentAsync(parent, api, ShutdownTimeout), Is.Zero);
            var logs = api.ReadLogs();

            Assert.That(logs, Is.Not.Empty, "A API não escreveu nenhum arquivo em logs/.");
            Assert.That(logs.Values.Any(log => log.Contains($"Sessão \"{sessionID}\" aberta", StringComparison.Ordinal)), Is.True, "O log não registra a sessão: o teste não prova nada se o log não está ligado.");
            // A falha ao conectar é registrada (classe e SQLSTATE, sem a mensagem): é a linha que as marcas da conexão errada não podem estar.
            Assert.That(logs.Values.Any(log => log.Contains("A sessão com o banco não abriu", StringComparison.Ordinal)), Is.True, "O log não registra a conexão que não abriu.");
            Assert.That(logs.Values.Any(log => log.Contains("duplicada; a cópia é a conexão", StringComparison.Ordinal)), Is.True, "O log não registra a conexão duplicada.");
            foreach (var (file, log) in logs)
            {
                Assert.That(log, Does.Not.Contain(MarkedPassword), $"{file} tem a senha do banco.");
                Assert.That(log, Does.Not.Contain(MarkedWrongPassword), $"{file} tem a senha de uma conexão que não abriu.");
                Assert.That(log, Does.Not.Contain(MarkedWrongUser), $"{file} tem a mensagem de erro do banco ao conectar, que leva o usuário.");
                Assert.That(log, Does.Not.Contain(MarkedSql), $"{file} tem o texto de um SQL ou o dado de um resultado.");
                Assert.That(log, Does.Not.Contain(MarkedMissingTable), $"{file} tem a mensagem de erro do banco ou o SQL.");
                Assert.That(log, Does.Not.Contain(MarkedDetail), $"{file} tem o DETAIL do banco.");
                Assert.That(log, Does.Not.Contain(MarkedSchema), $"{file} tem um nome de esquema da rota.");
                Assert.That(log, Does.Not.Contain(MarkedTable), $"{file} tem um nome de tabela da rota.");
                Assert.That(log, Does.Not.Contain("Password="), $"{file} tem uma string de conexão.");
            }
        }
        finally
        {
            await observer.ExecuteAsync($"DROP ROLE IF EXISTS {role}");
        }
    }
}
