namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// O que o cofre do usuário guarda dos plugins de terceiros: o consentimento explícito (<see cref="ConsentedAt"/>) e os plugins instalados ou vinculados (<see cref="Items"/>).
/// É do usuário (segue o cofre dele), e não da máquina. Campo novo e opcional do documento (<see cref="VaultDocument.Plugins"/>): sem subir o formato do cofre.
/// </summary>
public sealed record VaultPluginsRecord(DateTimeOffset? ConsentedAt = null, IReadOnlyList<VaultPluginItemRecord>? Items = null);

/// <summary>
/// Um plugin de terceiro registrado no cofre do usuário. <see cref="SourceKind"/> é `"git"` ou `"local"`, e <see cref="Source"/> é a URL do repositório Git ou o caminho da pasta local.
/// </summary>
public sealed record VaultPluginItemRecord(string ID, string Name, string Version, string? Description, string? Author, string SourceKind, string Source, bool Enabled, DateTimeOffset InstalledAt, DateTimeOffset UpdatedAt);
