using Prism.Application.Folders.Models;
using System.Net;

namespace Prism.UnitTesting.Folders;

/// <summary>Os códigos e os status são os da seção 6 da especificação (RN-PASTA-002 a 004).</summary>
public sealed class FolderErrorsTests
{
    [Trait("FolderErrors", "NotFound")]
    [Fact(DisplayName = "OK 404 FOLDER_NOT_FOUND com o ID no detalhe")]
    public void NotFound_ShouldBe404()
    {
        //Arrange
        var iD = Guid.CreateVersion7();

        //Act
        var error = FolderErrors.NotFound(iD);

        //Assert
        Assert.Equal("FOLDER_NOT_FOUND", error.Type);
        Assert.Equal(HttpStatusCode.NotFound, error.StatusCode);
        Assert.Contains(iD.ToString(), error.Detail);
    }

    [Trait("FolderErrors", "ParentNotFound")]
    [Fact(DisplayName = "OK 404 FOLDER_NOT_FOUND dizendo que é a pasta pai")]
    public void ParentNotFound_ShouldBe404WithTheSameCode()
    {
        //Arrange
        var parentID = Guid.CreateVersion7();

        //Act
        var error = FolderErrors.ParentNotFound(parentID);

        //Assert
        Assert.Equal("FOLDER_NOT_FOUND", error.Type);
        Assert.Equal(HttpStatusCode.NotFound, error.StatusCode);
        Assert.Contains("pai", error.Detail);
        Assert.Contains(parentID.ToString(), error.Detail);
    }

    [Trait("FolderErrors", "AlreadyExists")]
    [Fact(DisplayName = "OK 409 FOLDER_ALREADY_EXISTS com o nome no detalhe")]
    public void AlreadyExists_ShouldBe409()
    {
        //Act
        var error = FolderErrors.AlreadyExists("Produção");

        //Assert
        Assert.Equal("FOLDER_ALREADY_EXISTS", error.Type);
        Assert.Equal(HttpStatusCode.Conflict, error.StatusCode);
        Assert.Contains("Produção", error.Detail);
    }

    [Trait("FolderErrors", "Cycle")]
    [Fact(DisplayName = "OK 409 FOLDER_CYCLE")]
    public void Cycle_ShouldBe409()
    {
        //Act
        var error = FolderErrors.Cycle();

        //Assert
        Assert.Equal("FOLDER_CYCLE", error.Type);
        Assert.Equal(HttpStatusCode.Conflict, error.StatusCode);
    }

    [Trait("FolderErrors", "NotEmpty")]
    [Fact(DisplayName = "OK 409 FOLDER_NOT_EMPTY")]
    public void NotEmpty_ShouldBe409()
    {
        //Act
        var error = FolderErrors.NotEmpty();

        //Assert
        Assert.Equal("FOLDER_NOT_EMPTY", error.Type);
        Assert.Equal(HttpStatusCode.Conflict, error.StatusCode);
    }
}
