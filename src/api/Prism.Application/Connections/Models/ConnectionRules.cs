using Prism.Application.Common.Texts;
using Prism.Application.Connections.Models.Dtos;
using Prism.Core.Extensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Connections.Models;

/// <summary>
/// As regras de formato dos campos de uma conexão (RN-CONN-010) que o validator de criar e o de alterar repetem. Medem
/// o valor depois de normalizado, que é o que o domínio grava. As do ambiente são as mesmas da pasta e moram no `EnvironmentRules`.
/// </summary>
internal static class ConnectionRules
{
    /// <summary>
    /// RN-CONN-004 e RN-CONN-013: a senha gravada só é enviada ao servidor para o qual foi gravada, e "o mesmo servidor" é o mesmo host e a
    /// mesma porta. O host é comparado de forma EXATA (`Ordinal`), depois da única normalização que a gravação aplica, aparar as pontas
    /// (`Connection.Create` e `Update`); a porta, como número. Nada de ignorar maiúsculas: um host que começa por `/` é diretório de socket
    /// Unix no driver, e `/tmp/pgsock-x` e `/tmp/PGSOCK-X` são diretórios diferentes; e o `OrdinalIgnoreCase` iguala letras que são
    /// endereços diferentes (`ς` e `σ`, `µ` e `μ`), então a senha iria a um nome que quem controla a resolução registrou de propósito.
    /// Errar para o lado de pedir a senha de novo custa uma digitação; errar para o outro entrega a senha a outro servidor.
    /// </summary>
    public static bool SameServer(string storedHost, int storedPort, string host, int port)
        => storedPort == port && string.Equals(storedHost.Trim(), host.Trim(), StringComparison.Ordinal);

    /// <summary>RN-CONN-010: o nome tem de 1 a 80 caracteres, contados em unidades UTF-16 como o campo de texto da tela conta.</summary>
    public const int NameMaxLength = 80;

    /// <summary>
    /// RN-CONN-010: os tetos do host (255), do banco de dados (128) e do usuário (128), contados em unidades UTF-16 depois de aparados, que é o que se grava,
    /// e o da senha (1.024), contada como veio (ela não é aparada). Valem no formulário, no "Testar conexão" e na importação (RN-TRANSF-014): sem eles o
    /// arquivo que o Prism exporta poderia não voltar pela importação dele.
    /// </summary>
    public const int HostMaxLength = 255;
    public const int DatabaseMaxLength = 128;
    public const int UserNameMaxLength = 128;
    public const int PasswordMaxLength = 1024;
    public const int PathMaxLength = 1024;

    public static bool NameIsValid(string? name)
        => name.NormalizeName().Length is >= 1 and <= NameMaxLength;

    /// <summary>
    /// As regras de cada campo da conexão (RN-CONN-010), num lugar só: o validator de criar, o de alterar e o do teste as aplicam pelo `MustPass`, e a
    /// importação (RN-TRANSF-014) as chama direto, com a mesma frase. Cada uma devolve o primeiro motivo da recusa, ou nulo quando o valor serve. Os textos
    /// são medidos depois da normalização de cada campo (o nome pela `NormalizeName`, o host, o banco e o usuário aparados), que é o que se grava, e o
    /// caractere de controle e o de direção do texto (`TextRules`) são recusados no nome, no host, no banco de dados e no usuário (e, menos a tabulação e as
    /// quebras de linha, na consulta de verificação, <see cref="VerificationQueryRefusal"/>).
    /// </summary>
    public static string? NameRefusal(string? name)
    {
        var normalized = name.NormalizeName();
        if (normalized.Length is < 1 or > NameMaxLength)
            return "O nome da conexão deve ter de 1 a 80 caracteres.";

        return TextRules.HasControlOrDirection(normalized) ? "O nome da conexão não pode ter caractere de controle nem de direção do texto." : null;
    }

    public static string? HostRefusal(string? host)
        => Refusal(host, required: true, HostMaxLength, "Informe o host.", "O host pode ter até 255 caracteres.", "O host não pode ter caractere de controle nem de direção do texto.");

    public static string? PortRefusal(int port)
        => port is >= 1 and <= 65535 ? null : "Informe uma porta de 1 a 65535.";

    public static string? DatabaseRefusal(string? database)
        => Refusal(database, required: true, DatabaseMaxLength, "Informe o banco de dados.", "O banco de dados pode ter até 128 caracteres.", "O banco de dados não pode ter caractere de controle nem de direção do texto.");

