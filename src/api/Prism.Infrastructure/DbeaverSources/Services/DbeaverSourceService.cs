using CSharpFunctionalExtensions;
using Prism.Infrastructure.DbeaverSources.Clients;
using Prism.Infrastructure.DbeaverSources.Models;
using Prism.Infrastructure.Vault.Services;
using System.Text.Json;

namespace Prism.Infrastructure.DbeaverSources.Services;

/// <summary>
/// `Singleton`, como o registro das transferências: assina o fechamento do cofre (RN-COFRE-008) e apaga as cópias do DBeaver, que têm as senhas dele na
/// cifra pública (RN-DBEAVER-006). A tela e o processo principal soltam a cópia por conta própria, mas o bloqueio, o "Sair" e o quinto erro de senha a
/// fecham sem pedir, e a API não confia em quem fechou para apagar. A partida apaga o que sobrou (`TransferFileClient.Prepare`).
/// </summary>
internal sealed class DbeaverSourceService : IDbeaverSourceService, IDisposable
{
    private readonly IDbeaverSourceClient _client;
    private readonly IVaultService _vault;

    public DbeaverSourceService(IDbeaverSourceClient client, IVaultService vault)
    {
        _client = client;
        _vault = vault;
        _vault.Locked += OnVaultLocked;
    }

    public Result<DbeaverSource, EDbeaverSourceError> Open(Guid sourceId)
        => _client.Read(sourceId);

    public Maybe<T> ReadJson<T>(byte[] content, Func<JsonElement, T> readContent)
        => _client.ReadJson(content, readContent);

    public void Delete(Guid sourceId)
        => _client.Delete(sourceId);

    public Result<T, EDbeaverCredentialsError> DecryptCredentials<T>(byte[] file, Func<JsonElement, T> readContent)
        => _client.Decrypt(file, readContent);

    public void Dispose()
        => _vault.Locked -= OnVaultLocked;

    private void OnVaultLocked()
        => _client.DeleteAll();
}
