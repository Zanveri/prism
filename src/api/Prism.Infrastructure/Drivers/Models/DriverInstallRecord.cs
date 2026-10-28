namespace Prism.Infrastructure.Drivers.Models;

/// <summary>
/// O registro de uma instalação (`install.json`, dentro da pasta do driver), gravado antes de a pasta ganhar o nome definitivo.
/// RN-DRIVER-003 e 009: guarda o aceite (a licença, a versão do driver e a data) e o hash do pacote de onde os arquivos saíram. Os dois
/// últimos campos são o SHA-512 do assembly gerenciado e da biblioteca nativa principal como foram extraídos: é contra eles que a
/// partida confere os arquivos antes de carregar o driver.
/// </summary>
internal sealed record DriverInstallRecord(string DriverID, string Version, string PackageID, string PackageSha512, DriverLicense License, DateTimeOffset AcceptedAt, string ManagedAssemblySha512, string? NativeLibrarySha512 = null);
