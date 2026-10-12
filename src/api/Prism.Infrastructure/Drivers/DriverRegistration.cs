using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure.Drivers.Clients;
using Prism.Infrastructure.Drivers.Models;
using Prism.Infrastructure.Drivers.Services;

namespace Prism.Infrastructure.Drivers;

public static class DriverRegistration
{
    /// <summary>
    /// O gerenciador de drivers sob demanda (seção 16 da especificação). O catálogo é lido e conferido aqui, na partida: com ele errado
    /// a API não sobe. O endereço do nuget.org e a pasta vêm de <see cref="DriverSettings.For"/>, sem variável de ambiente nem arquivo de
    /// configuração (RN-DRIVER-008); o host de teste troca o registro pela extensão do `Prism.TestingCore`.
    /// </summary>
    /// <param name="dataDirectory">`PRISM_DATA_DIR`: os drivers ficam em `drivers/`, dentro dela, e servem a todos os usuários do Prism naquela conta do sistema (RN-DRIVER-009).</param>
    public static IServiceCollection AddDrivers(this IServiceCollection services, string dataDirectory)
    {
        services.AddSingleton(DriverCatalog.LoadDefault());
        services.AddSingleton(DriverSettings.For(dataDirectory));

        // Singleton, ao contrário dos outros clients: é dono do `HttpClient`, que vive enquanto a API vive.
        services.AddSingleton<IDriverPackageClient, DriverPackageClient>();

        // Singleton, como o cofre e o registro de sessões: guarda o estado das instalações entre as requisições, e o descarte do
        // contêiner (o desligamento da API) interrompe a que estiver em andamento.
        services.AddSingleton<IDriverService, DriverService>();

        return services;
    }
}
