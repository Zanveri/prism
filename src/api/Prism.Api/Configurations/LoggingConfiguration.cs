using Serilog;
using System.Diagnostics.CodeAnalysis;

namespace Prism.Api.Configurations;

[ExcludeFromCodeCoverage]
internal static class LoggingConfiguration
{
    private const int RetainedFiles = 7;

    /// <summary>
    /// RN-LOG-001: o log vai para `&lt;PRISM_DATA_DIR&gt;/logs/prism-.log`, com rotação diária e sete
    /// dias guardados. Não há sink de console: a saída padrão é só da linha de pronto, que o
    /// processo principal lê. Os níveis mínimos vêm do `appsettings.json`.
    /// </summary>
    public static void ConfigureSerilog(LoggerConfiguration configuration, IConfiguration appConfiguration, string dataDirectory)
    {
        configuration
            .ReadFrom.Configuration(appConfiguration)
            .Enrich.FromLogContext()
            .WriteTo.File(Path.Combine(dataDirectory, "logs", "prism-.log"), rollingInterval: RollingInterval.Day, retainedFileCountLimit: RetainedFiles);
    }
}
