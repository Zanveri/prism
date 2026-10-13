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
        var folder = Folder.Create("  Produção   Sul ", parentID, null, null, CreatedAt);

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
        var first = Folder.Create("Produção", null, null, null, CreatedAt);
        var second = Folder.Create("Produção", null, null, null, CreatedAt);

        //Assert
        Assert.Equal(7, first.ID.Version);
        Assert.NotEqual(first.ID, second.ID);
    }

    [Trait("Folder", "Create")]
    [Fact(DisplayName = "OK sem pasta pai é a raiz")]
    public void Create_ShouldBeRoot_WhenParentIsNull()
    {
        //Act
        var folder = Folder.Create("Produção", null, null, null, CreatedAt);

        //Assert
        Assert.Null(folder.ParentID);
    }

    [Trait("Folder", "Rename")]
    [Fact(DisplayName = "OK normaliza o nome e carimba UpdatedAt sem mexer em CreatedAt")]
    public void Rename_ShouldBeOK()
    {
        //Arrange
        var parentID = Guid.CreateVersion7();
        var folder = Folder.Create("Antiga", parentID, null, null, CreatedAt);

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
        var folder = Folder.Create("Linha 1", null, null, null, CreatedAt);
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
        var folder = Folder.Create("Linha 1", Guid.CreateVersion7(), null, null, CreatedAt);

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
        var folder = Folder.Restore(iD, parentID, "Produção", "Produção", "#FF8A7A", CreatedAt, LaterAt);

        //Assert
        Assert.Equal(iD, folder.ID);
        Assert.Equal(parentID, folder.ParentID);
        Assert.Equal("Produção", folder.Name);
        Assert.Equal("Produção", folder.EnvironmentName);
        Assert.Equal("#FF8A7A", folder.EnvironmentColor);
        Assert.Equal(CreatedAt, folder.CreatedAt);
        Assert.Equal(LaterAt, folder.UpdatedAt);
    }

    /// <summary>RN-PASTA-005: o ambiente da pasta tem a normalização do ambiente da conexão (RN-CONN-010), a mesma função, e não uma cópia.</summary>
    [Trait("Folder", "Create")]
    [Fact(DisplayName = "OK normaliza o nome do ambiente e apara a cor")]
    public void Create_ShouldNormalizeTheEnvironment()
    {
        //Act
        var folder = Folder.Create("Produção", null, "  Produção   Sul ", " #FF8A7A ", CreatedAt);

        //Assert
        Assert.Equal("Produção Sul", folder.EnvironmentName);
        Assert.Equal("#FF8A7A", folder.EnvironmentColor);
    }

    [Trait("Folder", "Create")]
    [Fact(DisplayName = "OK ambiente em branco é sem ambiente, e não um nome vazio")]
    public void Create_ShouldBeWithoutEnvironment_WhenTheEnvironmentIsBlank()
    {
        //Act
        var blank = Folder.Create("Produção", null, "   ", "  ", CreatedAt);
        var none = Folder.Create("Produção", null, null, null, CreatedAt);

        //Assert
        Assert.Null(blank.EnvironmentName);
        Assert.Null(blank.EnvironmentColor);
        Assert.Null(none.EnvironmentName);
        Assert.Null(none.EnvironmentColor);
    }

    [Trait("Folder", "ChangeEnvironment")]
    [Fact(DisplayName = "OK troca o ambiente normalizado e carimba UpdatedAt sem mexer no resto")]
    public void ChangeEnvironment_ShouldBeOK()
    {
        //Arrange
        var parentID = Guid.CreateVersion7();
        var folder = Folder.Create("Linha 1", parentID, "QAS", "#F2B644", CreatedAt);

        //Act
        folder.ChangeEnvironment("  Produção ", " #FF8A7A", LaterAt);

        //Assert
        Assert.Equal("Produção", folder.EnvironmentName);
        Assert.Equal("#FF8A7A", folder.EnvironmentColor);
        Assert.Equal(LaterAt, folder.UpdatedAt);
        Assert.Equal(CreatedAt, folder.CreatedAt);
        Assert.Equal("Linha 1", folder.Name);
        Assert.Equal(parentID, folder.ParentID);
    }

    [Trait("Folder", "ChangeEnvironment")]
    [Fact(DisplayName = "OK em branco tira o ambiente")]
    public void ChangeEnvironment_ShouldRemoveTheEnvironment_WhenBlank()
    {
        //Arrange
        var folder = Folder.Create("Linha 1", null, "QAS", "#F2B644", CreatedAt);

        //Act
        folder.ChangeEnvironment(" ", null, LaterAt);

        //Assert
        Assert.Null(folder.EnvironmentName);
        Assert.Null(folder.EnvironmentColor);
    }
}
