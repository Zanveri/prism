using Prism.TestingCore.Fakers.Users;

namespace Prism.UnitTesting.Sessions;

public sealed class SignInCommandTests
{
    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e este carrega a senha.</summary>
    [Trait("SignInCommand", "ToString")]
    [Fact(DisplayName = "SignInCommand_ToString_DoesNotContainPassword")]
    public void SignInCommand_ToString_DoesNotContainPassword()
    {
        //Arrange
        var command = UserFakers.ReturnSignInCommandValid(userName: "marca.do.usuario", password: "marca-da-senha");

        //Act
        var text = command.ToString();

        //Assert
        Assert.DoesNotContain("marca-da-senha", text);
        Assert.DoesNotContain("marca.do.usuario", text);
    }
}
