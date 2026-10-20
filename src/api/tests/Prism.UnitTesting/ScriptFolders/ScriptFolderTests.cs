using Prism.Application.ScriptFolders.Domain;
using Prism.TestingCore.Fakers.ScriptFolders;

namespace Prism.UnitTesting.ScriptFolders;

/// <summary>RN-SCRIPT-007: a pasta de scripts nasce com o nome normalizado, e o `PATCH` a grava por inteiro, sem carimbar a data quando nada mudou.</summary>
public sealed class ScriptFolderTests
{
    private static readonly DateTime Now = new(2026, 10, 16, 12, 0, 0, DateTimeKind.Utc);

    [Trait("ScriptFolder", "Create")]
    [Fact(DisplayName = "OK nasce com ID, o nome normalizado, a pasta pai e as duas datas iguais")]
    public void Create_ShouldBeOK()
    {
        //Arrange
        var parentID = Guid.CreateVersion7();

        //Act
        var folder = ScriptFolder.Create("  Fechamento   do mês ", parentID, Now);

        //Assert
        Assert.NotEqual(Guid.Empty, folder.ID);
        Assert.Equal("Fechamento do mês", folder.Name);
        Assert.Equal(parentID, folder.ParentID);
        Assert.Equal((Now, Now), (folder.CreatedAt, folder.UpdatedAt));
    }

    [Trait("ScriptFolder", "Change")]
    [Fact(DisplayName = "OK o mesmo nome (depois de normalizado) e a mesma pasta pai não mudam nada, nem a data")]
    public void Change_SameNameAndParent_ChangesNothing()
    {
        //Arrange
        var parentID = Guid.CreateVersion7();
        var folder = ScriptFolderFakers.Create(parentID: parentID, name: "Fechamento");
        var updatedAt = folder.UpdatedAt;

        //Act
        var changed = folder.Change("  Fechamento ", parentID, Now);

        //Assert
        Assert.False(changed);
        Assert.Equal(updatedAt, folder.UpdatedAt);
    }

    [Trait("ScriptFolder", "Change")]
    [Fact(DisplayName = "OK mudar só as maiúsculas do nome é mudança, e carimba a data")]
    public void Change_OnlyTheCase_Changes()
    {
        //Arrange
        var folder = ScriptFolderFakers.Create(name: "fechamento");

        //Act
        var changed = folder.Change("Fechamento", null, Now);

        //Assert
        Assert.True(changed);
        Assert.Equal("Fechamento", folder.Name);
        Assert.Equal(Now, folder.UpdatedAt);
    }

    [Trait("ScriptFolder", "Change")]
    [Fact(DisplayName = "OK mover troca a pasta pai, e a pasta pai nula é a raiz")]
    public void Change_Move_ChangesTheParent()
    {
        //Arrange
        var folder = ScriptFolderFakers.Create(parentID: Guid.CreateVersion7(), name: "Mensal");
        var createdAt = folder.CreatedAt;

        //Act
        var changed = folder.Change("Mensal", null, Now);

        //Assert
        Assert.True(changed);
        Assert.Null(folder.ParentID);
        Assert.Equal(createdAt, folder.CreatedAt);
        Assert.Equal(Now, folder.UpdatedAt);
    }
}