    /// <summary>
    /// `required` é o formulário de criar e o teste. No `PATCH` o usuário vazio passa aqui, e quem decide é a gravação: ele só fica vazio na conexão gravada
    /// já sem usuário (a que a importação trouxe sem ele, RN-TRANSF-015). Na importação ele é opcional.
    /// </summary>
    public static string? UserNameRefusal(string? userName, bool required)
        => Refusal(userName, required, UserNameMaxLength, "Informe o usuário do banco.", "O usuário do banco pode ter até 128 caracteres.", "O usuário do banco não pode ter caractere de controle nem de direção do texto.");

    /// <summary>A senha não é aparada nem conferida quanto aos caracteres: espaço e qualquer caractere fazem parte dela. Só o teto, contado como veio.</summary>
    public static string? PasswordRefusal(string? password)
        => password is { Length: > PasswordMaxLength } ? "A senha do banco pode ter até 1.024 caracteres." : null;

    public static string? SshRefusal(ConnectionSshInputDto? ssh)
    {
        if (ssh is null)
            return null;

        if (Refusal(ssh.Host, required: true, HostMaxLength, "Informe o host do túnel SSH.", "O host do túnel SSH pode ter até 255 caracteres.", "O host do túnel SSH não pode ter caractere de controle nem de direção do texto.") is { } hostRefusal)
            return hostRefusal;

        if (ssh.Port is < 1 or > 65535)
            return "Informe uma porta SSH de 1 a 65535.";

        if (Refusal(ssh.UserName, required: true, UserNameMaxLength, "Informe o usuário do túnel SSH.", "O usuário do túnel SSH pode ter até 128 caracteres.", "O usuário do túnel SSH não pode ter caractere de controle nem de direção do texto.") is { } userRefusal)
            return userRefusal;

        var authMethod = ssh.AuthMethod?.Trim();
        if (authMethod is not ("password" or "privateKey"))
            return "Escolha o método de autenticação SSH: senha ou chave privada.";

        if (authMethod == "privateKey" && Refusal(ssh.PrivateKeyPath, required: true, PathMaxLength, "Informe o caminho da chave privada SSH.", "O caminho da chave privada SSH pode ter até 1.024 caracteres.", "O caminho da chave privada SSH não pode ter caractere de controle nem de direção do texto.") is { } keyRefusal)
            return keyRefusal;

        if (ssh.Secret is { Length: > PasswordMaxLength })
            return "A senha ou frase secreta do SSH pode ter até 1.024 caracteres.";

        if (ssh.KeepAliveIntervalMs is < 0 or > 3_600_000)
            return "O intervalo de keep-alive SSH deve ser de 0 a 3.600.000 ms.";

        if (ssh.TunnelTimeoutMs is < 0 or > 600_000)
            return "O timeout de conexão do túnel SSH deve ser de 0 a 600.000 ms.";

        if (Refusal(ssh.LocalHost, required: false, HostMaxLength, string.Empty, "O host local do túnel SSH pode ter até 255 caracteres.", "O host local do túnel SSH não pode ter caractere de controle nem de direção do texto.") is { } localHostRefusal)
            return localHostRefusal;

        if (ssh.LocalPort is < 0 or > 65535)
            return "Informe uma porta local de 0 a 65535.";

        if (Refusal(ssh.RemoteHost, required: false, HostMaxLength, string.Empty, "O host remoto do túnel SSH pode ter até 255 caracteres.", "O host remoto do túnel SSH não pode ter caractere de controle nem de direção do texto.") is { } remoteHostRefusal)
            return remoteHostRefusal;

        if (Refusal(ssh.HostKeyFingerprint, required: false, HostMaxLength, string.Empty, "A impressão digital da chave do servidor SSH pode ter até 255 caracteres.", "A impressão digital da chave do servidor SSH não pode ter caractere de controle nem de direção do texto.") is { } fingerprintRefusal)
            return fingerprintRefusal;

        return ssh.RemotePort is < 0 or > 65535 ? "Informe uma porta remota de 0 a 65535." : null;
    }

    public static string? SslRefusal(ConnectionSslSettings? ssl)
    {
        if (ssl is null)
            return null;

        if (Refusal(ssl.CaCertificatePath, required: false, PathMaxLength, string.Empty, "O caminho do certificado CA pode ter até 1.024 caracteres.", "O caminho do certificado CA não pode ter caractere de controle nem de direção do texto.") is { } caRefusal)
            return caRefusal;

        if (Refusal(ssl.ClientCertificatePath, required: false, PathMaxLength, string.Empty, "O caminho do certificado de cliente pode ter até 1.024 caracteres.", "O caminho do certificado de cliente não pode ter caractere de controle nem de direção do texto.") is { } certRefusal)
            return certRefusal;

        if (Refusal(ssl.ClientKeyPath, required: false, PathMaxLength, string.Empty, "O caminho da chave privada de cliente pode ter até 1.024 caracteres.", "O caminho da chave privada de cliente não pode ter caractere de controle nem de direção do texto.") is { } keyRefusal)
            return keyRefusal;

        if (!string.IsNullOrWhiteSpace(ssl.SslMode))
        {
            var mode = ssl.SslMode.Trim().ToLowerInvariant();
            if (mode is not ("disable" or "allow" or "prefer" or "require" or "verify-ca" or "verify-full"))
                return "Escolha um modo SSL válido.";
        }

        return null;
    }

