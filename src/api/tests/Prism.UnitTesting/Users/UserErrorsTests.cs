using Prism.Application.Users.Models;
using System.Net;

namespace Prism.UnitTesting.Users;

/// <summary>
/// RN-COFRE-013. As duas recusas do serviço na troca de senha são 422 e levam o campo no mesmo formato do filtro de validação (`errors` e
/// `errorCodes` por campo, com o nome da propriedade em PascalCase, como as outras rotas os devolvem; a tela os lê com a primeira letra em
/// minúscula), para a tela mostrar a mensagem no campo certo: a senha atual errada no `CurrentPassword`, com o código `INVALID_PASSWORD` da
/// revelação de senha, e a igual no `NewPassword`. A senha nova inválida (`PASSWORD_INVALID`) é do validator, e não está aqui.
/// </summary>
public sealed class UserErrorsTests
{
    [Trait("UserErrors", "CurrentPasswordInvalid")]
    [Fact(DisplayName = "OK senha atual errada é 422 INVALID_PASSWORD no campo da senha atual")]
    public void CurrentPasswordInvalid_Is422InvalidPasswordOnTheCurrentPasswordField()
    {
        //Act
        var error = UserErrors.CurrentPasswordInvalid();

        //Assert
        var errors = Assert.IsType<Dictionary<string, string[]>>(error.Extensions["errors"]);
        var errorCodes = Assert.IsType<Dictionary<string, string[]>>(error.Extensions["errorCodes"]);
        Assert.Equal("INVALID_PASSWORD", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        Assert.Equal("Senha incorreta.", error.Title);
        Assert.Equal("A senha atual não confere.", error.Detail);
        Assert.Equal(["CurrentPassword"], errors.Keys);
        Assert.Equal(["A senha atual não confere."], errors["CurrentPassword"]);
        Assert.Equal(["CurrentPassword"], errorCodes.Keys);
        Assert.Equal(["INVALID_PASSWORD"], errorCodes["CurrentPassword"]);
    }

    [Trait("UserErrors", "PasswordUnchanged")]
    [Fact(DisplayName = "OK senha nova igual à atual é 422 PASSWORD_UNCHANGED no campo da senha nova")]
    public void PasswordUnchanged_Is422PasswordUnchangedOnTheNewPasswordField()
    {
        //Act
        var error = UserErrors.PasswordUnchanged();

        //Assert
        var errors = Assert.IsType<Dictionary<string, string[]>>(error.Extensions["errors"]);
        var errorCodes = Assert.IsType<Dictionary<string, string[]>>(error.Extensions["errorCodes"]);
        Assert.Equal("PASSWORD_UNCHANGED", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        Assert.Equal("Senha nova igual à atual.", error.Title);
        Assert.Equal("A nova senha deve ser diferente da atual.", error.Detail);
        Assert.Equal(["NewPassword"], errors.Keys);
        Assert.Equal(["A nova senha deve ser diferente da atual."], errors["NewPassword"]);
        Assert.Equal(["NewPassword"], errorCodes.Keys);
        Assert.Equal(["PASSWORD_UNCHANGED"], errorCodes["NewPassword"]);
    }
}
