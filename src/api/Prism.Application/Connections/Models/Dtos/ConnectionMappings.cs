using Prism.Application.Common.Protections;
using Prism.Application.Connections.Domain;
using Prism.Core.Mappers;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Connections.Models.Dtos;

/// <summary>
/// O mapeamento por convenção copia tudo menos `HasPassword`, `Ssh` e `Proxy`, que não expõem segredos no DTO (RN-CONN-001),
/// e `Protections`, as que valem (RN-PROT-004), que dependem das pastas acima e chegam prontas de quem leu o documento. Do registro do
/// cofre, também o somente leitura e a verificação, que ele guarda nulos no padrão. O `ConnectionMappingsTests` fixa quais propriedades ficam sem origem.
/// </summary>
internal static class ConnectionMappings
{
    public static ConnectionDto ToDto(this Connection source, EffectiveProtections protections)
        => DomainDto.ToDto<Connection, ConnectionDto>(source) with
        {
            HasPassword = source.Password.Length > 0,
            Ssh = source.Ssh.ToDto(),
            Proxy = source.Proxy.ToDto(),
            Protections = protections.ToDto()
        };

    /// <summary>A listagem e o detalhe não precisam do domínio: leem os registros do cofre direto, que têm os mesmos campos.</summary>
    public static ConnectionDto ToDto(this VaultConnectionRecord source, EffectiveProtections protections)
        => DomainDto.ToDto<VaultConnectionRecord, ConnectionDto>(source) with
        {
            HasPassword = source.Password.Length > 0,
            ReadOnly = source.ReadOnly == true,
            VerificationEnabled = source.VerificationEnabled ?? true,
            VerificationInterval = source.VerificationInterval ?? ConnectionRules.VerificationIntervalDefault,
            Ssh = source.Ssh.ToDto(),
            Proxy = source.Proxy.ToDto(),
            Protections = protections.ToDto()
        };

    public static ConnectionSshDto? ToDto(this ConnectionSshSettings? source)
        => source is null
            ? null
            : new(
                source.Host,
                source.Port,
                source.UserName,
                source.AuthMethod,
                source.PrivateKeyPath,
                !string.IsNullOrEmpty(source.Secret),
                source.SaveCredentials,
                source.IgnoreHostVerification,
                source.KeepAliveIntervalMs,
                source.TunnelTimeoutMs,
                source.LocalHost,
                source.LocalPort,
                source.RemoteHost,
                source.RemotePort,
                source.HostKeyFingerprint);

    public static ConnectionProxyDto? ToDto(this ConnectionProxySettings? source)
        => source is null
            ? null
            : new(
                source.Host,
                source.Port,
                source.UserName,
                !string.IsNullOrEmpty(source.Password),
                source.SaveCredentials);

    /// <summary>RN-VERIF-002: o desfecho da verificação, com o estado em texto e o instante da resposta.</summary>
    public static ConnectionVerificationDto ToDto(this ConnectionVerification source, DateTime checkedAt)
        => new()
        {
            Status = source.Status switch
            {
                EVerificationStatus.Ok => "ok",
                EVerificationStatus.Failed => "failed",
                EVerificationStatus.Busy => "busy",
                EVerificationStatus.NotConnected => "notConnected",
                _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
            },
            CheckedAt = checkedAt,
            ElapsedMs = source.ElapsedMs,
            Message = source.Message,
            SqlState = source.SqlState
        };
}