    public static string? ProxyRefusal(ConnectionProxyInputDto? proxy)
    {
        if (proxy is null)
            return null;

        if (Refusal(proxy.Host, required: true, HostMaxLength, "Informe o host do proxy SOCKS.", "O host do proxy SOCKS pode ter até 255 caracteres.", "O host do proxy SOCKS não pode ter caractere de controle nem de direção do texto.") is { } hostRefusal)
            return hostRefusal;

        if (proxy.Port is < 1 or > 65535)
            return "Informe uma porta do proxy SOCKS de 1 a 65535.";

        if (Refusal(proxy.UserName, required: false, UserNameMaxLength, string.Empty, "O usuário do proxy SOCKS pode ter até 128 caracteres.", "O usuário do proxy SOCKS não pode ter caractere de controle nem de direção do texto.") is { } userRefusal)
            return userRefusal;

        return proxy.Password is { Length: > PasswordMaxLength } ? "A senha do proxy SOCKS pode ter até 1.024 caracteres." : null;
    }

    /// <summary>
    /// RN-REDE-001 (a RN-CONN-004 e a RN-CONN-013 no túnel SSH): o segredo gravado só vai ao servidor SSH para o qual foi gravado (o mesmo host e a mesma porta,
    /// <see cref="SameServer"/>). `false` quando o pedido omite o segredo e aponta o túnel para outro servidor: quem chama recusa antes de conectar.
    /// </summary>
    public static bool SshSecretStaysOnItsServer(ConnectionSshInputDto? ssh, ConnectionSshSettings? stored)
        => ssh is null || !string.IsNullOrEmpty(ssh.Secret) || stored?.Secret is null || SameServer(stored.Host, stored.Port, ssh.Host, ssh.Port);

    /// <summary>RN-REDE-001: a mesma regra do <see cref="SshSecretStaysOnItsServer"/> para a senha do proxy SOCKS.</summary>
    public static bool ProxyPasswordStaysOnItsServer(ConnectionProxyInputDto? proxy, ConnectionProxySettings? stored)
        => proxy is null || !string.IsNullOrEmpty(proxy.Password) || stored?.Password is null || SameServer(stored.Host, stored.Port, proxy.Host, proxy.Port);

    /// <summary>
    /// RN-REDE-001 e 002: o segredo omitido é o gravado (`stored`), e só no mesmo servidor SSH. Fora do teste (`forTest`), sem "Salvar credenciais" o segredo não é guardado.
    /// </summary>
    public static ConnectionSshSettings? NormalizeSsh(ConnectionSshInputDto? ssh, ConnectionSshSettings? stored = null, bool forTest = false)
    {
        if (ssh is null)
            return null;

        var authMethod = ssh.AuthMethod.Trim() == "privateKey" ? "privateKey" : "password";
        var privateKeyPath = authMethod == "privateKey" && !string.IsNullOrWhiteSpace(ssh.PrivateKeyPath) ? ssh.PrivateKeyPath.Trim() : null;
        var resolvedSecret = !string.IsNullOrEmpty(ssh.Secret) ? ssh.Secret : SshSecretStaysOnItsServer(ssh, stored) ? stored?.Secret : null;
        var secret = forTest || ssh.SaveCredentials ? resolvedSecret : null;

        return new ConnectionSshSettings(
            ssh.Host.Trim(),
            ssh.Port,
            ssh.UserName.Trim(),
            authMethod,
            privateKeyPath,
            secret,
            ssh.SaveCredentials,
            ssh.IgnoreHostVerification,
            ssh.KeepAliveIntervalMs,
            ssh.TunnelTimeoutMs,
            string.IsNullOrWhiteSpace(ssh.LocalHost) ? null : ssh.LocalHost.Trim(),
            ssh.LocalPort,
            string.IsNullOrWhiteSpace(ssh.RemoteHost) ? null : ssh.RemoteHost.Trim(),
            ssh.RemotePort,
            HostKeyFingerprintOf(ssh, stored));
    }

