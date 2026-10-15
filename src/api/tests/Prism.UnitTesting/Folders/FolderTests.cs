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
        var folder = Folder.Create("  Produção   Sul ", parentID, null, null, null, null, false, CreatedAt);

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
        var first = Folder.Create("Produção", null, null, null, null, null, false, CreatedAt);
        var second = Folder.Create("Produção", null, null, null, null, null, false, CreatedAt);

        //Assert
        Assert.Equal(7, first.ID.Version);
        Assert.NotEqual(first.ID, second.ID);
    }

    [Trait("Folder", "Create")]
    [Fact(DisplayName = "OK sem pasta pai é a raiz")]
    public void Create_ShouldBeRoot_WhenParentIsNull()
    {
        //Act
        var folder = Folder.Create("Produção", null, null, null, null, null, false, CreatedAt);

        //Assert
        Assert.Null(folder.ParentID);
    }

    [Trait("Folder", "Rename")]
    [Fact(DisplayName = "OK normaliza o nome e carimba UpdatedAt sem mexer em CreatedAt")]
    public void Rename_ShouldBeOK()
    {
        //Arrange
        var parentID = Guid.CreateVersion7();
        var folder = Folder.Create("Antiga", parentID, null, null, null, null, false, CreatedAt);

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
        var folder = Folder.Create("Linha 1", null, null, null, null, null, false, CreatedAt);
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
        var folder = Folder.Create("Linha 1", Guid.CreateVersion7(), null, null, null, null, false, CreatedAt);

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
        var folder = Folder.Restore(iD, parentID, "Produção", "Produção", "#FF8A7A", "#7DB2FF", null, false, CreatedAt, LaterAt);

        //Assert
        Assert.Equal(iD, folder.ID);
        Assert.Equal(parentID, folder.ParentID);
        Assert.Equal("Produção", folder.Name);
        Assert.Equal("Produção", folder.EnvironmentName);
        Assert.Equal("#FF8A7A", folder.EnvironmentColor);
        Assert.Equal("#7DB2FF", folder.Color);
        Assert.Equal(CreatedAt, folder.CreatedAt);
        Assert.Equal(LaterAt, folder.UpdatedAt);
    }

    /// <summary>RN-PASTA-005: o ambiente da pasta tem a normalização do ambiente da conexão (RN-CONN-010), a mesma função, e não uma cópia.</summary>
    [Trait("Folder", "Create")]
    [Fact(DisplayName = "OK normaliza o nome do ambiente e apara a cor")]
    public void Create_ShouldNormalizeTheEnvironment()
    {
        //Act
        var folder = Folder.Create("Produção", null, "  Produção   Sul ", " #FF8A7A ", null, null, false, CreatedAt);

        //Assert
        Assert.Equal("Produção Sul", folder.EnvironmentName);
        Assert.Equal("#FF8A7A", folder.EnvironmentColor);
    }

    [Trait("Folder", "Create")]
    [Fact(DisplayName = "OK ambiente em branco é sem ambiente, e não um nome vazio")]
    public void Create_ShouldBeWithoutEnvironment_WhenTheEnvironmentIsBlank()
    {
        //Act
        var blank = Folder.Create("Produção", null, "   ", "  ", null, null, false, CreatedAt);
        var none = Folder.Create("Produção", null, null, null, null, null, false, CreatedAt);

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
        var folder = Folder.Create("Linha 1", parentID, "QAS", "#F2B644", null, null, false, CreatedAt);

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
        var folder = Folder.Create("Linha 1", null, "QAS", "#F2B644", null, null, false, CreatedAt);

        //Act
        folder.ChangeEnvironment(" ", null, LaterAt);

        //Assert
        Assert.Null(folder.EnvironmentName);
        Assert.Null(folder.EnvironmentColor);
    }

    /// <summary>RN-PASTA-007: a cor da pasta é a do ícone dela, à parte do ambiente; a normalização é a da cor do ambiente, a mesma função.</summary>
    [Trait("Folder", "Create")]
    [Fact(DisplayName = "OK apara a cor da pasta, e em branco é sem cor; o ambiente fica à parte")]
    public void Create_ShouldNormalizeTheColor()
    {
        //Act
        var colored = Folder.Create("Produção", null, null, null, " #7DB2FF ", null, false, CreatedAt);
        var blank = Folder.Create("Produção", null, "Produção", "#FF8A7A", "  ", null, false, CreatedAt);

        //Assert
        Assert.Equal("#7DB2FF", colored.Color);
        Assert.Null(colored.EnvironmentName);
        Assert.Null(blank.Color);
        Assert.Equal("#FF8A7A", blank.EnvironmentColor);
    }

    [Trait("Folder", "ChangeColor")]
    [Fact(DisplayName = "OK troca a cor aparada e carimba UpdatedAt sem mexer no ambiente nem no resto")]
    public void ChangeColor_ShouldBeOK()
    {
        //Arrange
        var parentID = Guid.CreateVersion7();
        var folder = Folder.Create("Linha 1", parentID, "QAS", "#F2B644", null, null, false, CreatedAt);

        //Act
        folder.ChangeColor(" #B79CFF", LaterAt);

        //Assert
        Assert.Equal("#B79CFF", folder.Color);
        Assert.Equal("QAS", folder.EnvironmentName);
        Assert.Equal("#F2B644", folder.EnvironmentColor);
        Assert.Equal(LaterAt, folder.UpdatedAt);
        Assert.Equal(CreatedAt, folder.CreatedAt);
        Assert.Equal("Linha 1", folder.Name);
        Assert.Equal(parentID, folder.ParentID);
    }

    [Trait("Folder", "ChangeColor")]
    [Fact(DisplayName = "OK em branco ou nula tira a cor, e o ícone volta ao neutro")]
    public void ChangeColor_ShouldRemoveTheColor_WhenBlank()
    {
        //Arrange
        var blank = Folder.Create("Linha 1", null, null, null, "#7DB2FF", null, false, CreatedAt);
        var none = Folder.Create("Linha 2", null, null, null, "#7DB2FF", null, false, CreatedAt);

        //Act
        blank.ChangeColor(" ", LaterAt);
        none.ChangeColor(null, LaterAt);

        //Assert
        Assert.Null(blank.Color);
        Assert.Null(none.Color);
    }

    /// <summary>RN-PROT-001 e 002: a confirmação "Não" se guarda nula, e mudar as proteções carimba a data.</summary>
    [Trait("Folder", "ChangeProtections")]
    [Fact(DisplayName = "OK muda as proteções, com o none e o branco nulos, e carimba UpdatedAt")]
    public void ChangeProtections_ShouldNormalizeAndStamp()
    {
        //Arrange
        var created = Folder.Create("Fábrica", null, null, null, null, " irreversible ", true, CreatedAt);
        var later = CreatedAt.AddDays(1);

        //Act
        var createdProtections = (created.ConfirmCommands, created.ReadOnly);
        created.ChangeProtections("none", false, later);

        //Assert
        Assert.Equal(("irreversible", true), createdProtections);
        Assert.Equal(((string?)null, false), (created.ConfirmCommands, created.ReadOnly));
        Assert.Equal(later, created.UpdatedAt);
    }
}
