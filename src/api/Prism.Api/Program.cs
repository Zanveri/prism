using Microsoft.AspNetCore.Hosting.Server;
using Prism.Api;
using Prism.Api.Configurations;
using Prism.Api.Hosting;
using Prism.Application;
using Prism.Infrastructure;
using Serilog;
using System.Reflection;

PrismHostOptions options;

try
{
    options = PrismHostOptions.FromEnvironment(Environment.GetEnvironmentVariable);
}
catch (InvalidOperationException exception)
{
    // RN-API-003: a mensagem diz qual variável faltou. Vai para o erro padrão, porque a saída padrão
    // é só da linha de pronto, e ainda não há pasta de dados (nem log) para escrever.
    await Console.Error.WriteLineAsync(exception.Message);

    return 1;
}

try
{
    // A raiz de conteúdo é a pasta da DLL, e não o diretório de trabalho de quem iniciou o processo:
    // assim o appsettings.json é sempre o que está ao lado dela.
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, ContentRootPath = AppContext.BaseDirectory });

    // RN-API-002: só loopback, em porta escolhida pelo sistema.
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Host.UseSerilog((context, services, configuration) => LoggingConfiguration.ConfigureSerilog(configuration, context.Configuration, options.DataDirectory));
    builder.Services.AddApi(options).AddApplication().AddInfrastructure(options.DataDirectory);

    var app = builder.Build();

    // RN-VERSAO-004: a API diz a própria versão ao iniciar, para um relato de defeito dizer de que versão é. Vem do assembly de entrada, que é
    // o que o `dotnet publish -p:Version=` preenche (RN-VERSAO-003); fora de uma publicação vale a versão padrão do SDK. A linha leva só a
    // versão: nada de caminho de máquina, token ou nome de usuário. Sai antes do `StartAsync`, então já está no log quando a linha de pronto aparece.
    app.Logger.LogInformation("A API do Prism iniciou na versão {Version:l}.", Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "desconhecida");

    app.UseApi();

    await app.StartAsync();
    ReadyAnnouncer.Announce(app.Services.GetRequiredService<IServer>(), Console.Out);
    await app.WaitForShutdownAsync();

    // Depois do desligamento o host é descartado, e com ele os singletons descartáveis (o cofre aberto e
    // as sessões com os bancos, nas próximas tarefas) fecham o que mantêm aberto. Só neste caminho, e não
    // com `await using`: descartar o host descarta também o logger do Serilog, e uma falha depois do
    // Build() chegaria ao `catch` com o logger já descartado, perdendo o Log.Fatal.
    await app.DisposeAsync();

    return 0;
}
catch (Exception exception)
{
    Log.Fatal(exception, "A API terminou de forma inesperada.");
    await Console.Error.WriteLineAsync(exception.Message);

    return 1;
}
finally
{
    await Log.CloseAndFlushAsync();
}
