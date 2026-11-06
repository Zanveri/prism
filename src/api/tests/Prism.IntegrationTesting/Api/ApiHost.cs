using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Prism.Api;
using Prism.Api.Hosting;
using Prism.Application;
using Prism.Application.Sessions.Models.Dtos;
using Prism.Infrastructure;
using Prism.Infrastructure.ConnectionFiles.Models;
using Prism.Infrastructure.Vault.Models;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// A API de verdade — `AddApi`, `AddApplication`, `AddInfrastructure`, os controllers e o pipeline
/// do `UseApi` — ouvindo numa porta efêmera de 127.0.0.1 e chamada por HTTP. Cada host tem o
/// próprio token e a própria pasta de dados temporária, apagada no `DisposeAsync`.
/// </summary>
public sealed class ApiHost : IAsyncDisposable
{
    /// <summary>A origem que o host declara em `PRISM_ALLOWED_ORIGIN`: o servidor do Vite.</summary>
    public const string AllowedOrigin = "http://localhost:5173";

    private readonly WebApplication _app;

    public string Token { get; }
    public string DataDirectory { get; }
    public IServiceProvider Services => _app.Services;

    /// <summary>Já leva o token de lançamento em `Authorization`.</summary>
    public HttpClient Client { get; }

    public HttpClient ClientWithoutToken { get; }

    private ApiHost(WebApplication app, string token, string dataDirectory, Uri baseAddress)
    {
        _app = app;
        Token = token;
        DataDirectory = dataDirectory;
        Client = new HttpClient { BaseAddress = baseAddress };
        Client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        ClientWithoutToken = new HttpClient { BaseAddress = baseAddress };
    }

    /// <param name="configure">
    /// Troca ou acrescenta registros depois dos de verdade, para o teste que precisa de um substituto.
    /// O Argon2id já vem pequeno (8 MiB, uma passada), no cofre e no arquivo da exportação de conexões: com o padrão da RN-COFRE-002 cada entrada leva
    /// cerca de 0,3 s e a suíte ficaria lenta. Um teste que quer outros parâmetros reconfigura aqui.
    /// </param>
    public static async Task<ApiHost> StartAsync(Action<IServiceCollection>? configure = null)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var dataDirectory = Directory.CreateTempSubdirectory("prism-tests-").FullName;
        var options = new PrismHostOptions(token, dataDirectory, AllowedOrigin, null);

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddApi(options).AddApplication().AddInfrastructure(dataDirectory);
        builder.Services.Configure<VaultOptions>(vault =>
        {
            vault.MemoryKiB = 8192;
            vault.Iterations = 1;
            vault.Parallelism = 1;
        });

        // O arquivo da exportação de conexões (RN-TRANSF-007) com o mesmo Argon2id pequeno: o cabeçalho registra os parâmetros, e a importação usa os dele.
        builder.Services.Configure<ConnectionFileOptions>(file =>
        {
            file.MemoryKiB = 8192;
            file.Iterations = 1;
            file.Parallelism = 1;
        });
        configure?.Invoke(builder.Services);

        var app = builder.Build();
        app.UseApi();
        await app.StartAsync();

        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();

        return new ApiHost(app, token, dataDirectory, new Uri(address));
    }

    /// <summary>Cria o usuário pela rota de verdade (`POST api/public/users`), que já deixa o cofre dele aberto.</summary>
    public async Task<SessionDto> CreateUserAsync(string userName, string password)
    {
        var response = await Client.PostAsJsonAsync("/api/public/users", new { userName, password });
        response.EnsureSuccessStatusCode();

        return (await response.Content.ReadFromJsonAsync<SessionDto>())!;
    }

    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        ClientWithoutToken.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
        Directory.Delete(DataDirectory, recursive: true);
    }
}
