using Prism.Infrastructure.Vault.Services;

namespace Prism.Api.Hosting;

/// <summary>
/// RN-API-005: toda rota `api/user/...` responde 401 `VAULT_LOCKED` enquanto não houver cofre aberto. É
/// a barreira que os controllers dos dados do usuário (pastas, conexões, bancos) herdam sem repetir
/// nada. Fica depois do `LaunchTokenMiddleware`: quem não leva o token recebe `AUTHENTICATION_REQUIRED`,
/// e nunca descobre pelo código se há um cofre aberto. As rotas `api/public/...` não passam por ela.
/// </summary>
internal sealed class VaultGateMiddleware(RequestDelegate next, IVaultService vaultService)
{
    // `StartsWithSegments` não diferencia maiúsculas, como o roteamento: `/API/USER/...` chega ao mesmo controller, então a barreira o cobre também.
    private static readonly PathString UserRoutes = new("/api/user");

    public async Task InvokeAsync(HttpContext context)
    {
        if (!vaultService.IsUnlocked && context.Request.Path.StartsWithSegments(UserRoutes))
        {
            await HostErrors.WriteAsync(context, HostErrors.VaultLocked());

            return;
        }

        await next(context);
    }
}
