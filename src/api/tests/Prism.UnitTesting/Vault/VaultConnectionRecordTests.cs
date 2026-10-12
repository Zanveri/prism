using Prism.TestingCore.Fakers.Vault;

namespace Prism.UnitTesting.Vault;

public sealed class VaultConnectionRecordTests
{
    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e este carrega a senha do banco.</summary>
    [Trait("VaultConnectionRecord", "ToString")]
    [Fact(DisplayName = "ToString não revela a senha nem o resto da conexão")]
    public void ToString_ShouldNotExposeTheConnection()
    {
        //Arrange
        var connection = VaultFakers.CreateConnection(host: "marca-do-host.exemplo", userName: "marca_do_usuario", password: "marca-da-senha");

        //Act
        var text = connection.ToString();

        //Assert
        Assert.DoesNotContain(connection.Password, text);
        Assert.DoesNotContain(connection.UserName, text);
        Assert.DoesNotContain(connection.Host, text);
    }
}
