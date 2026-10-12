using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// RN-COFRE-013: a troca de senha não derruba as sessões com os bancos, e o quinto erro seguido de senha atual, que fecha o cofre (RN-CONN-003, RN-COFRE-008), as
/// encerra. Fica num fixture à parte, contra o PostgreSQL de teste, para o resto da troca (`ChangePasswordTests`) não depender do Docker.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class ChangePasswordDatabaseSessionsTests
{
    private const string UserName = "marina.costa";
    private const string PasswordPath = "/api/user/password";

    private ConnectionSettings _settings = null!;
    private DatabaseObserver _observer = null!;

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        _settings = await PostgresSingleton.GetSettingsAsync();
        _observer = await DatabaseObserver.OpenAsync(_settings);
    }

    [OneTimeTearDown]
    public async Task StopAsync()
        => await _observer.DisposeAsync();

    /// <summary>O processo do PostgreSQL com este número existe (1) ou não existe mais (0) no `pg_stat_activity`: é o banco que diz, e não a API.</summary>
    private Task WaitForBackendAsync(long backendPid, long expected)
        => _observer.WaitForCountAsync($"SELECT COUNT(*) FROM pg_stat_activity WHERE pid = {backendPid}", expected, expected == 0 ? "A conexão da sessão continuou aberta no banco." : "O banco não mostrou a conexão da sessão.");

    [Test]
    public async Task Change_KeepsTheOpenDatabaseSessionAlive_AndNewSessionsStillOpen()
    {
        await using var host = await ApiHost.StartAsync();
        var oldPassword = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, oldPassword);
        var connectionID = await host.Client.CreateConnectionAsync(_settings);
        var sessionID = await host.Client.OpenSessionAsync(connectionID);
        var processBefore = await host.Client.BackendPidAsync(sessionID);

        var response = await host.Client.PutAsJsonAsync(PasswordPath, new { currentPassword = oldPassword, newPassword = UserFakers.RandomPassword() });

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        // A mesma sessão, a mesma conexão com o banco (o mesmo processo do PostgreSQL), sem reabrir nada.
        Assert.That(await host.Client.BackendPidAsync(sessionID), Is.EqualTo(processBefore));
        await WaitForBackendAsync(processBefore, 1);
        // E uma sessão nova abre: a geração do cofre não mudou, então a abertura não é recusada como cofre trocado no meio.
        var other = await host.Client.OpenSessionAsync(connectionID);
        Assert.That(other, Is.Not.EqualTo(sessionID));
    }

    /// <summary>
    /// RN-COFRE-013 e RN-CONN-003: o quinto erro seguido de senha atual fecha o cofre (401 `VAULT_LOCKED`), e fechar o cofre encerra as sessões com os bancos
    /// (RN-COFRE-008): a conexão com o PostgreSQL acaba de verdade, e depois de entrar de novo o identificador antigo não existe.
    /// </summary>
    [Test]
    public async Task Change_FifthWrongCurrentPassword_ClosesTheOpenDatabaseSession()
    {
        await using var host = await ApiHost.StartAsync();
        var password = UserFakers.RandomPassword();
        await host.CreateUserAsync(UserName, password);
        var sessionID = await host.Client.OpenSessionAsync(await host.Client.CreateConnectionAsync(_settings));
        var backendPid = await host.Client.BackendPidAsync(sessionID);
        await WaitForBackendAsync(backendPid, 1);

        for (var attempt = 1; attempt <= 4; attempt++)
        {
            var wrong = await host.Client.PutAsJsonAsync(PasswordPath, new { currentPassword = UserFakers.RandomPassword(), newPassword = UserFakers.RandomPassword() });
            Assert.That(wrong.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        }

        // Até o quarto erro a sessão segue viva.
        Assert.That(await host.Client.BackendPidAsync(sessionID), Is.EqualTo(backendPid));

        var fifth = await host.Client.PutAsJsonAsync(PasswordPath, new { currentPassword = UserFakers.RandomPassword(), newPassword = UserFakers.RandomPassword() });

        Assert.That(fifth.StatusCode, Is.EqualTo(HttpStatusCode.Unauthorized));
        Assert.That((await fifth.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("type").GetString(), Is.EqualTo("VAULT_LOCKED"));
        // Não basta o cofre fechar: a conexão com o banco tem de ter fechado, e o identificador antigo não existe depois de entrar de novo.
        await WaitForBackendAsync(backendPid, 0);
        Assert.That((await host.Client.PostAsJsonAsync("/api/public/sessions", new { userName = UserName, password })).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await host.Client.GetAsync($"{PrismCalls.SessionsPath}/{sessionID}/schemas")).StatusCode, Is.EqualTo(HttpStatusCode.NotFound));
    }
}
