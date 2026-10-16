using Prism.Application.ScriptFolders.Models;
using System.Net;

namespace Prism.UnitTesting.ScriptFolders;

/// <summary>
/// Os códigos e os status são os da seção 33 da especificação (RN-SCRIPT-007 e 009), e o detalhe é a frase que a tela mostra no aviso de erro: a pasta pai da
/// criação, o destino do "Mover para…" e a pasta escolhida ao salvar dizem cada um o seu, com o mesmo código.
/// </summary>
public sealed class ScriptFolderErrorsTests
{
    [Trait("ScriptFolderErrors", "NotFound")]
    [Fact(DisplayName = "OK 404 SCRIPT_FOLDER_NOT_FOUND com a frase de cada lugar")]
    public void NotFound_ShouldBe404()
    {
        //Arrange
        var iD = Guid.CreateVersion7();

        //Act
        var errors = new[] { ScriptFolderErrors.NotFound(iD), ScriptFolderErrors.ParentNotFound(), ScriptFolderErrors.DestinationNotFound(), ScriptFolderErrors.ChosenNotFound() };

        //Assert
        Assert.All(errors, error => Assert.Equal(("SCRIPT_FOLDER_NOT_FOUND", HttpStatusCode.NotFound), (error.Type, error.StatusCode)));
        Assert.Contains(iD.ToString(), errors[0].Detail);
        Assert.Equal(["A pasta pai não existe mais.", "A pasta de destino não existe mais.", "A pasta escolhida não existe mais."], errors.Skip(1).Select(error => error.Detail));
    }

    [Trait("ScriptFolderErrors", "Conflict")]
    [Fact(DisplayName = "OK 409 do nome repetido (com o lugar) e do ciclo")]
    public void Conflicts_ShouldBe409()
    {
        //Act
        var atRoot = ScriptFolderErrors.AlreadyExists("Mensal", null);
        var inside = ScriptFolderErrors.AlreadyExists("Abril", "Fechamento / Mensal");
        var cycle = ScriptFolderErrors.Cycle();

        //Assert
        Assert.Equal(("SCRIPT_FOLDER_ALREADY_EXISTS", HttpStatusCode.Conflict), (atRoot.Type, atRoot.StatusCode));
        Assert.Equal("Já existe uma pasta chamada Mensal na raiz da seção Scripts.", atRoot.Detail);
        Assert.Equal("Já existe uma pasta chamada Abril em Fechamento / Mensal.", inside.Detail);
        Assert.Equal(("SCRIPT_FOLDER_CYCLE", HttpStatusCode.Conflict), (cycle.Type, cycle.StatusCode));
    }

    [Trait("ScriptFolderErrors", "NotEmpty")]
    [Theory(DisplayName = "OK o que há dentro da pasta, no singular e no plural, e só com a parte que existe")]
    [InlineData(2, 3, "2 subpastas e 3 scripts")]
    [InlineData(1, 1, "1 subpasta e 1 script")]
    [InlineData(1, 0, "1 subpasta")]
    [InlineData(0, 1, "1 script")]
    [InlineData(4, 0, "4 subpastas")]
    [InlineData(0, 12, "12 scripts")]
    public void NotEmpty_SaysTheContents(int folders, int scripts, string contents)
    {
        //Act
        var error = ScriptFolderErrors.NotEmpty("Fechamento", folders, scripts);

        //Assert
        Assert.Equal(("SCRIPT_FOLDER_NOT_EMPTY", HttpStatusCode.Conflict), (error.Type, error.StatusCode));
        Assert.Equal($"A pasta Fechamento tem {contents}. Só uma pasta vazia pode ser excluída: mova ou exclua antes o que está dentro dela.", error.Detail);
        Assert.Equal((folders, scripts), ((int)error.Extensions["folders"]!, (int)error.Extensions["scripts"]!));
    }
}
