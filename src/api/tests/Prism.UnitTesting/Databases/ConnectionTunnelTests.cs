using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>O SSH.NET confia em qualquer chave de servidor se ninguém disser o contrário: a decisão é do túnel, e só ela fica entre o Prism e um servidor no meio do caminho.</summary>
public sealed class ConnectionTunnelTests
{
    private const string Presented = "ohD8VZEXGWo6Ez8GSEJQ9WpafgLFsOfLOtGGQCQo6Og";

    [Trait("ConnectionTunnel", "HostKeyIsTrusted")]
    [Theory(DisplayName = "OK a chave do servidor só vale com a impressão digital que confere ou com a verificação ignorada")]
    [InlineData(false, null, false)]
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
}
