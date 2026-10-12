using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Drivers.Clients;
using Prism.Infrastructure.Drivers.Models;
using System.Runtime.InteropServices;

namespace Prism.UnitTesting.Drivers;

/// <summary>
/// RN-DRIVER-006, com a composição de verdade (`AddInfrastructure`) e nenhum driver instalado: abrir sessão ou testar conexão de Db2 e
/// de Informix responde `DriverNotInstalled`, com o identificador do driver, sem conectar e sem tocar em tipo nenhum da IBM. **Este
/// teste roda num processo em que o assembly `IBM.Data.Db2` não existe**: a pasta de saída dos testes de unidade não o leva (o driver
/// é referência só de compilação). Se algum caminho chegasse ao client de verdade, o .NET falharia ao carregar o assembly, e a
/// resposta seria uma exceção, e não a recusa.
/// </summary>
public sealed class DriverNotInstalledTests : IAsyncLifetime
{
    private const string IbmDriverID = "ibm-data-server";

    private readonly string _dataDirectory = Directory.CreateTempSubdirectory("prism-sem-driver-").FullName;
    private readonly ServiceProvider _provider;

    public DriverNotInstalledTests()
        => _provider = new ServiceCollection().AddInfrastructure(_dataDirectory).BuildServiceProvider();

    public Task InitializeAsync()
        => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        await _provider.DisposeAsync();
        Directory.Delete(_dataDirectory, recursive: true);
    }

    /// <summary>Um endereço em que nada atende: se a API tentasse conectar, a falha seria `ConnectionFailed`, e não a recusa do driver.</summary>
    private static ConnectionSettings Settings(EDatabaseEngine engine)
        => new(engine, "127.0.0.1", 1, "banco", "usuario", "senha-de-teste");

    /// <summary>
    /// Há driver da IBM para esta API nesta máquina? Só quando a API foi compilada com os clients do Db2 e do Informix (sem eles, como
    /// no macOS Intel ou com `-p:IbmDriverRuntime=osx-x64`, a Infrastructure nem referencia o assembly) e o catálogo de verdade tem
    /// pacote para a plataforma em que ela roda. Sem driver possível, a resposta certa é outra (RN-DRIVER-006).
    /// </summary>
    private static bool PlatformHasIbmDriver
        => typeof(DependencyInjection).Assembly.GetReferencedAssemblies().Any(assembly => assembly.Name == "IBM.Data.Db2") && DriverCatalog.LoadDefault().Find(IbmDriverID)!.PackageFor(RuntimeInformation.RuntimeIdentifier) is not null;

    private static bool IbmAssemblyIsLoaded
        => AppDomain.CurrentDomain.GetAssemblies().Any(assembly => assembly.GetName().Name == "IBM.Data.Db2");

    [Trait("DriverNotInstalled", "TestAsync")]
    [Fact(DisplayName = "Erro testar conexão de Db2 e de Informix sem o driver: DriverNotInstalled com o driver, sem carregar nada da IBM")]
    public async Task Test_WithoutTheDriver_IsDriverNotInstalled_AndNoIbmTypeIsLoaded()
    {
        //Arrange
        var service = _provider.GetRequiredService<IDatabaseSessionService>();

        //Act
        var db2 = await service.TestAsync(Settings(EDatabaseEngine.Db2), CancellationToken.None);
        var informix = await service.TestAsync(Settings(EDatabaseEngine.Informix), CancellationToken.None);

        //Assert
        AssertRefusal(db2.Error);
        AssertRefusal(informix.Error);
        Assert.False(IbmAssemblyIsLoaded);
    }

    [Trait("DriverNotInstalled", "OpenAsync")]
    [Fact(DisplayName = "Erro abrir sessão de Db2 e de Informix sem o driver: DriverNotInstalled com o driver, sem carregar nada da IBM")]
    public async Task Open_WithoutTheDriver_IsDriverNotInstalled_AndNoIbmTypeIsLoaded()
    {
        //Arrange
        var service = _provider.GetRequiredService<IDatabaseSessionService>();

        //Act
        var db2 = await service.OpenAsync(Guid.NewGuid(), Settings(EDatabaseEngine.Db2), 0, CancellationToken.None);
        var informix = await service.OpenAsync(Guid.NewGuid(), Settings(EDatabaseEngine.Informix), 0, CancellationToken.None);

        //Assert
        AssertRefusal(db2.Error);
        AssertRefusal(informix.Error);
        Assert.False(service.HasOpenSession([EDatabaseEngine.Db2, EDatabaseEngine.Informix]));
        Assert.False(IbmAssemblyIsLoaded);
    }

    /// <summary>Sem o driver, quem ocupa o lugar dos dois clients da IBM é o que só responde a recusa; o do PostgreSQL é o de verdade.</summary>
    [Trait("DriverNotInstalled", "AddInfrastructure")]
    [Fact(DisplayName = "OK sem o driver, os clients do Db2 e do Informix são os que só respondem a recusa")]
    public void Clients_WithoutTheDriver_AreTheRefusingOnes()
    {
        //Act
        var clients = _provider.GetServices<IDatabaseClient>().ToDictionary(client => client.Engine);

        //Assert
        Assert.IsType<PostgresClient>(clients[EDatabaseEngine.PostgreSql]);

        if (!PlatformHasIbmDriver)
            return;

        Assert.IsType<MissingDriverDatabaseClient>(clients[EDatabaseEngine.Db2]);
        Assert.IsType<MissingDriverDatabaseClient>(clients[EDatabaseEngine.Informix]);
        Assert.False(IbmAssemblyIsLoaded);
    }

    private static void AssertRefusal(DatabaseFailure failure)
    {
        // RN-DRIVER-006: onde o fabricante não publica o driver, a resposta é a falha de conexão que diz isso.
        if (!PlatformHasIbmDriver)
        {
            Assert.Equal(EDatabaseFailure.ConnectionFailed, failure.Kind);

            return;
        }

        Assert.Equal(EDatabaseFailure.DriverNotInstalled, failure.Kind);
        Assert.Equal(IbmDriverID, failure.DriverID);
        Assert.Contains("IBM Data Server", failure.Message);
    }
}
