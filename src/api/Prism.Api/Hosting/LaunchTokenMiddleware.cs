using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;

namespace Prism.Api.Hosting;

/// <summary>
/// RN-API-001: toda requisição, de qualquer caminho, leva o token de lançamento em
/// `Authorization: Bearer`. Existe para que outro programa, ou uma página web aberta na mesma
/// máquina, não use a API. A comparação é em tempo constante, para o tempo de resposta não
/// revelar quantos caracteres do palpite estão certos.
/// </summary>
internal sealed class LaunchTokenMiddleware(RequestDelegate next, PrismHostOptions options)
{
    private readonly byte[] _launchToken = Encoding.UTF8.GetBytes(options.ApiToken);

    public async Task InvokeAsync(HttpContext context)
    {
        if (!CarriesLaunchToken(context.Request))
        {
            // O 401 pede o esquema, como manda o HTTP, e nada além dele sobre o motivo da recusa.
            context.Response.Headers.WWWAuthenticate = "Bearer";
            await HostErrors.WriteAsync(context, HostErrors.AuthenticationRequired());

            return;
        }

        await next(context);
    }

    private bool CarriesLaunchToken(HttpRequest request)
    {
        if (!AuthenticationHeaderValue.TryParse(request.Headers.Authorization, out var header) || header.Parameter is null || !string.Equals(header.Scheme, "Bearer", StringComparison.OrdinalIgnoreCase))
            return false;

        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(header.Parameter), _launchToken);
    }
}
