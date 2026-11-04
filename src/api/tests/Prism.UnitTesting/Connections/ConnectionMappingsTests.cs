using Prism.Application.Common.Protections;
using Prism.Application.Connections.Domain;
using Prism.Application.Connections.Features.CreateConnection;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Models.Dtos;
using Prism.Core.Mappers;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Fakers.Vault;

namespace Prism.UnitTesting.Connections;

/// <summary>O mapeamento é por convenção de nome: um campo renomeado de um lado só deixaria o DTO sem valor, sem erro nenhum. Estes testes são a guarda que o `DomainDto` pede.</summary>
public sealed class ConnectionMappingsTests
{
    /// <summary>
    /// `HasPassword` (derivada da senha), `Ssh` e `Proxy` (sem segredos no DTO) e `Protections` (as que valem, RN-PROT-004, que dependem das pastas acima)
    /// nenhum dos dois lados tem com o mesmo tipo, e o mapeamento as preenche à mão. Do registro do cofre, também o somente leitura e a verificação, que ele
    /// guarda nulos no padrão (RN-PROT-002, RN-VERIF-001), e que o mapeamento resolve.
    /// </summary>
    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK só HasPassword, Protections, Proxy e Ssh ficam sem origem automática no domínio, e no registro também os três que ele guarda nulos")]
    public void ConnectionDto_ShouldHaveOnlyTheDerivedPropertiesUnmapped()
    {
        //Act
        var fromDomain = DomainDto.GetUnmappedProperties<Connection, ConnectionDto>();
        var fromRecord = DomainDto.GetUnmappedProperties<VaultConnectionRecord, ConnectionDto>();

        //Assert
        Assert.Equal(["HasPassword", "Protections", "Proxy", "Ssh"], fromDomain.Order());
        Assert.Equal(["HasPassword", "Protections", "Proxy", "ReadOnly", "Ssh", "VerificationEnabled", "VerificationInterval"], fromRecord.Order());
    }

    /// <summary>RN-CONN-001: nenhuma senha sai nas respostas de listagem ou detalhe.</summary>
    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK o DTO não tem propriedade de senha")]
    public void ConnectionDto_ShouldNotHaveAPasswordProperty()
    {
        //Act
        var names = typeof(ConnectionDto).GetProperties().Select(property => property.Name);

        //Assert
        Assert.DoesNotContain(names, name => name.Contains("Password", StringComparison.OrdinalIgnoreCase) && name != "HasPassword");
    }

    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK copia os campos do domínio e HasPassword vem da senha")]
    public void ToDto_FromDomain_ShouldCopyEveryField()
    {
        //Arrange
        var ssh = new ConnectionSshSettings("bastion.local", 2222, "ops", "password", null, "ssh-secret", true, true, 15000, 10000, "127.0.0.1", 0, "db2.internal", 50000);
        var ssl = new ConnectionSslSettings("/certs/ca.pem", "/certs/client.crt", "/certs/client.key", "verify-full");
        var proxy = new ConnectionProxySettings("socks.local", 1080, "proxy-user", "proxy-pass", true);
        var safeguards = new ConnectionSafeguards("irreversible", ReadOnly: true, VerificationEnabled: false, VerificationInterval: 120, VerificationQuery: "SELECT 1 FROM SYSIBM.SYSDUMMY1", Ssh: ssh, Ssl: ssl, Proxy: proxy);
        var connection = Connection.Restore(Guid.CreateVersion7(), Guid.CreateVersion7(), "Produção", EDatabaseEngine.Db2, "db2.local", 50000, "PROD", "operador", "segredo", "Produção", "#FF0000", safeguards, new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc), new DateTime(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc));
        var folderID = Guid.CreateVersion7();
        var protections = new EffectiveProtections(true, null, "all", folderID);

        //Act
        var dto = connection.ToDto(protections);

