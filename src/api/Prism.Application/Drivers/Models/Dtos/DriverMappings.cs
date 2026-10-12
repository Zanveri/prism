using Prism.Infrastructure.Drivers.Models;

namespace Prism.Application.Drivers.Models.Dtos;

internal static class DriverMappings
{
    public static DriverDto ToDto(DriverInfo driver)
        => new()
        {
            ID = driver.ID,
            Name = driver.Name,
            Vendor = driver.Vendor,
            Engines = driver.Engines,
            State = StateOf(driver.State),
            Version = driver.Version,
            SizeBytes = driver.SizeBytes,
            License = driver.License,
            PlatformNote = driver.PlatformNote,
            Progress = driver.Progress,
            Error = driver.Error is null ? null : new DriverErrorDto(CodeOf(driver.Error.Kind), driver.Error.Detail),
            RestartRequired = driver.RestartRequired
        };

    /// <summary>RN-DRIVER-002: os sete estados, com a grafia que a tela conhece (`driverStates`, em `drivers.schema.ts`).</summary>
    private static string StateOf(EDriverState state)
        => state switch
        {
            EDriverState.Bundled => "bundled",
            EDriverState.Available => "available",
            EDriverState.Installing => "installing",
            EDriverState.Installed => "installed",
            EDriverState.Failed => "failed",
            EDriverState.Unavailable => "unavailable",
            EDriverState.ComingSoon => "comingSoon",
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    /// <summary>RN-DRIVER-003 e 004: os dois códigos de uma instalação que falhou. O cancelamento não é erro e nunca chega aqui.</summary>
    private static string CodeOf(EDriverInstallFailure failure)
        => failure switch
        {
            EDriverInstallFailure.DownloadFailed => "DRIVER_DOWNLOAD_FAILED",
            EDriverInstallFailure.IntegrityFailed => "DRIVER_INTEGRITY_FAILED",
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };
}
