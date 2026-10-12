using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Drivers.Models;

/// <summary>
/// RN-DRIVER-002: `Bundled` vem no pacote do Prism; `Available` pode ser baixado; `Installing`, `Installed` e `Failed` são o caminho da
/// instalação; `Unavailable` é a plataforma para a qual o fabricante não publica o driver; `ComingSoon` é o banco que o Prism ainda não
/// conecta.
/// </summary>
public enum EDriverState
{
    Bundled,
    Available,
    Installing,
    Installed,
    Failed,
    Unavailable,
    ComingSoon
}

/// <summary>
/// Um driver do catálogo, no estado em que está nesta máquina e nesta execução da API (seção 16 da especificação). `Progress` só existe
/// durante o download, depois do primeiro byte; `Error` só em `Failed`. `RestartRequired` vale entre o fim de uma instalação ou de uma
/// remoção e o reinício da API (RN-DRIVER-005 e 007).
/// </summary>
public sealed record DriverInfo(string ID, string Name, string Vendor, IReadOnlyList<EDatabaseEngine> Engines, EDriverState State, string? Version, long? SizeBytes, DriverLicense? License, string? PlatformNote, DriverProgress? Progress, DriverInstallFailure? Error, bool RestartRequired);

/// <summary>O nome da licença do fabricante e o endereço `https://` do texto oficial dela. O texto nunca é copiado para o Prism (RN-DRIVER-001).</summary>
public sealed record DriverLicense(string Name, string Url);

/// <summary>RN-DRIVER-004: `TotalBytes` é o tamanho do pacote no catálogo, e nunca o que o servidor anuncia.</summary>
public sealed record DriverProgress(long ReceivedBytes, long TotalBytes);
