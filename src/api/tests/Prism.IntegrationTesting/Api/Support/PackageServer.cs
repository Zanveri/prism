using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System.Collections.Concurrent;

namespace Prism.IntegrationTesting.Api.Support;

/// <summary>
/// Um servidor HTTP de mentira em 127.0.0.1, no lugar do nuget.org: o gerenciador de drivers fala com ele por um socket de verdade, com
/// o mesmo cliente HTTP de produção (sem seguir redirecionamento, com os prazos dele). Cada teste diz o que o servidor responde; o
/// servidor guarda o que recebeu, e é assim que um teste prova que uma requisição NÃO foi feita.
/// </summary>
internal sealed class PackageServer : IAsyncDisposable
{
    private readonly WebApplication _app;
    private readonly ConcurrentQueue<string> _requests = new();

    public Uri Address { get; private set; } = null!;

    /// <summary>`GET /caminho`, na ordem em que chegaram.</summary>
    public IReadOnlyCollection<string> Requests => _requests;

    private PackageServer(Func<HttpContext, int, Task> respond)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();

        // Um teste pode acabar com uma resposta ainda presa; o servidor não espera por ela para fechar.
        builder.Services.Configure<HostOptions>(options => options.ShutdownTimeout = TimeSpan.FromSeconds(1));

        _app = builder.Build();
        _app.Run(context =>
        {
            _requests.Enqueue($"{context.Request.Method} {context.Request.Path}");

            return respond(context, _requests.Count);
        });
    }

    /// <param name="respond">Recebe a requisição e o número dela (a primeira é 1): um teste responde de um jeito na primeira tentativa e de outro na segunda.</param>
    public static async Task<PackageServer> StartAsync(Func<HttpContext, int, Task> respond)
    {
        var server = new PackageServer(respond);
        await server._app.StartAsync();
        server.Address = new Uri(server._app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single() + "/");

        return server;
    }

    public static Task<PackageServer> StartAsync(Func<HttpContext, Task> respond)
        => StartAsync((context, _) => respond(context));

    /// <summary>O pacote inteiro, com o tamanho anunciado, como o nuget.org responde.</summary>
    public static Func<HttpContext, Task> Serve(byte[] package)
        => async context =>
        {
            context.Response.ContentType = "application/octet-stream";
            context.Response.ContentLength = package.Length;
            await context.Response.Body.WriteAsync(package, context.RequestAborted);
        };

    /// <summary>Anuncia o pacote inteiro, manda só o começo e derruba a conexão.</summary>
    public static Func<HttpContext, Task> DropAfter(byte[] package, int sentBytes)
        => async context =>
        {
            context.Response.ContentLength = package.Length;
            await context.Response.Body.WriteAsync(package.AsMemory(0, sentBytes), context.RequestAborted);
            await context.Response.Body.FlushAsync(context.RequestAborted);
            context.Abort();
        };

    /// <summary>
    /// Manda o começo do pacote e só continua quando o teste libera: o download fica em andamento pelo tempo que o teste quiser. Com
    /// `start`, nem os cabeçalhos saem antes de o teste liberar: é o download que começou e ainda não recebeu o primeiro byte.
    /// </summary>
    public static Func<HttpContext, Task> ServeSlowly(byte[] package, int firstBytes, Task release, Task? start = null)
        => async context =>
        {
            await (start ?? Task.CompletedTask).WaitAsync(context.RequestAborted);
            context.Response.ContentLength = package.Length;
            await context.Response.Body.WriteAsync(package.AsMemory(0, firstBytes), context.RequestAborted);
            await context.Response.Body.FlushAsync(context.RequestAborted);
            await release.WaitAsync(context.RequestAborted);
            await context.Response.Body.WriteAsync(package.AsMemory(firstBytes), context.RequestAborted);
        };

    public async ValueTask DisposeAsync()
    {
        await _app.StopAsync();
        await _app.DisposeAsync();
    }
}
