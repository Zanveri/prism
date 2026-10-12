using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Prism.Infrastructure.Drivers.Models;

namespace Prism.TestingCore.Extensions;

public static class DriverTestingExtensions
{
    /// <summary>
    /// A costura de teste do gerenciador de drivers (RN-DRIVER-008): troca, no host de teste, o servidor de onde o pacote vem e, se o
    /// teste quiser, o catálogo, a plataforma e a pasta de drivers. Em produção o endereço é a constante do nuget.org e nada disto é
    /// configurável; os registros trocados são internos, e esta extensão fica aqui para o projeto de integração continuar sem enxergar
    /// nada interno da aplicação. Chamar depois de `AddInfrastructure`.
    /// </summary>
    public static IServiceCollection UseDriverSource(this IServiceCollection services, Uri? packageSource = null, string? catalogJson = null, string? platform = null, string? directory = null)
    {
        var settings = (DriverSettings)services.Last(service => service.ServiceType == typeof(DriverSettings)).ImplementationInstance!;
        services.RemoveAll<DriverSettings>();
        services.AddSingleton(settings with { PackageSource = packageSource ?? settings.PackageSource, Platform = platform ?? settings.Platform, Directory = directory ?? settings.Directory });

        if (catalogJson is null)
            return services;

        services.RemoveAll<DriverCatalog>();
        services.AddSingleton(DriverCatalog.Parse(catalogJson));

        return services;
    }
}
