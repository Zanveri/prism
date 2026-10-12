using Prism.Application.Connections.Features.TestConnection;
using Prism.Application.Connections.Models.Dtos;
using Prism.TestingCore.Fakers.Connections;

namespace Prism.UnitTesting.Connections;

/// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e estes carregam uma senha.</summary>
public sealed class ConnectionCommandsTests
{
    [Trait("CreateConnectionCommand", "ToString")]
    [Fact(DisplayName = "CreateConnectionCommand_ToString_DoesNotContainPassword")]
    public void CreateConnectionCommand_ToString_DoesNotContainPassword()
    {
        //Arrange
        var command = ConnectionFakers.ReturnCreateConnectionCommandValid(host: "marca-do-host.exemplo", userName: "marca_do_usuario", password: "marca-da-senha");

        //Act
        var text = command.ToString();

        //Assert
        Assert.DoesNotContain("marca-da-senha", text);
        Assert.DoesNotContain("marca_do_usuario", text);
        Assert.DoesNotContain("marca-do-host.exemplo", text);
    }

    [Trait("UpdateConnectionCommand", "ToString")]
    [Fact(DisplayName = "UpdateConnectionCommand_ToString_DoesNotContainPassword")]
    public void UpdateConnectionCommand_ToString_DoesNotContainPassword()
    {
        //Arrange
        var command = ConnectionFakers.ReturnUpdateConnectionCommandValid(host: "marca-do-host.exemplo", userName: "marca_do_usuario", password: "marca-da-senha");

        //Act
        var text = command.ToString();

        //Assert
        Assert.DoesNotContain("marca-da-senha", text);
        Assert.DoesNotContain("marca_do_usuario", text);
        Assert.DoesNotContain("marca-do-host.exemplo", text);
    }

    [Trait("RevealConnectionPasswordCommand", "ToString")]
    [Fact(DisplayName = "RevealConnectionPasswordCommand_ToString_DoesNotContainPassword")]
    public void RevealConnectionPasswordCommand_ToString_DoesNotContainPassword()
    {
        //Arrange
        var command = ConnectionFakers.ReturnRevealConnectionPasswordCommandValid(password: "marca-da-senha");

        //Act
        var text = command.ToString();

        //Assert
        Assert.DoesNotContain("marca-da-senha", text);
    }

    [Trait("ConnectionPasswordDto", "ToString")]
    [Fact(DisplayName = "ConnectionPasswordDto_ToString_DoesNotContainPassword")]
    public void ConnectionPasswordDto_ToString_DoesNotContainPassword()
    {
        //Arrange
        var dto = new ConnectionPasswordDto { Password = "marca-da-senha" };

        //Act
        var text = dto.ToString();

        //Assert
        Assert.DoesNotContain("marca-da-senha", text);
    }

    [Trait("TestConnectionCommand", "ToString")]
    [Fact(DisplayName = "TestConnectionCommand_ToString_DoesNotContainPassword")]
    public void TestConnectionCommand_ToString_DoesNotContainPassword()
    {
        //Arrange
        var command = new TestConnectionCommand { Host = "marca-do-host.exemplo", UserName = "marca_do_usuario", Password = "marca-da-senha" };

        //Act
        var text = command.ToString();

        //Assert
        Assert.DoesNotContain("marca-da-senha", text);
        Assert.DoesNotContain("marca_do_usuario", text);
        Assert.DoesNotContain("marca-do-host.exemplo", text);
    }
}
