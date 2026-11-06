using System.Collections.Concurrent;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Infrastructure.Databases.Services;

internal sealed class UnsavedSecretsService : IUnsavedSecretsService, IDisposable
{
    private readonly ConcurrentDictionary<Guid, ConnectionSshSettings> _ssh = new();
    private readonly ConcurrentDictionary<Guid, ConnectionProxySettings> _proxy = new();
    private readonly IVaultService _vault;

    public UnsavedSecretsService(IVaultService vault)
    {
        _vault = vault;
        _vault.Locked += Clear;
    }

    public void Remember(Guid connectionID, ConnectionSshSettings? ssh, ConnectionProxySettings? proxy)
    {
        if (ssh is { SaveCredentials: false, Secret: { Length: > 0 } })
            _ssh[connectionID] = ssh;

        if (proxy is { SaveCredentials: false, Password: { Length: > 0 } })
            _proxy[connectionID] = proxy;
    }

    public ConnectionSshSettings? Ssh(Guid connectionID)
        => _ssh.GetValueOrDefault(connectionID);

    public ConnectionProxySettings? Proxy(Guid connectionID)
        => _proxy.GetValueOrDefault(connectionID);

    public void Forget(Guid connectionID)
    {
        _ssh.TryRemove(connectionID, out _);
        _proxy.TryRemove(connectionID, out _);
    }

    public void Dispose()
        => _vault.Locked -= Clear;

    // O segredo de um cofre não passa ao próximo, nem fica na memória com o cofre fechado.
    private void Clear()
    {
        _ssh.Clear();
        _proxy.Clear();
    }
}
