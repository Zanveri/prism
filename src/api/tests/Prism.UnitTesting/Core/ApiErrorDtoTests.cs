using Prism.Core.Api.Models.Dtos;
using System.Net;

namespace Prism.UnitTesting.Core;

public sealed class ApiErrorDtoTests
{
    /// <summary>
    /// O 422 de uma regra de negócio que a tela mostra no campo, na forma do filtro de validação (`errors` e `errorCodes` por campo, com o nome da propriedade em PascalCase):
    /// é o que a senha da conexão (RN-CONN-004) e as recusas da troca de senha (RN-COFRE-013) devolvem. A mensagem é o detalhe e o texto do campo; o código é o `type` e o do campo.
    /// </summary>
    [Trait("ApiErrorDto", "CreateUnprocessableEntityOnField")]
    [Fact(DisplayName = "OK 422 com o erro no campo, na forma do filtro de validação")]
    public void CreateUnprocessableEntityOnField_ShouldBe422_WithTheErrorOnTheField()
    {
        //Act
        var error = ApiErrorDto.CreateUnprocessableEntityOnField("Senha incorreta.", "INVALID_PASSWORD", "CurrentPassword", "A senha atual não confere.");

        //Assert
        var errors = Assert.IsType<Dictionary<string, string[]>>(error.Extensions["errors"]);
        var errorCodes = Assert.IsType<Dictionary<string, string[]>>(error.Extensions["errorCodes"]);
        Assert.Equal("INVALID_PASSWORD", error.Type);
        Assert.Equal("Senha incorreta.", error.Title);
        Assert.Equal("A senha atual não confere.", error.Detail);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        Assert.Equal(422, error.Status);
        Assert.Equal(["CurrentPassword"], errors.Keys);
        Assert.Equal(["A senha atual não confere."], errors["CurrentPassword"]);
        Assert.Equal(["CurrentPassword"], errorCodes.Keys);
        Assert.Equal(["INVALID_PASSWORD"], errorCodes["CurrentPassword"]);
    }
}
