namespace Prism.Infrastructure.Databases.Models;

/// <summary>O que um driver precisa para abrir a conexão com um banco. Carrega a senha do banco: nunca vai a log.</summary>
public sealed record ConnectionSettings(EDatabaseEngine Engine, string Host, int Port, string Database, string UserName, string Password, string IsolationLevel = IsolationLevels.Default, ConnectionSshSettings? Ssh = null, ConnectionSslSettings? Ssl = null, ConnectionProxySettings? Proxy = null)
{
    /// <summary>O `ToString()` gerado de um record imprime todas as propriedades, e esta tem a senha (RN-LOG-001).</summary>
    public override string ToString()
        => nameof(ConnectionSettings);
}

/// <summary>
/// Configuração de túnel SSH de uma conexão com banco de dados. `Secret` guarda a senha SSH (quando `AuthMethod` é
/// `password`) ou a frase secreta da chave privada (quando `AuthMethod` é `privateKey`); quando `SaveCredentials`
/// é `false`, no cofre `Secret` fica vazio. `HostKeyFingerprint` é a impressão digital SHA256 da chave do servidor SSH (`SHA256:...`, a do
/// `ssh-keygen -lf`): sem `IgnoreHostVerification`, o túnel só abre quando a chave apresentada confere com ela.
/// </summary>
public sealed record ConnectionSshSettings(string Host, int Port, string UserName, string AuthMethod = "password", string? PrivateKeyPath = null, string? Secret = null, bool SaveCredentials = true, bool IgnoreHostVerification = false, int KeepAliveIntervalMs = 0, int TunnelTimeoutMs = 0, string? LocalHost = null, int LocalPort = 0, string? RemoteHost = null, int RemotePort = 0, string? HostKeyFingerprint = null)
{
    /// <summary>RN-LOG-001: o `ToString()` gerado pelo compilador para `record` imprimiria `Secret`.</summary>
    public override string ToString()
        => nameof(ConnectionSshSettings);
}

/// <summary>
/// Configuração de SSL/TLS da conexão com o banco: caminhos dos certificados CA e cliente, chave privada do cliente
/// e modo SSL (`disable`, `allow`, `prefer`, `require`, `verify-ca`, `verify-full`).
/// </summary>
public sealed record ConnectionSslSettings(string? CaCertificatePath = null, string? ClientCertificatePath = null, string? ClientKeyPath = null, string? SslMode = null)
{
    public override string ToString()
        => nameof(ConnectionSslSettings);
}

/// <summary>
/// Configuração de proxy SOCKS5 da conexão com o banco. Quando `SaveCredentials` é `false`, no cofre `Password`
/// fica vazia.
/// </summary>
public sealed record ConnectionProxySettings(string Host, int Port = 1080, string? UserName = null, string? Password = null, bool SaveCredentials = true)
{
    /// <summary>RN-LOG-001: o `ToString()` gerado pelo compilador para `record` imprimiria `Password`.</summary>
    public override string ToString()
        => nameof(ConnectionProxySettings);
}
