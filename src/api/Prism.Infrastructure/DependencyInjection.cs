using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Prism.Infrastructure.ConnectionFiles.Clients;
using Prism.Infrastructure.ConnectionFiles.Models;
using Prism.Infrastructure.ConnectionFiles.Services;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.DbeaverSources.Clients;
using Prism.Infrastructure.DbeaverSources.Services;
using Prism.Infrastructure.Drivers;
using Prism.Infrastructure.Drivers.Clients;
using Prism.Infrastructure.Drivers.Services;
using Prism.Infrastructure.Plugins.Clients;
using Prism.Infrastructure.Plugins.Models;
using Prism.Infrastructure.Transfers.Clients;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Services;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Serilog;

namespace Prism.Infrastructure;

public static class DependencyInjection
{
    /// <param name="dataDirectory">`PRISM_DATA_DIR`. A Infrastructure não enxerga o `PrismHostOptions`, que é da Api, então recebe só a pasta: é nela que ficam os cofres.</param>
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, string dataDirectory)
    {
        // RN-DIARIO-001: carrega o binário nativo do SQLCipher antes da primeira conexão com o diário.
        SQLitePCL.Batteries_V2.Init();

        // Os clients de integração logam pelo Serilog. Quem registra o logger de verdade é o `UseSerilog`
        // do Program.cs; este é o reserva para o host que não o chama (o ApiHost dos testes), e por ser
        // `TryAdd` nunca toma o lugar do outro.
        services.TryAddSingleton(_ => Log.Logger);

        services.Configure<VaultOptions>(options => options.DataDirectory = dataDirectory);
        services.AddTransient<IVaultFileClient, VaultFileClient>();

        // Singleton de propósito, ao contrário dos demais services: é ele que guarda o cofre aberto (a
        // chave e o documento) de uma requisição para a outra, já que os dados do Prism são o cofre e
        // não há banco do produto (decisões 2 e 3 da seção 8 da especificação). Registrado por fábrica,
        // e não por instância pronta: o contêiner só descarta o que ele mesmo cria, e é o descarte no
        // desligamento da API que zera a chave (RN-COFRE-008).
        services.AddSingleton<IVaultService>(provider => new VaultService(provider.GetRequiredService<IVaultFileClient>(), provider.GetRequiredService<IOptions<VaultOptions>>(), VaultCrypto.DeriveKey, VaultCrypto.NewKey, provider.GetRequiredService<ILogger>()));

        // O arquivo da exportação de conexões (RN-TRANSF-007 a 010): a cifra do cofre, sem o cofre. Singleton pela fila das derivações (RN-TRANSF-008), uma
        // por vez em toda a API e fora da trava do cofre; a derivação é a do cofre, por fábrica, como lá, para o teste trocá-la por uma barata.
        services.AddOptions<ConnectionFileOptions>();
        services.AddTransient<IConnectionFileClient, ConnectionFileClient>();
        services.AddSingleton<IConnectionFileService>(provider => new ConnectionFileService(provider.GetRequiredService<IConnectionFileClient>(), provider.GetRequiredService<IOptions<ConnectionFileOptions>>(), VaultCrypto.DeriveKey));

        // Um client por banco, sem estado: o registro de sessões escolhe pelo `Engine` da conexão. Os do Db2 e do Informix só existem
        // nas plataformas para as quais a IBM publica o driver (RN-ABERTO-006); nas outras o registro de sessões responde que o Prism
        // daquela plataforma ainda não conecta nesses bancos.
        services.AddTransient<IDatabaseClient, PostgresClient>();
        foreach (var engine in new[] { EDatabaseEngine.Sqlite, EDatabaseEngine.MySql, EDatabaseEngine.MariaDb, EDatabaseEngine.SqlServer, EDatabaseEngine.Oracle, EDatabaseEngine.Firebird, EDatabaseEngine.DuckDb, EDatabaseEngine.ClickHouse, EDatabaseEngine.BigQuery, EDatabaseEngine.Databricks })
            services.AddTransient(provider => IbmClient(provider, engine, logger => new ManagedEngineDatabaseClient(engine, logger)));
#if PRISM_IBM_DRIVER
        services.AddTransient(provider => IbmClient(provider, EDatabaseEngine.Db2, logger => new Db2Client(logger)));
        services.AddTransient(provider => IbmClient(provider, EDatabaseEngine.Informix, logger => new InformixClient(logger)));
#endif

        // O relógio do temporizador do cursor ocioso (RN-SQL-007). TryAdd: o `AddApplication` registra o mesmo, e o host de teste que
        // registra um relógio falso por último continua mandando.
        services.TryAddSingleton(TimeProvider.System);

        // Singleton, como o cofre: uma conexão aberta com um banco atravessa várias requisições (decisão 3 da seção 8 da
        // especificação). Registrado pelo tipo, e não por instância pronta, para o contêiner descartá-lo no desligamento da API, que é
        // quando as sessões fecham (RN-SESSAO-004).
        services.AddSingleton<IDatabaseSessionService, DatabaseSessionService>();

        // O gerenciador de drivers sob demanda (seção 16 da especificação): catálogo, instalação e estado.
        services.AddDrivers(dataDirectory);

        // RN-EXPORT-016 e 018: o registro das transferências em segundo plano e a pasta `transfers` dos arquivos temporários. Singleton, como o registro
        // de sessões: um trabalho atravessa várias requisições (decisão 3 da seção 8), e o descarte do contêiner (o desligamento da API) os cancela.
        services.AddSingleton(TransferSettings.For(dataDirectory));
        services.AddTransient<ITransferFileClient, TransferFileClient>();
        services.AddSingleton<ITransferService, TransferService>();

        // RN-IMPORT-007 a 011 e 017: o arquivo da importação, que o processo principal copia para a pasta `transfers`, e as prévias dele.
        services.AddTransient<IImportFileClient, ImportFileClient>();
        services.AddTransient<IImportPreviewService, ImportPreviewService>();

        // RN-DBEAVER-006 a 008: a cópia dos arquivos do DBeaver que o processo principal faz na pasta `transfers`, e a cifra do `credentials-config.json` dele.
        services.AddTransient<IDbeaverSourceClient, DbeaverSourceClient>();
        // Singleton, como o registro das transferências: assina o fechamento do cofre para apagar as cópias (resolvido na subida, em `UseApi`).
        services.AddSingleton<IDbeaverSourceService, DbeaverSourceService>();

        // Plugins de terceiros: a pasta `<PRISM_DATA_DIR>/plugins` para os repositórios Git clonados e o client que valida manifestos e bundles.
        services.AddSingleton(PluginSettings.For(dataDirectory));
        services.AddTransient<IPluginSourceClient, PluginSourceClient>();

        return services;
    }

    /// <summary>
    /// RN-DRIVER-005 e 006. Os drivers sob demanda não vêm com a API: o client de verdade só entra quando a conferência
    /// da partida aprovou o driver instalado, que é o que esta execução carrega. Sem isso entra o client que só responde a recusa
    /// (`DRIVER_NOT_INSTALLED`). O `create` só é chamado no primeiro caso, e é ele quem menciona a classe do client.
    /// </summary>
    private static IDatabaseClient IbmClient(IServiceProvider provider, EDatabaseEngine engine, Func<ILogger, IDatabaseClient> create)
    {
        var drivers = provider.GetRequiredService<IDriverService>();

        return drivers.RefusalFor(engine) is null ? create(provider.GetRequiredService<ILogger>()) : new MissingDriverDatabaseClient(engine, drivers);
    }
}