    /// <summary>
    /// RN-REDE-005: a impressão digital em branco é a gravada, se o túnel continua no mesmo servidor SSH (como o segredo): o formulário aberto antes do primeiro
    /// acesso não a conhece, e salvá-lo não a apaga. Para trocar a chave confiada, informa-se a nova.
    /// </summary>
    private static string? HostKeyFingerprintOf(ConnectionSshInputDto ssh, ConnectionSshSettings? stored)
        => !string.IsNullOrWhiteSpace(ssh.HostKeyFingerprint) ? ssh.HostKeyFingerprint.Trim()
            : stored is not null && SameServer(stored.Host, stored.Port, ssh.Host, ssh.Port) ? stored.HostKeyFingerprint
            : null;

    /// <summary>
    /// RN-REDE-002: o que o driver recebe da conexão gravada: o banco pedido no lugar do dela (RN-ARVORE-006, `null` é o dela), e o túnel e o proxy com o segredo que a
    /// conexão não grava, quando a pessoa o digitou desde que o cofre abriu (<see cref="IUnsavedSecretsService"/>) e para o mesmo servidor (<see cref="SameServer"/>).
    /// </summary>
    public static ConnectionSettings SettingsOf(VaultConnectionRecord record, string? database, IUnsavedSecretsService? unsavedSecrets)
        => new(record.Engine, record.Host, record.Port, database ?? record.Database, record.UserName, record.Password,
            Ssh: WithRemembered(record.Ssh, unsavedSecrets?.Ssh(record.ID)), Ssl: record.Ssl, Proxy: WithRemembered(record.Proxy, unsavedSecrets?.Proxy(record.ID)));

    /// <summary>O túnel sem o segredo gravado, com o que a pessoa digitou para o mesmo servidor SSH; o gravado, quando há, vale antes.</summary>
    public static ConnectionSshSettings? WithRemembered(ConnectionSshSettings? ssh, ConnectionSshSettings? remembered)
        => ssh is { Secret: null or "" } && remembered is not null && SameServer(remembered.Host, remembered.Port, ssh.Host, ssh.Port) ? ssh with { Secret = remembered.Secret } : ssh;

    /// <summary>A mesma regra do <see cref="WithRemembered(ConnectionSshSettings?, ConnectionSshSettings?)"/> para a senha do proxy.</summary>
    public static ConnectionProxySettings? WithRemembered(ConnectionProxySettings? proxy, ConnectionProxySettings? remembered)
        => proxy is { Password: null or "" } && remembered is not null && SameServer(remembered.Host, remembered.Port, proxy.Host, proxy.Port) ? proxy with { Password = remembered.Password } : proxy;

    /// <summary>
    /// RN-REDE-003 e 006: o campo do segredo que falta para conectar, no nome do formulário: a senha do túnel SSH por senha, ou a frase secreta da chave com "Pedir a
    /// frase secreta ao conectar" (`SshSecret`), ou a do proxy com usuário (`ProxyPassword`); `null` quando nada falta. A chave gravada sem frase secreta e sem
    /// esse pedido é a chave sem cifra, e não falta nada.
    /// </summary>
    public static string? MissingNetworkSecret(ConnectionSshSettings? ssh, ConnectionProxySettings? proxy)
        => ssh is { Secret: null or "" } && (ssh.AuthMethod == "password" || !ssh.SaveCredentials) ? "SshSecret"
            : proxy is { UserName: not null, Password: null or "" } ? "ProxyPassword"
            : null;

    public static ConnectionSslSettings? NormalizeSsl(ConnectionSslSettings? ssl)
        => ssl is null
            ? null
            : new ConnectionSslSettings(
                string.IsNullOrWhiteSpace(ssl.CaCertificatePath) ? null : ssl.CaCertificatePath.Trim(),
                string.IsNullOrWhiteSpace(ssl.ClientCertificatePath) ? null : ssl.ClientCertificatePath.Trim(),
                string.IsNullOrWhiteSpace(ssl.ClientKeyPath) ? null : ssl.ClientKeyPath.Trim(),
                string.IsNullOrWhiteSpace(ssl.SslMode) ? null : ssl.SslMode.Trim().ToLowerInvariant());

    public static ConnectionProxySettings? NormalizeProxy(ConnectionProxyInputDto? proxy, ConnectionProxySettings? stored = null, bool forTest = false)
    {
        if (proxy is null)
            return null;

        var resolvedPassword = !string.IsNullOrEmpty(proxy.Password) ? proxy.Password : ProxyPasswordStaysOnItsServer(proxy, stored) ? stored?.Password : null;
        var password = forTest || proxy.SaveCredentials ? resolvedPassword : null;

        return new ConnectionProxySettings(
            proxy.Host.Trim(),
            proxy.Port,
            string.IsNullOrWhiteSpace(proxy.UserName) ? null : proxy.UserName.Trim(),
            password,
            proxy.SaveCredentials);
    }

