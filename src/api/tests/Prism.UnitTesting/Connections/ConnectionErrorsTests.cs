using Prism.Application.Connections.Models;
using System.Net;

namespace Prism.UnitTesting.Connections;

/// <summary>Os códigos e os status são os da seção 6 da especificação (RN-CONN-002 e RN-CONN-011).</summary>
public sealed class ConnectionErrorsTests
{
    [Trait("ConnectionErrors", "NotFound")]
    [Fact(DisplayName = "OK 404 CONNECTION_NOT_FOUND com o ID no detalhe")]
    public void NotFound_ShouldBe404()
    {
        //Arrange
        var iD = Guid.CreateVersion7();

        //Act
        var error = ConnectionErrors.NotFound(iD);

        //Assert
        Assert.Equal("CONNECTION_NOT_FOUND", error.Type);
        Assert.Equal(HttpStatusCode.NotFound, error.StatusCode);
        Assert.Contains(iD.ToString(), error.Detail);
    }

    [Trait("ConnectionErrors", "AlreadyExists")]
    [Fact(DisplayName = "OK 409 CONNECTION_ALREADY_EXISTS com o nome no detalhe")]
    public void AlreadyExists_ShouldBe409()
    {
        //Act
        var error = ConnectionErrors.AlreadyExists("Produção");

        //Assert
        Assert.Equal("CONNECTION_ALREADY_EXISTS", error.Type);
        Assert.Equal(HttpStatusCode.Conflict, error.StatusCode);
        Assert.Contains("Produção", error.Detail);
    }

    /// <summary>RN-CONN-004 e 013: 422 `CONNECTION_INVALID` na forma do filtro de validação, com a mensagem no campo da senha, que é onde a tela a mostra.</summary>
    [Trait("ConnectionErrors", "PasswordRequiredToChangeServer")]
    [Fact(DisplayName = "OK 422 CONNECTION_INVALID no campo da senha, ao mudar o host ou a porta")]
    public void PasswordRequiredToChangeServer_ShouldBe422_OnThePasswordField()
    {
        //Act
        var error = ConnectionErrors.PasswordRequiredToChangeServer();

        //Assert
        Assert.Equal("CONNECTION_INVALID", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        Assert.Equal("Ao mudar o host ou a porta, informe a senha da conexão de novo.", error.Detail);
        Assert.Equal(["Ao mudar o host ou a porta, informe a senha da conexão de novo."], ((Dictionary<string, string[]>)error.Extensions["errors"]!)["Password"]);
        Assert.Equal(["CONNECTION_INVALID"], ((Dictionary<string, string[]>)error.Extensions["errorCodes"]!)["Password"]);
    }

    [Trait("ConnectionErrors", "PasswordRequiredToTestOtherServer")]
    [Fact(DisplayName = "OK 422 CONNECTION_INVALID no campo da senha, ao testar outro host ou outra porta")]
    public void PasswordRequiredToTestOtherServer_ShouldBe422_OnThePasswordField()
    {
        //Act
        var error = ConnectionErrors.PasswordRequiredToTestOtherServer();

        //Assert
        Assert.Equal("CONNECTION_INVALID", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        Assert.Equal("Para testar com outro host ou outra porta, informe a senha da conexão.", error.Detail);
        Assert.Equal(["Para testar com outro host ou outra porta, informe a senha da conexão."], ((Dictionary<string, string[]>)error.Extensions["errors"]!)["Password"]);
        Assert.Equal(["CONNECTION_INVALID"], ((Dictionary<string, string[]>)error.Extensions["errorCodes"]!)["Password"]);
    }

    [Trait("ConnectionErrors", "InvalidPassword")]
    [Fact(DisplayName = "OK 422 INVALID_PASSWORD, e não 401, que a tela renovaria")]
    public void InvalidPassword_ShouldBe422()
    {
        //Act
        var error = ConnectionErrors.InvalidPassword();

        //Assert
        Assert.Equal("INVALID_PASSWORD", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
    }
}
