using Prism.Api.Filters;
using Prism.Api.Hosting;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Drivers.Services;
using Prism.Infrastructure.Transfers.Services;

namespace Prism.Api;

public static class DependencyInjection
{
    /// <summary>Nome da política de CORS; só existe uma, com a origem da tela.</summary>
    private const string CorsPolicy = "PrismShell";

    public static IServiceCollection AddApi(this IServiceCollection services, PrismHostOptions options)
    {
        services.AddSingleton(options);

        // RN-API-002: o filtro de host aceita só 127.0.0.1. Fica no código, e não no `AllowedHosts` do
        // appsettings, para uma variável de ambiente ou um arquivo ausente não ampliarem a lista.
        services.AddHostFiltering(hosting => hosting.AllowedHosts = ["127.0.0.1"]);

        // RN-API-002: uma única origem, a da tela, e sem credenciais; nenhuma outra página aberta na
        // máquina lê uma resposta da API. Os cabeçalhos e métodos livres são os do preflight do fetch.
        services.AddCors(cors => cors.AddPolicy(CorsPolicy, policy => policy
            .WithOrigins(options.AllowedOrigin)
            .AllowAnyHeader()
            .AllowAnyMethod()));

        services.AddHostedService<ParentProcessWatcher>();

        // JSON: o padrão do MVC (`JsonSerializerDefaults.Web`, camelCase) já escreve `ID` como `id` e
        // `FolderID` como `folderID`; não há opção a configurar, e as telas dependem dessa grafia.
        // O application part garante os controllers desta assembly mesmo num host cujo ponto de
        // entrada é outro (o ApiHost dos testes).
        services.AddControllers(mvc => mvc.Filters.Add<GlobalValidationExceptionFilter>())
            .AddApplicationPart(typeof(DependencyInjection).Assembly);

        return services;
    }

    /// <summary>
    /// A ordem importa: a exceção que ninguém tratou vira o 500 fixo, o host é filtrado antes de
    /// qualquer roteamento, o CORS responde o preflight antes do token (o navegador não manda o
    /// token no preflight), o token vale para tudo o que chega aos endpoints, e a barreira do cofre
    /// vem depois dele: sem token a resposta é `AUTHENTICATION_REQUIRED`, e só quem o leva fica
    /// sabendo se o cofre está fechado (RN-API-005).
    /// </summary>
    public static IApplicationBuilder UseApi(this IApplicationBuilder app)
    {
        // RN-DRIVER-005: é na subida da API, antes de ela atender, que se decide quais drivers esta execução usa. Pedir o gerenciador
        // aqui roda a conferência da partida (a remoção marcada, a sobra de instalação interrompida, os hashes do que está instalado);
        // sem isto ela só rodaria na primeira requisição que o usasse.
        app.ApplicationServices.GetRequiredService<IDriverService>();

        // RN-EXPORT-018: também é na subida que a pasta `transfers` é criada (ou volta ao modo só do dono) e esvaziada do que sobrou de uma execução que caiu.
        app.ApplicationServices.GetRequiredService<ITransferService>();

        app.UseExceptionHandler(handler => handler.Run(WriteUnexpectedError));

        // O host do ASP.NET já põe este filtro no início do pipeline; a chamada explícita deixa a
        // RN-API-002 escrita aqui, onde quem lê a ordem do pipeline a procura.
        app.UseHostFiltering();
        app.UseRouting();
        app.UseCors(CorsPolicy);
        app.UseMiddleware<LaunchTokenMiddleware>();
        app.UseMiddleware<VaultGateMiddleware>();
        app.UseEndpoints(endpoints => endpoints.MapControllers());

        return app;
    }

    /// <summary>
    /// A exceção que nenhum handler tratou vira o 500 no formato da API, sem mensagem, tipo nem pilha,
    /// que diriam ao cliente como a aplicação é por dentro. A exceção inteira fica no log: o
    /// `ExceptionHandlerMiddleware` a escreve como erro antes de chamar este método.
    /// </summary>
    private static Task WriteUnexpectedError(HttpContext context)
        => HostErrors.WriteAsync(context, ApiErrorDto.CreateInternalServerError("Algo deu errado do nosso lado. Tente de novo em instantes."));
}
