using Prism.Application.BuildModels.Models;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.UnitTesting.Core;

public sealed class ResourceManagerExtensionsTests
{
    private static readonly ResourceManager Texts = new(typeof(BuildModelErrors));

    [Trait("ResourceManagerExtensions", "Get")]
    [Fact(DisplayName = "OK o texto em português, com o argumento no lugar do marcador")]
    public void Get_ShouldBeThePortugueseText_WithTheArguments()
    {
        //Arrange
        var id = Guid.NewGuid();

        //Act
        var title = Texts.Get("NotFoundTitle");
        var detail = Texts.Get("NotFoundDetail", id);

        //Assert
        Assert.Equal("Modelo não localizado.", title);
        Assert.Equal($"Não existe um modelo com o ID {id}.", detail);
    }

    [Trait("ResourceManagerExtensions", "Get")]
    [Fact(DisplayName = "OK a chave que falta volta como veio, sem derrubar a resposta")]
    public void Get_ShouldBeTheKey_WhenTheKeyIsMissing()
    {
        //Act
        var text = Texts.Get("ChaveQueNaoExiste", 1);

        //Assert
        Assert.Equal("ChaveQueNaoExiste", text);
    }
}
