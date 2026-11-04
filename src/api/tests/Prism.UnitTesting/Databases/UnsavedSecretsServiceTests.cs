using Moq;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Services;

namespace Prism.UnitTesting.Databases;

/// <summary>RN-REDE-002: o segredo que a conexão sem "Salvar credenciais" não grava fica na memória da API só até o cofre fechar.</summary>
public sealed class UnsavedSecretsServiceTests
{
    [Trait("UnsavedSecretsService", "Remember")]
    [Fact(DisplayName = "OK guarda só o segredo digitado sem \"Salvar credenciais\", o vazio não apaga o guardado, e o cofre fechado esquece tudo")]
    public void Remember_ShouldKeepOnlyTheUnsavedSecret_UntilTheVaultLocks()
    {
        //Arrange
        var vault = new Mock<IVaultService>();
        using var secrets = new UnsavedSecretsService(vault.Object);
        var id = Guid.NewGuid();
        var ssh = new ConnectionSshSettings("bastion", 22, "ops", Secret: "segredo-ssh", SaveCredentials: false);
        var proxy = new ConnectionProxySettings("socks", 1080, "proxy-user", "senha-proxy", SaveCredentials: false);

        //Act & Assert
        secrets.Remember(id, ssh with { SaveCredentials = true }, proxy with { SaveCredentials = true });
        Assert.Null(secrets.Ssh(id));
        Assert.Null(secrets.Proxy(id));

        secrets.Remember(id, ssh, proxy);
        secrets.Remember(id, ssh with { Secret = null }, proxy with { Password = "" });
        Assert.Equal("segredo-ssh", secrets.Ssh(id)?.Secret);
        Assert.Equal("senha-proxy", secrets.Proxy(id)?.Password);

        vault.Raise(v => v.Locked += null);
        Assert.Null(secrets.Ssh(id));
        Assert.Null(secrets.Proxy(id));
    }
}
