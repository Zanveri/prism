using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Drivers.Models;

namespace Prism.Application.Drivers.Models.Dtos;

/// <summary>
/// O item da lista de `GET api/user/drivers` (seção 16 da especificação), que a tela valida campo a campo (`drivers.schema.ts`). Toda
/// chave vai sempre, com `null` quando não se aplica. `Engines` são os números dos bancos (1 PostgreSQL, 2 Db2, 3 Informix); `State`
/// é o texto do estado (`bundled`, `available`, `installing`, `installed`, `failed`, `unavailable`, `comingSoon`).
/// </summary>
public sealed record DriverDto
{
    public string ID { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Vendor { get; init; } = string.Empty;
    public IReadOnlyList<EDatabaseEngine> Engines { get; init; } = [];
    public string State { get; init; } = string.Empty;
    public string? Version { get; init; }
    public long? SizeBytes { get; init; }
    public DriverLicense? License { get; init; }
    public string? PlatformNote { get; init; }
    public DriverProgress? Progress { get; init; }
    public DriverErrorDto? Error { get; init; }
    public bool RestartRequired { get; init; }
}

/// <summary>Por que a última instalação falhou: `DRIVER_DOWNLOAD_FAILED` ou `DRIVER_INTEGRITY_FAILED`, e a causa em uma frase.</summary>
public sealed record DriverErrorDto(string Code, string? Detail);