    private static string? Refusal(string? value, bool required, int maxLength, string missing, string tooLong, string control)
    {
        if (string.IsNullOrWhiteSpace(value))
            return required ? missing : null;

        var trimmed = value.Trim();
        if (trimmed.Length > maxLength)
            return tooLong;

        return TextRules.HasControlOrDirection(trimmed) ? control : null;
    }

    /// <summary>RN-VERIF-001: "Verificar a cada N segundos", 30 por padrão, de 5 a 3.600 (o mínimo e o passo do canvas são 5).</summary>
    public const int VerificationIntervalDefault = 30;
    public const int VerificationIntervalMin = 5;
    public const int VerificationIntervalMax = 3600;

    /// <summary>RN-VERIF-001: a consulta de verificação própria tem até 1.000 caracteres, contados em unidades UTF-16 depois de aparada.</summary>
    public const int VerificationQueryMaxLength = 1000;

    /// <summary>RN-VERIF-001: a frase do intervalo fora da faixa, a mesma no formulário, no teste e na importação (RN-TRANSF-014).</summary>
    public const string VerificationIntervalMessage = "A verificação deve ser feita a cada 5 a 3.600 segundos.";

    /// <summary>Opcional: ausente ou nulo é o padrão (30).</summary>
    public static bool VerificationIntervalIsValid(int? interval)
        => interval is null or (>= VerificationIntervalMin and <= VerificationIntervalMax);

    /// <summary>Em branco é a consulta do banco (nula). O texto é aparado, e o resto vai ao banco como a pessoa escreveu.</summary>
    public static string? NormalizeVerificationQuery(string? query)
        => string.IsNullOrWhiteSpace(query) ? null : query.Trim();

    /// <summary>
    /// RN-VERIF-001: por que a consulta de verificação não serve, ou nula quando serve (a do banco, em branco, sempre serve). Nesta ordem: até 1.000
    /// caracteres; sem caractere de controle nem de direção do texto, menos a tabulação, a quebra de linha e o retorno de carro (`TextRules`: um U+202E faria a
    /// consulta que a prévia da importação manda conferir parecer outra, RN-TRANSF-011); e uma leitura só no banco da conexão (RN-PROT-005, `ReadOnlySql`).
    /// É a regra de quem a valida no formulário de criar e de alterar, no teste e na importação (RN-TRANSF-014), com as mesmas frases.
    /// </summary>
    public static string? VerificationQueryRefusal(string? query, EDatabaseEngine engine)
    {
        if (NormalizeVerificationQuery(query) is not { } normalized)
            return null;

        if (normalized.Length > VerificationQueryMaxLength)
            return "A consulta de verificação pode ter no máximo 1.000 caracteres.";

        if (TextRules.HasControlOrDirectionBesidesLineBreaks(normalized))
            return "A consulta de verificação não pode ter caractere de controle nem de direção do texto.";

        return ReadOnlySql.VerificationRefusal(normalized, engine) is { } reason ? $"A consulta de verificação tem de ser uma leitura só: {reason}." : null;
    }

    /// <summary>
    /// RN-CONN-016: o nome da cópia de uma conexão, "&lt;nome&gt; (cópia)", ou "(cópia 2)", "(cópia 3)" e assim por diante, o primeiro que
    /// `isTaken` diz estar livre (quem chama sabe a pasta e o documento). O nome original é cortado para o sufixo caber no limite
    /// (`NameMaxLength`), sem partir um caractere em dois e sem deixar espaço antes do sufixo. O laço acaba: cada candidato é diferente
    /// dos anteriores, e a pasta tem um número finito de nomes.
    /// </summary>
    public static string CopyName(string name, Func<string, bool> isTaken)
    {
        for (var number = 1; ; number++)
        {
            var suffix = number == 1 ? " (cópia)" : $" (cópia {number})";
            var candidate = Fit(name, NameMaxLength - suffix.Length) + suffix;

            if (!isTaken(candidate))
                return candidate;
        }
    }

    /// <summary>O nome até `length` unidades UTF-16, cortado no fim de um caractere inteiro (um emoji, uma letra com acento combinado), sem espaço no fim.</summary>
    private static string Fit(string name, int length)
        => name.Length <= length ? name : TextRules.Cut(name, length).TrimEnd();
}