        //Assert
        Assert.Equal(
            new ConnectionDto
            {
                ID = connection.ID,
                FolderID = connection.FolderID,
                Name = "Produção",
                Engine = EDatabaseEngine.Db2,
                Host = "db2.local",
                Port = 50000,
                Database = "PROD",
                UserName = "operador",
                HasPassword = true,
                EnvironmentName = "Produção",
                EnvironmentColor = "#FF0000",
                ConfirmCommands = "irreversible",
                ReadOnly = true,
                VerificationEnabled = false,
                VerificationInterval = 120,
                VerificationQuery = "SELECT 1 FROM SYSIBM.SYSDUMMY1",
                Ssh = new ConnectionSshDto("bastion.local", 2222, "ops", "password", null, true, true, true, 15000, 10000, "127.0.0.1", 0, "db2.internal", 50000),
                Ssl = ssl,
                Proxy = new ConnectionProxyDto("socks.local", 1080, "proxy-user", true, true),
                Protections = new ProtectionsDto { ReadOnly = true, ConfirmCommands = "all", ConfirmCommandsFolderID = folderID },
                CreatedAt = connection.CreatedAt,
                UpdatedAt = connection.UpdatedAt
            },
            dto);
    }

    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK copia os campos do registro do cofre e HasPassword vem da senha")]
    public void ToDto_FromRecord_ShouldCopyEveryField()
    {
        //Arrange
        var record = VaultFakers.CreateConnection(password: "segredo") with { ConfirmCommands = "all", ReadOnly = true, VerificationEnabled = false, VerificationInterval = 600, VerificationQuery = "SELECT 1" };

        //Act
        var dto = record.ToDto(new EffectiveProtections(true, null, "all", null));

        //Assert
        Assert.Equal(new ConnectionDto { ID = record.ID, FolderID = record.FolderID, Name = record.Name, Engine = record.Engine, Host = record.Host, Port = record.Port, Database = record.Database, UserName = record.UserName, HasPassword = true, EnvironmentName = record.EnvironmentName, EnvironmentColor = record.EnvironmentColor, ConfirmCommands = "all", ReadOnly = true, VerificationEnabled = false, VerificationInterval = 600, VerificationQuery = "SELECT 1", Protections = new ProtectionsDto { ReadOnly = true, ConfirmCommands = "all" }, CreatedAt = record.CreatedAt, UpdatedAt = record.UpdatedAt }, dto);
    }

    /// <summary>RN-PROT-001 e 002, RN-VERIF-001: a conexão gravada antes das proteções (os campos nulos) sai com o padrão de cada um.</summary>
    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK o registro sem proteções nem verificação sai com o padrão: sem confirmação, sem somente leitura, verificação ligada a cada 30 s")]
    public void ToDto_FromRecordWithoutTheNewFields_ShouldHaveTheDefaults()
    {
        //Arrange
        var record = VaultFakers.CreateConnection();

        //Act
        var dto = record.ToDto(new EffectiveProtections(false, null, null, null));

        //Assert
        Assert.Null(dto.ConfirmCommands);
        Assert.False(dto.ReadOnly);
        Assert.True(dto.VerificationEnabled);
        Assert.Equal(30, dto.VerificationInterval);
        Assert.Null(dto.VerificationQuery);
        Assert.Null(dto.Ssh);
        Assert.Null(dto.Ssl);
        Assert.Null(dto.Proxy);
        Assert.Equal(new ProtectionsDto(), dto.Protections);
    }

    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK senha vazia é HasPassword falso")]
    public void ToDto_WithEmptyPassword_ShouldNotHavePassword()
    {
        //Arrange
        var record = VaultFakers.CreateConnection(password: string.Empty);

        //Act
        var dto = record.ToDto(new EffectiveProtections(false, null, null, null));

        //Assert
        Assert.False(dto.HasPassword);
    }

    [Trait("ConnectionRules", "SshSslProxy")]
    [Fact(DisplayName = "OK valida e normaliza SSH, SSL e Proxy sem expor segredos no ToString")]
    public void SshSslProxy_ShouldValidateNormalizeAndRedactSecrets()
    {
        //Arrange
        var sshInput = new ConnectionSshInputDto
        {
            Host = "  bastion.internal  ",
            Port = 22,
            UserName = "  admin  ",
            AuthMethod = "privateKey",
            PrivateKeyPath = "  /keys/id_ed25519  ",
            Secret = "passphrase-secret",
            SaveCredentials = false,
            IgnoreHostVerification = true,
            KeepAliveIntervalMs = 30000,
            TunnelTimeoutMs = 15000,
            LocalHost = " 127.0.0.1 ",
            LocalPort = 15432,
            RemoteHost = " db.internal ",
            RemotePort = 5432
        };
        var sslInput = new ConnectionSslSettings(" /ca.pem ", " ", "/client.key", " VERIFY-CA ");
        var proxyInput = new ConnectionProxyInputDto
        {
            Host = "  proxy.internal ",
            Port = 1080,
            UserName = " proxyuser ",
            Password = "proxy-password",
            SaveCredentials = true
        };

        //Act
        var sshRefusal = ConnectionRules.SshRefusal(sshInput);
        var sslRefusal = ConnectionRules.SslRefusal(sslInput);
        var proxyRefusal = ConnectionRules.ProxyRefusal(proxyInput);
        var savedSsh = ConnectionRules.NormalizeSsh(sshInput);
        var testSsh = ConnectionRules.NormalizeSsh(sshInput, forTest: true);
        var normalizedSsl = ConnectionRules.NormalizeSsl(sslInput);
        var savedProxy = ConnectionRules.NormalizeProxy(proxyInput);

        //Assert
        Assert.Null(sshRefusal);
        Assert.Null(sslRefusal);
        Assert.Null(proxyRefusal);
        Assert.NotNull(savedSsh);
        Assert.Equal("bastion.internal", savedSsh.Host);
        Assert.Equal("admin", savedSsh.UserName);
        Assert.Equal("/keys/id_ed25519", savedSsh.PrivateKeyPath);
        Assert.Null(savedSsh.Secret);
        Assert.Equal("passphrase-secret", testSsh!.Secret);
        Assert.Equal(new ConnectionSslSettings("/ca.pem", null, "/client.key", "verify-ca"), normalizedSsl);
        Assert.Equal(new ConnectionProxySettings("proxy.internal", 1080, "proxyuser", "proxy-password", true), savedProxy);
        Assert.Equal(nameof(ConnectionSshInputDto), sshInput.ToString());
        Assert.Equal(nameof(ConnectionProxyInputDto), proxyInput.ToString());
        Assert.Equal(nameof(ConnectionSshSettings), savedSsh.ToString());
        Assert.Equal(nameof(ConnectionSslSettings), normalizedSsl!.ToString());
        Assert.Equal(nameof(ConnectionProxySettings), savedProxy!.ToString());
    }

    /// <summary>RN-CONN-004 no túnel e no proxy: o segredo omitido é o gravado só no mesmo servidor (host e porta); noutro, nada é reaproveitado.</summary>
    [Trait("ConnectionRules", "SshSslProxy")]
    [Fact(DisplayName = "OK o segredo SSH e a senha do proxy gravados só voltam para o mesmo servidor")]
    public void NormalizeSshAndProxy_ShouldReuseTheStoredSecretOnlyOnTheSameServer()
    {
        //Arrange
        var storedSsh = new ConnectionSshSettings("bastion", 22, "ops", Secret: "segredo-ssh");
        var storedProxy = new ConnectionProxySettings("socks", 1080, "proxy-user", "senha-proxy");
        var sameSsh = new ConnectionSshInputDto { Host = " bastion ", Port = 22, UserName = "ops" };
        var otherSsh = sameSsh with { Port = 2222 };
        var sameProxy = new ConnectionProxyInputDto { Host = "socks", Port = 1080 };
        var otherProxy = sameProxy with { Host = "outro-socks" };

        //Act & Assert
        Assert.True(ConnectionRules.SshSecretStaysOnItsServer(sameSsh, storedSsh));
        Assert.False(ConnectionRules.SshSecretStaysOnItsServer(otherSsh, storedSsh));
        Assert.True(ConnectionRules.SshSecretStaysOnItsServer(otherSsh with { Secret = "novo" }, storedSsh));
        Assert.Equal("segredo-ssh", ConnectionRules.NormalizeSsh(sameSsh, storedSsh)!.Secret);
        Assert.Null(ConnectionRules.NormalizeSsh(otherSsh, storedSsh, forTest: true)!.Secret);
        Assert.True(ConnectionRules.ProxyPasswordStaysOnItsServer(sameProxy, storedProxy));
        Assert.False(ConnectionRules.ProxyPasswordStaysOnItsServer(otherProxy, storedProxy));
        Assert.Equal("senha-proxy", ConnectionRules.NormalizeProxy(sameProxy, storedProxy)!.Password);
        Assert.Null(ConnectionRules.NormalizeProxy(otherProxy, storedProxy, forTest: true)!.Password);
    }

    /// <summary>
    /// O segredo que a conexão não grava vem da memória só para o mesmo servidor, e sem ele a falta é dita no campo, antes do driver (RN-REDE-003 e 006): a senha do
    /// túnel por senha, a frase secreta da chave com "Pedir a frase secreta ao conectar" e a senha do proxy com usuário. A chave gravada sem frase e sem esse pedido não pede nada.
    /// </summary>
    [Trait("ConnectionRules", "SshSslProxy")]
    [Fact(DisplayName = "OK o segredo lembrado só volta para o mesmo servidor, e o que falta para conectar é dito pelo campo")]
    public void WithRememberedAndMissingNetworkSecret_ShouldFillOnlyTheSameServer_AndNameTheMissingField()
    {
        //Arrange
        var ssh = new ConnectionSshSettings("bastion", 22, "ops", SaveCredentials: false);
        var proxy = new ConnectionProxySettings("socks", 1080, "proxy-user", SaveCredentials: false);
        var rememberedSsh = ssh with { Secret = "segredo-ssh" };
        var rememberedProxy = proxy with { Password = "senha-proxy" };

        //Act & Assert
        Assert.Equal("segredo-ssh", ConnectionRules.WithRemembered(ssh, rememberedSsh)!.Secret);
        Assert.Null(ConnectionRules.WithRemembered(ssh with { Port = 2222 }, rememberedSsh)!.Secret);
        Assert.Equal("gravado", ConnectionRules.WithRemembered(ssh with { Secret = "gravado" }, rememberedSsh)!.Secret);
        Assert.Equal("senha-proxy", ConnectionRules.WithRemembered(proxy, rememberedProxy)!.Password);
        Assert.Null(ConnectionRules.WithRemembered(proxy with { Host = "outro-socks" }, rememberedProxy)!.Password);

        Assert.Equal("SshSecret", ConnectionRules.MissingNetworkSecret(ssh, null));
        Assert.Equal("SshSecret", ConnectionRules.MissingNetworkSecret(ssh with { AuthMethod = "privateKey", PrivateKeyPath = "/chaves/id_ed25519" }, null));
        Assert.Null(ConnectionRules.MissingNetworkSecret(ssh with { AuthMethod = "privateKey", PrivateKeyPath = "/chaves/id_ed25519", SaveCredentials = true }, null));
        Assert.Equal("ProxyPassword", ConnectionRules.MissingNetworkSecret(rememberedSsh, proxy));
        Assert.Null(ConnectionRules.MissingNetworkSecret(null, proxy with { UserName = null }));
        Assert.Null(ConnectionRules.MissingNetworkSecret(rememberedSsh, rememberedProxy));
    }

    /// <summary>
    /// RN-REDE-005: a impressão digital em branco no formulário é a gravada, se o túnel continua no mesmo servidor SSH: o formulário aberto antes do primeiro
    /// acesso não a conhece, e salvá-lo não a apaga. A digitada vale; em outro servidor, a gravada não vai.
    /// </summary>
    [Trait("ConnectionRules", "SshSslProxy")]
    [Fact(DisplayName = "OK a impressão digital em branco mantém a gravada só no mesmo servidor SSH")]
    public void NormalizeSsh_ShouldKeepTheStoredFingerprint_OnlyOnTheSameServer()
    {
        //Arrange
        var stored = new ConnectionSshSettings("bastion", 22, "ops", HostKeyFingerprint: "SHA256:gravada");
        var input = new ConnectionSshInputDto { Host = " bastion ", Port = 22, UserName = "ops", HostKeyFingerprint = "  " };

        //Act & Assert
        Assert.Equal("SHA256:gravada", ConnectionRules.NormalizeSsh(input, stored)!.HostKeyFingerprint);
        Assert.Equal("SHA256:nova", ConnectionRules.NormalizeSsh(input with { HostKeyFingerprint = " SHA256:nova " }, stored)!.HostKeyFingerprint);
        Assert.Null(ConnectionRules.NormalizeSsh(input with { Port = 2222 }, stored)!.HostKeyFingerprint);
        Assert.Null(ConnectionRules.NormalizeSsh(input)!.HostKeyFingerprint);
    }

    [Trait("ConnectionRules", "SshSslProxy")]
    [Fact(DisplayName = "ERRO recusa SSH sem chave privada quando o método é privateKey, modo SSL inválido e porta SOCKS inválida")]
    public void Validator_WhenSshSslOrProxyAreInvalid_ShouldFail()
    {
        //Arrange
        var validator = new CreateConnectionValidator();
        var command = new CreateConnectionCommand
        {
            Name = "Prod",
            Engine = EDatabaseEngine.PostgreSql,
            Host = "localhost",
            Port = 5432,
            Database = "app",
            UserName = "postgres",
            Password = "secret",
            Ssh = new ConnectionSshInputDto { Host = "bastion", Port = 22, UserName = "root", AuthMethod = "privateKey", PrivateKeyPath = " " },
            Ssl = new ConnectionSslSettings(SslMode: "invalid-mode"),
            Proxy = new ConnectionProxyInputDto { Host = "proxy", Port = 70000 }
        };

        //Act
        var result = validator.Validate(command);

        //Assert
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(CreateConnectionCommand.Ssh));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(CreateConnectionCommand.Ssl));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(CreateConnectionCommand.Proxy));
    }
}
