using Prism.TestingCore.Fakers.Users;

namespace Prism.UnitTesting.Users;

public sealed class CreateUserCommandTests
{
    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e este carrega a senha.</summary>
    [Trait("CreateUserCommand", "ToString")]
    [Fact(DisplayName = "CreateUserCommand_ToString_DoesNotContainPassword")]
    public void CreateUserCommand_ToString_DoesNotContainPassword()
    {
        //Arrange
        var command = UserFakers.ReturnCreateUserCommandValid(userName: "marca.do.usuario", password: "marca-da-senha");

        //Act
        var text = command.ToString();

        //Assert
        Assert.DoesNotContain("marca-da-senha", text);
        Assert.DoesNotContain("marca.do.usuario", text);
    }
}
