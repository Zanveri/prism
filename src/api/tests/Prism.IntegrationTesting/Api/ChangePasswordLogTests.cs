using Prism.IntegrationTesting.Api.Support;
using System.Net;
using System.Net.Http.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// RN-LOG-001 na troca de senha (RN-COFRE-013): nem a senha atual, nem a nova, nem a errada, nem a inválida vão ao log da API, em nenhum dos
/// caminhos (troca certa, senha atual errada, senha nova inválida, igual à atual, falha de disco, quinto erro seguido). Roda a API como processo,
/// e não no `ApiHost`: só o processo liga o Serilog e escreve `logs/`, e procurar uma marca num log que nunca existiu passaria sem provar nada.
/// Por isso o teste começa conferindo que o log existe e que os caminhos que falham registraram algo. Não precisa de PostgreSQL: a troca só fala
/// com o arquivo do cofre.
/// </summary>
[TestFixture]
[Category("Api")]
public sealed class ChangePasswordLogTests
{
    /// <summary>
    /// As marcas são sorteadas a cada execução: nenhuma senha, mesmo de mentira, fica escrita em arquivo versionado. Cada uma é um texto que só este
    /// teste produz, e é isso que dá valor a "não aparece no log".
    /// </summary>
    private static readonly string Run = Guid.NewGuid().ToString("N")[..8];

    private static readonly string MarkedCurrent = $"ATUAL-MARCADA-{Run}";
    private static readonly string MarkedNew = $"NOVA-MARCADA-{Run}";
    private static readonly string MarkedWrong = $"ERRADA-MARCADA-{Run}";

    /// <summary>Inválida por ser comprida demais (129 caracteres ou mais): a marca cabe nela inteira, o que uma senha curta não permitiria.</summary>
    private static readonly string MarkedInvalid = $"INVALIDA-MARCADA-{Run}-{new string('x', 129)}";

    private const string UserName = "marina.costa";
    private const string PasswordPath = "/api/user/password";

    private static readonly TimeSpan ShutdownTimeout = TimeSpan.FromSeconds(15);

    private static Task<HttpResponseMessage> ChangeAsync(ApiProcess api, string currentPassword, string newPassword)
        => api.Client.PutAsJsonAsync(PasswordPath, new { currentPassword, newPassword });

    [Test]
    public async Task Logs_DoNotContainThePasswordsOfTheChange()
    {
        using var parent = ApiProcess.StartParentStandIn();
        using var api = await ApiProcess.StartAsync(parentProcessID: parent.Id);
        await api.Client.CreateUserAsync(UserName, MarkedCurrent);
        var temporary = Path.Combine(api.DataDirectory, "vaults", $"{UserName}.vault.json.tmp");

        // Senha atual errada (o log registra que o cofre não abriu, sem a senha), e a nova inválida (nem chega ao serviço).
        Assert.That((await ChangeAsync(api, MarkedWrong, MarkedNew)).StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That((await ChangeAsync(api, MarkedCurrent, MarkedInvalid)).StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        // Falha de disco: uma pasta no lugar do temporário da gravação. O log registra a classe do erro, e nunca a exceção, que traria o caminho.
        Directory.CreateDirectory(temporary);
        Assert.That((await ChangeAsync(api, MarkedCurrent, MarkedNew)).StatusCode, Is.EqualTo(HttpStatusCode.ServiceUnavailable));
        Directory.Delete(temporary);
        // Igual à atual, e a troca que dá certo.
        Assert.That((await ChangeAsync(api, MarkedCurrent, MarkedCurrent)).StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That((await ChangeAsync(api, MarkedCurrent, MarkedNew)).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        // O quinto erro seguido fecha o cofre.
        for (var attempt = 1; attempt <= 4; attempt++)
            Assert.That((await ChangeAsync(api, MarkedWrong, MarkedCurrent)).StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));

        Assert.That((await ChangeAsync(api, MarkedWrong, MarkedCurrent)).StatusCode, Is.EqualTo(HttpStatusCode.Unauthorized));

        // O desligamento de verdade: o host é descartado e o Serilog grava até o fim antes de o arquivo ser lido.
        Assert.That(await ApiProcess.StopThroughParentAsync(parent, api, ShutdownTimeout), Is.Zero);
        var logs = api.ReadLogs();

        Assert.That(logs, Is.Not.Empty, "A API não escreveu nenhum arquivo em logs/.");
        Assert.That(logs.Values.Any(log => log.Contains("O cofre não abriu em Open", StringComparison.Ordinal)), Is.True, "O log não registra a senha atual errada: o teste não prova nada se o log não está ligado.");
        Assert.That(logs.Values.Any(log => log.Contains("O arquivo do cofre falhou em Write", StringComparison.Ordinal)), Is.True, "O log não registra a falha de disco da gravação.");
        foreach (var (file, log) in logs)
        {
            Assert.That(log, Does.Not.Contain(MarkedCurrent), $"{file} tem a senha atual.");
            Assert.That(log, Does.Not.Contain(MarkedNew), $"{file} tem a senha nova.");
            Assert.That(log, Does.Not.Contain(MarkedWrong), $"{file} tem a senha errada.");
            Assert.That(log, Does.Not.Contain("INVALIDA-MARCADA"), $"{file} tem a senha nova inválida.");
            Assert.That(log, Does.Not.Contain(Run), $"{file} tem uma marca do teste.");
        }
    }
}
