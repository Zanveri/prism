using Prism.Application.Common.Protections;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.Connections.Models.Dtos;

/// <summary>RN-CONN-001: não existe propriedade de senha aqui. A listagem e o detalhe dizem só se há uma, em `HasPassword` (e em `Ssh.HasSecret` / `Proxy.HasPassword`).</summary>
public sealed record ConnectionDto
{
    public Guid ID { get; init; }

    /// <summary>`null` é a raiz.</summary>
    public Guid? FolderID { get; init; }
    public string Name { get; init; } = string.Empty;
    public EDatabaseEngine Engine { get; init; }
    public string Host { get; init; } = string.Empty;
    public int Port { get; init; }
    public string Database { get; init; } = string.Empty;
    public string UserName { get; init; } = string.Empty;
    public bool HasPassword { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }

    /// <summary>RN-PROT-001: a confirmação própria da conexão, `irreversible` ou `all`; nula é "Não".</summary>
    public string? ConfirmCommands { get; init; }

    /// <summary>RN-PROT-002: o somente leitura próprio da conexão. O que vale, com o das pastas acima, está em `Protections`.</summary>
    public bool ReadOnly { get; init; }

    /// <summary>RN-VERIF-001: a verificação periódica, ligada por padrão, a cada `VerificationInterval` segundos (30 por padrão).</summary>
    public bool VerificationEnabled { get; init; }
    public int VerificationInterval { get; init; }

    /// <summary>RN-VERIF-001: a consulta de verificação própria; nula é a do banco (RN-CONN-013).</summary>
    public string? VerificationQuery { get; init; }

    public bool? UseInternalDescriptions { get; init; }
    public ConnectionSshDto? Ssh { get; init; }
    public ConnectionSslSettings? Ssl { get; init; }
    public ConnectionProxyDto? Proxy { get; init; }

    /// <summary>RN-PROT-004: as proteções que valem, a própria e as das pastas acima, e de onde cada uma vem.</summary>
    public ProtectionsDto Protections { get; init; } = new();
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}

/// <summary>Configuração de túnel SSH devolvida à tela sem segredo (`HasSecret` indica se há senha ou frase secreta salva).</summary>
public sealed record ConnectionSshDto(
    string Host,
    int Port = 22,
    string UserName = "",
    string AuthMethod = "password",
    string? PrivateKeyPath = null,
    bool HasSecret = false,
    bool SaveCredentials = true,
    bool IgnoreHostVerification = false,
    int KeepAliveIntervalMs = 0,
    int TunnelTimeoutMs = 0,
    string? LocalHost = null,
    int LocalPort = 0,
    string? RemoteHost = null,
    int RemotePort = 0,
    string? HostKeyFingerprint = null);

/// <summary>Configuração de proxy SOCKS5 devolvida à tela sem senha (`HasPassword` indica se há senha salva).</summary>
public sealed record ConnectionProxyDto(
    string Host,
    int Port = 1080,
    string? UserName = null,
    bool HasPassword = false,
    bool SaveCredentials = true);

/// <summary>Entrada do formulário para o túnel SSH na criação, alteração e teste de conexão.</summary>
public sealed record ConnectionSshInputDto
{
    public string Host { get; init; } = string.Empty;
    public int Port { get; init; } = 22;
    public string UserName { get; init; } = string.Empty;
    public string AuthMethod { get; init; } = "password";
    public string? PrivateKeyPath { get; init; }
    public string? Secret { get; init; }
    public bool SaveCredentials { get; init; } = true;
    public bool IgnoreHostVerification { get; init; }
    public int KeepAliveIntervalMs { get; init; }
    public int TunnelTimeoutMs { get; init; }
    public string? LocalHost { get; init; }
    public int LocalPort { get; init; }
    public string? RemoteHost { get; init; }
    public int RemotePort { get; init; }
    public string? HostKeyFingerprint { get; init; }

    /// <summary>RN-LOG-001: impede que a senha ou frase secreta do SSH apareça em logs.</summary>
    public override string ToString()
        => nameof(ConnectionSshInputDto);
}

/// <summary>Entrada do formulário para o proxy SOCKS5 na criação, alteração e teste de conexão.</summary>
public sealed record ConnectionProxyInputDto
{
    public string Host { get; init; } = string.Empty;
    public int Port { get; init; } = 1080;
    public string? UserName { get; init; }
    public string? Password { get; init; }
    public bool SaveCredentials { get; init; } = true;

    /// <summary>RN-LOG-001: impede que a senha do proxy apareça em logs.</summary>
    public override string ToString()
        => nameof(ConnectionProxyInputDto);
}
