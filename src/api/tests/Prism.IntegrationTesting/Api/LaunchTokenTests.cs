using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// A porta de entrada da API (RN-API-001 e RN-API-002): token de lançamento em tempo constante,
/// uma única origem de CORS, só o host 127.0.0.1 e o 500 fixo para o que ninguém tratou.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class LaunchTokenTests
{
    [Test]
    public async Task AnyRoute_WithoutToken_Returns401AuthenticationRequired()
    {
        await using var host = await ApiHost.StartAsync();

        var response = await host.ClientWithoutToken.GetAsync("/api/user/folders");

        await AssertAuthenticationRequired(response);
    }

    [Test]
    public async Task AnyRoute_WithWrongToken_Returns401AuthenticationRequired()
    {
        await using var host = await ApiHost.StartAsync();
        // Mesmo tamanho do token certo: é o caso em que a comparação em tempo constante precisa recusar pelo conteúdo.
        var wrongToken = host.Token[..^1] + "x";
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/public/sessions");
        request.Headers.Authorization = new("Bearer", wrongToken);

        var response = await host.ClientWithoutToken.SendAsync(request);

        await AssertAuthenticationRequired(response);
    }

    [Test]
    public async Task UnknownRoute_WithToken_Returns404()
    {
        await using var host = await ApiHost.StartAsync();

        var response = await host.Client.GetAsync("/rota/que/nao/existe");

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NotFound));
    }

    [Test]
    public async Task Preflight_FromAllowedOrigin_IsAnswered()
    {
        await using var host = await ApiHost.StartAsync();
        // O navegador não manda o token no preflight; sem Access-Control-Request-Method o CORS nem o trata como preflight.
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/user/folders");
        request.Headers.Add("Origin", ApiHost.AllowedOrigin);
        request.Headers.Add("Access-Control-Request-Method", "GET");
        request.Headers.Add("Access-Control-Request-Headers", "authorization");

        var response = await host.ClientWithoutToken.SendAsync(request);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(response.Headers.GetValues("Access-Control-Allow-Origin"), Is.EqualTo(new[] { ApiHost.AllowedOrigin }));
        Assert.That(response.Headers.GetValues("Access-Control-Allow-Headers"), Has.Some.Contain("authorization"));
    }

    [Test]
    public async Task Request_FromOtherOrigin_HasNoCorsHeader()
    {
        await using var host = await ApiHost.StartAsync();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/rota/que/nao/existe");
        request.Headers.Add("Origin", "https://outro-site.example");

        var response = await host.Client.SendAsync(request);

        Assert.That(response.Headers.Contains("Access-Control-Allow-Origin"), Is.False);
    }

    [Test]
    public async Task Request_WithOtherHost_IsRefused()
    {
        await using var host = await ApiHost.StartAsync();
        // Com o token certo, para o 400 só poder vir do filtro de host.
        using var request = new HttpRequestMessage(HttpMethod.Get, "/rota/que/nao/existe");
        request.Headers.Host = "evil.example";

        var response = await host.Client.SendAsync(request);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.BadRequest));
    }

    [Test]
    public async Task UnhandledException_Returns500WithoutDetail()
    {
        await using var host = await ApiHost.StartAsync(services => services.AddTransient<IStartupFilter, ThrowAtEndOfPipeline>());

        var response = await host.Client.GetAsync("/rota/que/nao/existe");

        var body = await response.Content.ReadAsStringAsync();
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.InternalServerError));
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(JsonDocument.Parse(body).RootElement.GetProperty("type").GetString(), Is.EqualTo("INTERNAL_SERVER_ERROR"));
        Assert.That(body, Does.Not.Contain(ThrowAtEndOfPipeline.Secret));
    }

    private static async Task AssertAuthenticationRequired(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Unauthorized));
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo("AUTHENTICATION_REQUIRED"));
    }

    /// <summary>Faz a requisição que nenhum endpoint atendeu estourar, atrás de todo o pipeline do `UseApi`.</summary>
    private sealed class ThrowAtEndOfPipeline : IStartupFilter
    {
        public const string Secret = "detalhe interno que o cliente não pode ver";

        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            next(app);
            app.Run(_ => throw new InvalidOperationException(Secret));
        };
    }
}
