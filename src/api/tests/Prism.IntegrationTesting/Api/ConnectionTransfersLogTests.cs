using Prism.IntegrationTesting.Api.Support;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// RN-LOG-001 e RN-TRANSF-008, 010 e 014: o log da exportação e da importação de conexões tem as contagens, os IDs e a classe da recusa, e nunca a senha de
/// exportação, o arquivo, a prévia, nomes, hosts, usuários ou senhas de banco, em nenhum caminho (exportar com a senha de banco, a senha do Prism errada, a
/// prévia, a senha de exportação errada, o arquivo inválido, importar). Roda a API como processo: só o processo liga o Serilog e escreve `logs/`. O teste
/// começa conferindo que o log registrou a exportação e a importação: procurar uma marca num log que nunca foi escrito passaria sem provar nada. Não precisa
/// de banco.
/// </summary>
[TestFixture]
[Category("Api")]
public sealed class ConnectionTransfersLogTests
{
    /// <summary>Sorteada a cada execução: um texto que só este teste produz.</summary>
    private static readonly string Run = Guid.NewGuid().ToString("N")[..8];

    private static readonly string MarkedName = $"NOME-MARCADO-{Run}";
    private static readonly string MarkedHost = $"host-marcado-{Run}.exemplo.invalid";
    private static readonly string MarkedUser = $"usuario-marcado-{Run}";
    private static readonly string MarkedDatabasePassword = $"senha-de-banco-marcada-{Run}";
    private static readonly string MarkedPassphrase = $"senha de exportação marcada {Run}";

    private static readonly TimeSpan ShutdownTimeout = TimeSpan.FromSeconds(15);

    [Test]
    public async Task Logs_DoNotContainTheFileThePassphraseNorTheConnectionData()
    {
        using var parent = ApiProcess.StartParentStandIn();
        using var api = await ApiProcess.StartAsync(parentProcessID: parent.Id);
        var userPassword = $"senha-{Run}-forte";
        await api.Client.CreateUserAsync("marina.costa", userPassword);

        var folder = await api.Client.PostAsJsonAsync("/api/user/folders", new { name = $"{MarkedName} pasta", environmentName = "Production" });
        var folderID = (await folder.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var connection = await api.Client.PostAsJsonAsync("/api/user/connections", new { folderID, name = MarkedName, engine = 3, host = MarkedHost, port = 9089, database = "estoque", userName = MarkedUser, password = MarkedDatabasePassword });
        var connectionID = (await connection.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var choice = new[] { new { id = connectionID, credentials = "userAndPassword" } };

        // A senha do Prism errada (contada) e a exportação com a senha de banco.
        Assert.That((await api.Client.PostAsJsonAsync("/api/user/connections/export", new { folderIDs = Array.Empty<Guid>(), connections = choice, passphrase = MarkedPassphrase, userPassword = $"errada-{Run}" })).StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        var exported = await api.Client.PostAsJsonAsync("/api/user/connections/export", new { folderIDs = Array.Empty<Guid>(), connections = choice, passphrase = MarkedPassphrase, userPassword });
        Assert.That(exported.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var content = (await exported.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("content").GetString()!;
        var ciphertext = JsonDocument.Parse(content).RootElement.GetProperty("payload").GetProperty("ciphertext").GetString()!;

        // A prévia, a senha de exportação errada, o arquivo inválido (com a marca dentro) e a importação.
        Assert.That((await api.Client.PostAsJsonAsync("/api/user/connections/import/preview", new { content, passphrase = MarkedPassphrase })).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await api.Client.PostAsJsonAsync("/api/user/connections/import/preview", new { content, passphrase = $"errada {MarkedPassphrase}" })).StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That((await api.Client.PostAsJsonAsync("/api/user/connections/import/preview", new { content = $"{{\"kind\":\"{MarkedName}\"", passphrase = MarkedPassphrase })).StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        var imported = await api.Client.PostAsJsonAsync("/api/user/connections/import", new { content, passphrase = MarkedPassphrase, items = new[] { "f1", "c1" } });
        Assert.That(imported.StatusCode, Is.EqualTo(HttpStatusCode.OK));

        Assert.That(await ApiProcess.StopThroughParentAsync(parent, api, ShutdownTimeout), Is.Zero);
        var logs = api.ReadLogs();

        Assert.That(logs, Is.Not.Empty, "A API não escreveu nenhum arquivo em logs/.");
        Assert.That(logs.Values.Any(log => log.Contains("Exportação de conexões:", StringComparison.Ordinal)), Is.True, "O log não registra a exportação: o teste não prova nada se o log não está ligado.");
        Assert.That(logs.Values.Any(log => log.Contains("Importação de conexões:", StringComparison.Ordinal)), Is.True, "O log não registra a importação.");
        Assert.That(logs.Values.Any(log => log.Contains(connectionID.ToString(), StringComparison.Ordinal)), Is.True, "O log da exportação deveria ter os IDs.");
        foreach (var (file, log) in logs)
        {
            Assert.That(log, Does.Not.Contain(Run), $"{file} tem uma marca do teste (nome, host, usuário, senha de banco, senha de exportação ou senha do Prism).");
            Assert.That(log, Does.Not.Contain(ciphertext[..40]), $"{file} tem o arquivo da exportação.");
        }
    }
}
