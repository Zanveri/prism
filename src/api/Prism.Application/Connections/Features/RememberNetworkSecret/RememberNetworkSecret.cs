using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using System.Text.Json.Serialization;

namespace Prism.Application.Connections.Features.RememberNetworkSecret;

/// <summary>
/// RN-REDE-006: o segredo que a conexão sem "Salvar credenciais" não grava, pedido ao conectar: a senha do túnel SSH (ou a frase secreta da chave) e a senha
/// do proxy. O `ID` vem da rota, e o `[JsonIgnore]` impede que o corpo o escolha.
/// </summary>
public sealed record RememberNetworkSecretCommand : IRequest<UnitResult<ApiErrorDto>>
{
    [JsonIgnore]
    public Guid ID { get; init; }
    public string? SshSecret { get; init; }
    public string? ProxyPassword { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e duas são segredos.</summary>
    public override string ToString() => nameof(RememberNetworkSecretCommand);
}

/// <summary>
/// RN-REDE-006: conecta com o segredo digitado (abre, confere e fecha, como o "Testar conexão") e só então o guarda na memória (<see cref="IUnsavedSecretsService"/>,
/// RN-REDE-002): o segredo errado volta com a mensagem do servidor e não fica para errar de novo a cada aba. Nada vai ao cofre.
/// </summary>
internal sealed class RememberNetworkSecretHandler(IConnectionQueries connectionQueries, IDatabaseSessionService databaseSessionService, IVaultService vaultService, IUnsavedSecretsService unsavedSecrets) : IRequestHandler<RememberNetworkSecretCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(RememberNetworkSecretCommand request, CancellationToken cancellationToken)
    {
        // A mesma regra da abertura de sessão: a geração antes das credenciais, e o segredo de um cofre não fica guardado para o outro.
        var generation = vaultService.Generation;

        var read = await connectionQueries.GetRecordByID(request.ID, cancellationToken);
        if (read.IsFailure)
            return UnitResult.Failure(VaultErrors.From(read.Error));

        if (read.Value is not { } record)
            return UnitResult.Failure(ConnectionErrors.NotFound(request.ID));

        if (string.IsNullOrWhiteSpace(record.UserName) || string.IsNullOrEmpty(record.Password))
            return UnitResult.Failure(ConnectionErrors.CredentialsMissingToConnect(userNameMissing: string.IsNullOrWhiteSpace(record.UserName)));

        var settings = ConnectionRules.SettingsOf(record, null, unsavedSecrets);
        var ssh = settings.Ssh is { } tunnel && !string.IsNullOrEmpty(request.SshSecret) ? tunnel with { Secret = request.SshSecret, SaveCredentials = false } : settings.Ssh;
        var proxy = settings.Proxy is { } socks && !string.IsNullOrEmpty(request.ProxyPassword) ? socks with { Password = request.ProxyPassword, SaveCredentials = false } : settings.Proxy;

        // O outro segredo, se ainda falta, é pedido no campo dele.
        if (ConnectionRules.MissingNetworkSecret(ssh, proxy) is { } secretField)
            return UnitResult.Failure(ConnectionErrors.NetworkSecretMissingToConnect(secretField));

        var tested = await databaseSessionService.TestAsync(settings with { Ssh = ssh, Proxy = proxy }, cancellationToken);
        if (tested.IsFailure)
            return UnitResult.Failure(DatabaseSessionErrors.From(tested.Error));

        if (vaultService.Generation != generation)
            return UnitResult.Failure(VaultErrors.From(EVaultError.Locked));

        unsavedSecrets.Remember(record.ID, ssh, proxy);

        return UnitResult.Success<ApiErrorDto>();
    }
}
