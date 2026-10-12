using Prism.Application.Folders.Domain;

namespace Prism.UnitTesting.Folders;

public sealed class FolderTests
{
    private static readonly DateTime CreatedAt = new(2026, 10, 9, 12, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime LaterAt = new(2026, 10, 10, 8, 30, 0, DateTimeKind.Utc);

    [Trait("Folder", "Create")]
    [Fact(DisplayName = "OK normaliza o nome e carimba as duas datas")]
    public void Create_ShouldBeOK()
    {
        //Arrange
        var parentID = Guid.CreateVersion7();

        //Act
        var folder = Folder.Create("  Produção   Sul ", parentID, CreatedAt);

        //Assert
        Assert.Equal("Produção Sul", folder.Name);
        Assert.Equal(parentID, folder.ParentID);
        Assert.Equal(CreatedAt, folder.CreatedAt);
        Assert.Equal(CreatedAt, folder.UpdatedAt);
    }

    /// <summary>O ID nasce no domínio, e não no cofre: a tela o recebe na resposta da criação e o usa em seguida.</summary>
    [Trait("Folder", "Create")]
    [Fact(DisplayName = "OK o ID é um Guid versão 7, novo a cada pasta")]
    public void Create_ShouldGenerateAVersion7ID()
    {
        //Act
        var first = Folder.Create("Produção", null, CreatedAt);
        var second = Folder.Create("Produção", null, CreatedAt);

        //Assert
        Assert.Equal(7, first.ID.Version);
        Assert.NotEqual(first.ID, second.ID);
    }

    [Trait("Folder", "Create")]
    [Fact(DisplayName = "OK sem pasta pai é a raiz")]
    public void Create_ShouldBeRoot_WhenParentIsNull()
    {
        //Act
        var folder = Folder.Create("Produção", null, CreatedAt);

        //Assert
        Assert.Null(folder.ParentID);
    }

    [Trait("Folder", "Rename")]
    [Fact(DisplayName = "OK normaliza o nome e carimba UpdatedAt sem mexer em CreatedAt")]
    public void Rename_ShouldBeOK()
    {
        //Arrange
        var parentID = Guid.CreateVersion7();
        var folder = Folder.Create("Antiga", parentID, CreatedAt);

        //Act
        folder.Rename("  Nova   pasta ", LaterAt);

        //Assert
        Assert.Equal("Nova pasta", folder.Name);
        Assert.Equal(LaterAt, folder.UpdatedAt);
        Assert.Equal(CreatedAt, folder.CreatedAt);
        Assert.Equal(parentID, folder.ParentID);
    }

    [Trait("Folder", "MoveTo")]
    [Fact(DisplayName = "OK muda a pasta pai e carimba UpdatedAt sem mexer em CreatedAt")]
    public void MoveTo_ShouldBeOK()
    {
        //Arrange
        var folder = Folder.Create("Linha 1", null, CreatedAt);
        var newParentID = Guid.CreateVersion7();

        //Act
        folder.MoveTo(newParentID, LaterAt);

        //Assert
        Assert.Equal(newParentID, folder.ParentID);
        Assert.Equal(LaterAt, folder.UpdatedAt);
        Assert.Equal(CreatedAt, folder.CreatedAt);
        Assert.Equal("Linha 1", folder.Name);
    }

    [Trait("Folder", "MoveTo")]
    [Fact(DisplayName = "OK nulo move para a raiz")]
    public void MoveTo_ShouldMoveToRoot_WhenParentIsNull()
    {
        //Arrange
        var folder = Folder.Create("Linha 1", Guid.CreateVersion7(), CreatedAt);

        //Act
        folder.MoveTo(null, LaterAt);

        //Assert
        Assert.Null(folder.ParentID);
        Assert.Equal(LaterAt, folder.UpdatedAt);
    }

    [Trait("Folder", "Restore")]
    [Fact(DisplayName = "OK devolve a pasta como está gravada, sem normalizar nem carimbar")]
    public void Restore_ShouldKeepEveryField()
    {
        //Arrange
        var iD = Guid.CreateVersion7();
        var parentID = Guid.CreateVersion7();

        //Act
        var folder = Folder.Restore(iD, parentID, "Produção", CreatedAt, LaterAt);

        //Assert
        Assert.Equal(iD, folder.ID);
        Assert.Equal(parentID, folder.ParentID);
        Assert.Equal("Produção", folder.Name);
        Assert.Equal(CreatedAt, folder.CreatedAt);
        Assert.Equal(LaterAt, folder.UpdatedAt);
    }
}
