using Prism.Application.Users.Features.ChangePassword;
using Prism.TestingCore.Fakers.Users;

namespace Prism.UnitTesting.Users;

public sealed class ChangePasswordCommandTests
{
    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e este carrega as duas senhas.</summary>
    [Trait("ChangePasswordCommand", "ToString")]
    [Fact(DisplayName = "ChangePasswordCommand_ToString_DoesNotContainThePasswords")]
    public void ChangePasswordCommand_ToString_DoesNotContainThePasswords()
    {
        //Arrange
        var command = UserFakers.ReturnChangePasswordCommandValid(currentPassword: "marca-da-senha-atual", newPassword: "marca-da-senha-nova");

        //Act
        var text = command.ToString();

        //Assert
        Assert.DoesNotContain("marca-da-senha-atual", text);
        Assert.DoesNotContain("marca-da-senha-nova", text);
        Assert.Equal(nameof(ChangePasswordCommand), text);
    }
}
