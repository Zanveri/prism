using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Renci.SshNet.Common;

namespace Prism.UnitTesting.Databases;

/// <summary>O SSH.NET confia em qualquer chave de servidor se ninguém disser o contrário: a decisão é do túnel, e só ela fica entre o Prism e um servidor no meio do caminho.</summary>
public sealed class ConnectionTunnelTests
{
    private const string Presented = "ohD8VZEXGWo6Ez8GSEJQ9WpafgLFsOfLOtGGQCQo6Og";

    [Trait("ConnectionTunnel", "HostKeyIsTrusted")]
    [Theory(DisplayName = "OK a chave do servidor vale no primeiro acesso, com a impressão digital que confere ou com a verificação ignorada")]
    [InlineData(false, null, true)]
    [InlineData(false, "SHA256:" + Presented, true)]
    [InlineData(false, "sha256:" + Presented + "=", true)]
    [InlineData(false, " " + Presented + " ", true)]
    [InlineData(false, "SHA256:OHD8VZEXGWo6Ez8GSEJQ9WpafgLFsOfLOtGGQCQo6Og", false)]
    [InlineData(false, "SHA256:outra", false)]
    [InlineData(true, null, true)]
    [InlineData(true, "SHA256:outra", true)]
    public void HostKeyIsTrusted_ShouldTrustOnlyAMatchingFingerprintOrAnIgnoredVerification(bool ignoreHostVerification, string? fingerprint, bool expected)
    {
        //Arrange
        var ssh = new ConnectionSshSettings("bastion", 22, "ops", IgnoreHostVerification: ignoreHostVerification, HostKeyFingerprint: fingerprint);

        //Act
        var trusted = ConnectionTunnel.HostKeyIsTrusted(ssh, Presented);

        //Assert
        Assert.Equal(expected, trusted);
    }

    /// <summary>RN-REDE-007: as recusas do SSH.NET ao abrir a chave privada chegam em português; a chave cifrada sem a frase é o segredo que falta.</summary>
    [Trait("ConnectionTunnel", "KeyRefusal")]
    [Theory(DisplayName = "OK a recusa da chave privada vira a frase que falta ou a frase errada, em português")]
    [InlineData("passphrase", "NetworkSecretMissing")]
    [InlineData("The random check bytes of the OpenSSH key do not match (1 <-> 2).", "ConnectionFailed")]
    [InlineData("Invalid passphrase.", "ConnectionFailed")]
    [InlineData("MAC verification failed for PuTTY key file", "ConnectionFailed")]
    public void KeyRefusal_ShouldBeOK_TranslatesTheKeyFailures(string message, string kind)
    {
        //Arrange
        Exception exception = message == "passphrase" ? new SshPassPhraseNullOrEmptyException("Private key is encrypted but passphrase is empty.") : new SshException(message);

        //Act
        var failure = ConnectionTunnel.KeyRefusal(exception);

        //Assert
        Assert.Equal(Enum.Parse<EDatabaseFailure>(kind), failure?.Kind);
        Assert.Equal(kind == "NetworkSecretMissing" ? ConnectionTunnel.EncryptedKeyWithoutPassphrase : ConnectionTunnel.WrongPassphrase, failure?.Message);
    }

    [Trait("ConnectionTunnel", "KeyRefusal")]
    [Fact(DisplayName = "OK outra falha do SSH segue como veio")]
    public void KeyRefusal_ShouldBeOK_LeavesOtherFailures()
    {
        //Act & Assert
        Assert.Null(ConnectionTunnel.KeyRefusal(new SshAuthenticationException("Permission denied (publickey).")));
        Assert.Null(ConnectionTunnel.KeyRefusal(new SshException("Invalid private key file.")));
        Assert.Null(ConnectionTunnel.KeyRefusal(new InvalidOperationException("Invalid passphrase.")));
    }
}
