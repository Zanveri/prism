using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.NetworkInformation;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// A Prism.Api.dll como o Electron a inicia: um processo com as variáveis PRISM_*, a linha
/// `PRISM_API_READY &lt;porta&gt;` na saída padrão, só loopback e o encerramento junto com o pai
/// (RN-API-003 e RN-API-004), e o que ela faz ao encerrar (RN-SESSAO-004).
/// </summary>
[TestFixture]
[Category("Api")]
public sealed class ProcessHostingTests
{
    private static readonly TimeSpan ParentExitTimeout = TimeSpan.FromSeconds(5);

    /// <summary>Com uma sessão aberta o desligamento fecha a conexão com o banco antes de sair: mais que os 5 s de quando não há nada a fechar.</summary>
    private static readonly TimeSpan ShutdownTimeout = TimeSpan.FromSeconds(15);

    private static readonly TimeSpan LogPatience = TimeSpan.FromSeconds(10);

    [Test]
    public async Task Start_PrintsReadyLineWithListeningPort()
    {
        using var api = await ApiProcess.StartAsync();
        using var client = new HttpClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{api.Port}/rota/que/nao/existe");
        request.Headers.Authorization = new("Bearer", api.Token);

        var response = await client.SendAsync(request);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NotFound));
    }

    [Test]
    public async Task Start_ListensOnLoopbackOnly()
    {
        using var api = await ApiProcess.StartAsync();

        // A linha de pronto só traz a porta: o endereço em que ela escuta quem diz é o sistema.
        var listeners = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Where(endpoint => endpoint.Port == api.Port).ToList();

        Assert.That(listeners, Is.Not.Empty);
        Assert.That(listeners.Select(endpoint => endpoint.Address), Is.All.EqualTo(IPAddress.Loopback));
    }

    [Test]
    public async Task ParentExit_StopsTheApi()
    {
        using var parent = ApiProcess.StartParentStandIn();
        using var api = await ApiProcess.StartAsync(parentProcessID: parent.Id);

        parent.Kill();
        await parent.WaitForExitAsync();
        var exit = api.Process.WaitForExitAsync();
        var finished = await Task.WhenAny(exit, Task.Delay(ParentExitTimeout));

        Assert.That(finished, Is.SameAs(exit), "A API não saiu em até 5 s depois do processo pai.");
        Assert.That(api.Process.ExitCode, Is.Zero);
    }

    /// <summary>
    /// RN-VERSAO-004: ao iniciar, a API escreve a própria versão numa linha do log, para um relato de defeito dizer de que versão é. A linha
    /// vem do processo de verdade (é o `AssemblyInformationalVersionAttribute` do assembly de entrada que o `dotnet publish -p:Version=`
    /// preenche), lida depois do desligamento pelo pai de mentira, que deixa o log completo. Só a versão: nada de caminho de máquina, token ou
    /// nome de usuário.
    /// </summary>
    [Test]
    public async Task Start_LogsTheApiVersion_WithoutPathTokenOrUserName()
    {
        using var parent = ApiProcess.StartParentStandIn();
        using var api = await ApiProcess.StartAsync(parentProcessID: parent.Id);

        await ApiProcess.StopThroughParentAsync(parent, api, ParentExitTimeout);

        var lines = api.ReadLogs().Values.SelectMany(log => log.Split('\n')).Where(line => line.Contains("versão", StringComparison.Ordinal)).ToList();
        Assert.That(lines, Has.Count.EqualTo(1), "O log tem de trazer uma única linha com a versão da API.");
        var line = lines[0];
        Assert.That(line, Does.Match(@"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \S+ \[INF\] A API do Prism iniciou na versão \d+\.\d+\.\d+\S*\.\s*$"));
        Assert.That(line, Does.Not.Contain(api.DataDirectory));
        Assert.That(line, Does.Not.Contain(api.Token));
    }

    [Test]
    public async Task Start_WithoutToken_ExitsWithError()
    {
        using var api = await ApiProcess.StartAsync(withToken: false);

        Assert.That(api.Process.ExitCode, Is.Not.Zero);
        Assert.That(api.ErrorOutput, Does.Contain("PRISM_API_TOKEN"));
    }

    /// <summary>
    /// RN-SESSAO-004: encerrar a API fecha as sessões com os bancos. O processo de verdade, com uma sessão aberta e o processo do
    /// PostgreSQL dela reconhecido pelo número. Sair com código zero e o banco já sem a conexão não bastam para provar que foi a API
    /// quem a fechou (o sistema fecha os sockets de quem morre); por isso o log tem de trazer a linha "fechada" da sessão (o Serilog escreve o Guid entre
    /// aspas), que só o descarte do registro escreve.
    /// </summary>
    [Test]
    public async Task Shutdown_ClosesDatabaseSessions()
    {
        var settings = await PostgresSingleton.GetSettingsAsync();
        await using var observer = await DatabaseObserver.OpenAsync(settings);
        using var parent = ApiProcess.StartParentStandIn();
        using var api = await ApiProcess.StartAsync(parentProcessID: parent.Id);
        await api.Client.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var sessionID = await api.Client.OpenSessionAsync(await api.Client.CreateConnectionAsync(settings));
        var backendPid = await api.Client.BackendPidAsync(sessionID);
        await observer.WaitForCountAsync($"SELECT COUNT(*) FROM pg_stat_activity WHERE pid = {backendPid}", 1, "O banco não mostrou a conexão da sessão aberta.");

        var exitCode = await ApiProcess.StopThroughParentAsync(parent, api, ShutdownTimeout);

        Assert.That(exitCode, Is.Zero);
        await observer.WaitForCountAsync($"SELECT COUNT(*) FROM pg_stat_activity WHERE pid = {backendPid}", 0, "A conexão da sessão continuou aberta no banco depois que a API encerrou.");
        Assert.That(api.ReadLogs().Values.Any(log => log.Contains($"Sessão \"{sessionID}\" fechada.", StringComparison.Ordinal)), Is.True, "O log não traz a linha de fechamento da sessão.");
    }

    /// <summary>
    /// Sair (RN-COFRE-008) e excluir a conexão (RN-CONN-014) fecham as conexões com o banco. O número do processo do PostgreSQL sumir do
    /// `pg_stat_activity` não prova que a API as fechou: uma conexão tirada do registro e largada também some, quando o coletor de lixo
    /// finaliza o socket. A linha `Sessão "<id>" fechada.` do log, que só o descarte da conexão escreve, prova o fechamento explícito.
    /// </summary>
    [Test]
    public async Task SignOut_ClosesDatabaseSessions_AndLogsTheClosing()
    {
        var settings = await PostgresSingleton.GetSettingsAsync();
        await using var observer = await DatabaseObserver.OpenAsync(settings);
        using var parent = ApiProcess.StartParentStandIn();
        using var api = await ApiProcess.StartAsync(parentProcessID: parent.Id);
        await api.Client.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var sessionID = await api.Client.OpenSessionAsync(await api.Client.CreateConnectionAsync(settings));
        var backendPid = await api.Client.BackendPidAsync(sessionID);
        await observer.WaitForCountAsync($"SELECT COUNT(*) FROM pg_stat_activity WHERE pid = {backendPid}", 1, "O banco não mostrou a conexão da sessão aberta.");

        var response = await api.Client.DeleteAsync("/api/public/sessions");

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(await api.WaitForLogAsync($"Sessão \"{sessionID}\" fechada.", LogPatience), Is.True, "O log não traz a linha de fechamento da sessão.");
        await observer.WaitForCountAsync($"SELECT COUNT(*) FROM pg_stat_activity WHERE pid = {backendPid}", 0, "A conexão da sessão continuou aberta no banco depois de sair.");
    }

    [Test]
    public async Task DeleteConnection_ClosesItsDatabaseSessions_AndLogsTheClosing()
    {
        var settings = await PostgresSingleton.GetSettingsAsync();
        await using var observer = await DatabaseObserver.OpenAsync(settings);
        using var parent = ApiProcess.StartParentStandIn();
        using var api = await ApiProcess.StartAsync(parentProcessID: parent.Id);
        await api.Client.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var connectionID = await api.Client.CreateConnectionAsync(settings);
        var sessionID = await api.Client.OpenSessionAsync(connectionID);
        var backendPid = await api.Client.BackendPidAsync(sessionID);
        await observer.WaitForCountAsync($"SELECT COUNT(*) FROM pg_stat_activity WHERE pid = {backendPid}", 1, "O banco não mostrou a conexão da sessão aberta.");

        var response = await api.Client.DeleteAsync($"/api/user/connections/{connectionID}");

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(await api.WaitForLogAsync($"Sessão \"{sessionID}\" fechada.", LogPatience), Is.True, "O log não traz a linha de fechamento da sessão.");
        await observer.WaitForCountAsync($"SELECT COUNT(*) FROM pg_stat_activity WHERE pid = {backendPid}", 0, "A conexão da sessão continuou aberta no banco depois de excluir a conexão.");
    }
}
