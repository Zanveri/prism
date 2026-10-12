using Prism.Application.Common.Vault;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using System.Text.Json;

namespace Prism.Api.Hosting;

/// <summary>
/// Os erros que o pipeline responde antes de qualquer controller, e a forma de escrevê-los: o
/// corpo é o mesmo `ApiErrorDto` (`application/problem+json`) que os controllers devolvem.
/// </summary>
internal static class HostErrors
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>RN-API-001: sem o token de lançamento, ou com outro, a requisição não passa.</summary>
    public static ApiErrorDto AuthenticationRequired()
        => ApiErrorDto.CreateUnauthorized("Autenticação necessária.", "AUTHENTICATION_REQUIRED", "A requisição não traz o token de lançamento da API.");

    /// <summary>
    /// RN-API-005: rotas `api/user/...` só respondem com um cofre aberto. É o mesmo erro que os handlers
    /// devolvem quando o cofre fecha no meio de uma operação, então a escrita é a do `VaultErrors`.
    /// </summary>
    public static ApiErrorDto VaultLocked()
        => VaultErrors.From(EVaultError.Locked);

    public static async Task WriteAsync(HttpContext context, ApiErrorDto error)
    {
        if (context.Response.HasStarted)
            return;

        context.Response.StatusCode = (int)error.StatusCode;
        context.Response.ContentType = "application/problem+json";

        await context.Response.WriteAsync(JsonSerializer.Serialize(error, JsonOptions));
    }
}
