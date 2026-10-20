using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Folders.Queries;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;

namespace Prism.UnitTesting.Folders;

/// <summary>
/// As consultas leem o documento do cofre aberto; é aqui que as regras RN-PASTA-002 a 004 são
/// conferidas contra dados (as mesmas funções valem dentro da gravação, no `FolderRepositoryTests`).
/// </summary>
public sealed class FolderQueriesTests
{
    private readonly Mock<IVaultService> _vault = new();

    private FolderQueries CreateQueries(IReadOnlyList<VaultFolderRecord> folders, IReadOnlyList<VaultConnectionRecord>? connections = null)
    {
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", folders, connections ?? [], [], VaultWorkspaceRecord.Empty, [])));

        return new FolderQueries(_vault.Object);
    }

    private FolderQueries CreateLockedQueries()
    {
        _vault.Setup(v => v.Read()).Returns(Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));

        return new FolderQueries(_vault.Object);
    }

    [Trait("FolderQueries", "Exists")]
    [Fact(DisplayName = "OK o nome existe entre as irmãs, sem diferenciar maiúsculas nem acento de caixa")]
    public async Task Exists_ShouldBeTrue_WhenSiblingHasTheNameInAnotherCase()
    {
        //Arrange
        var parent = VaultFakers.CreateFolder(name: "Produção");
        var queries = CreateQueries([parent, VaultFakers.CreateFolder(parentID: parent.ID, name: "Célula Única")]);

        //Act
        var inRoot = await queries.Exists("PRODUÇÃO", null, CancellationToken.None);
        var inParent = await queries.Exists("célula única", parent.ID, CancellationToken.None);

        //Assert
        Assert.True(inRoot);
        Assert.True(inParent);
    }

    [Trait("FolderQueries", "Exists")]
    [Fact(DisplayName = "OK o mesmo nome em outra pasta pai, ou outro nome, não é duplicidade")]
    public async Task Exists_ShouldBeFalse_WhenNameIsFreeInThatParent()
    {
        //Arrange
        var parent = VaultFakers.CreateFolder(name: "Produção");
        var other = VaultFakers.CreateFolder(name: "Manutenção");
        var queries = CreateQueries([parent, other, VaultFakers.CreateFolder(parentID: parent.ID, name: "Linha 1")]);

        //Act
        var inOtherParent = await queries.Exists("Linha 1", other.ID, CancellationToken.None);
        var inRoot = await queries.Exists("Linha 1", null, CancellationToken.None);
        var otherName = await queries.Exists("Linha 2", parent.ID, CancellationToken.None);

        //Assert
        Assert.False(inOtherParent);
        Assert.False(inRoot);
        Assert.False(otherName);
    }

    [Trait("FolderQueries", "Exists")]
    [Fact(DisplayName = "OK cofre fechado no meio da requisição não acha nada, e quem recusa é a gravação")]
    public async Task Exists_ShouldBeFalse_WhenVaultIsLocked()
    {
        //Arrange
        var queries = CreateLockedQueries();

        //Act
        var exists = await queries.Exists("Produção", null, CancellationToken.None);

        //Assert
        Assert.False(exists);
    }

    [Trait("FolderQueries", "ExistsByID")]
    [Fact(DisplayName = "OK acha a pasta pelo ID")]
    public async Task ExistsByID_ShouldBeTrue_WhenFolderIsThere()
    {
        //Arrange
        var folder = VaultFakers.CreateFolder();
        var queries = CreateQueries([VaultFakers.CreateFolder(), folder]);

        //Act
        var exists = await queries.ExistsByID(folder.ID, CancellationToken.None);

        //Assert
        Assert.True(exists);
    }

    [Trait("FolderQueries", "ExistsByID")]
    [Fact(DisplayName = "OK não acha ID que não existe")]
    public async Task ExistsByID_ShouldBeFalse_WhenFolderIsNotThere()
    {
        //Arrange
        var queries = CreateQueries([VaultFakers.CreateFolder()]);

        //Act
        var exists = await queries.ExistsByID(Guid.CreateVersion7(), CancellationToken.None);

        //Assert
        Assert.False(exists);
    }

    [Trait("FolderQueries", "ExistsByID")]
    [Fact(DisplayName = "OK cofre fechado no meio da requisição não acha nada, e quem recusa é a gravação")]
    public async Task ExistsByID_ShouldBeFalse_WhenVaultIsLocked()
    {
        //Arrange
        var queries = CreateLockedQueries();

        //Act
        var exists = await queries.ExistsByID(Guid.CreateVersion7(), CancellationToken.None);

        //Assert
        Assert.False(exists);
    }

    [Trait("FolderQueries", "HasChildren")]
    [Fact(DisplayName = "OK pasta com subpasta tem filhos")]
    public async Task HasChildren_ShouldBeTrue_WhenThereIsASubfolder()
    {
        //Arrange
        var parent = VaultFakers.CreateFolder();
        var queries = CreateQueries([parent, VaultFakers.CreateFolder(parentID: parent.ID)]);

        //Act
        var hasChildren = await queries.HasChildren(parent.ID, CancellationToken.None);

        //Assert
        Assert.True(hasChildren);
    }

    /// <summary>RN-PASTA-004: "sem subpastas e sem conexões". Criar conexão é a Tarefa 5, então o caso só se prova aqui, com o registro já no cofre.</summary>
    [Trait("FolderQueries", "HasChildren")]
    [Fact(DisplayName = "OK pasta com conexão tem filhos")]
    public async Task HasChildren_ShouldBeTrue_WhenThereIsAConnection()
    {
        //Arrange
        var folder = VaultFakers.CreateFolder();
        var queries = CreateQueries([folder], [VaultFakers.CreateConnection(folderID: folder.ID)]);

        //Act
        var hasChildren = await queries.HasChildren(folder.ID, CancellationToken.None);

        //Assert
        Assert.True(hasChildren);
    }

    [Trait("FolderQueries", "HasChildren")]
    [Fact(DisplayName = "OK o que está em outra pasta não conta")]
    public async Task HasChildren_ShouldBeFalse_WhenTheChildrenBelongToAnotherFolder()
    {
        //Arrange
        var empty = VaultFakers.CreateFolder();
        var other = VaultFakers.CreateFolder();
        var queries = CreateQueries([empty, other, VaultFakers.CreateFolder(parentID: other.ID)], [VaultFakers.CreateConnection(folderID: other.ID), VaultFakers.CreateConnection(folderID: null)]);

        //Act
        var hasChildren = await queries.HasChildren(empty.ID, CancellationToken.None);

        //Assert
        Assert.False(hasChildren);
    }

    [Trait("FolderQueries", "IsSelfOrDescendant")]
    [Fact(DisplayName = "OK a própria pasta e as descendentes, em qualquer profundidade")]
    public async Task IsSelfOrDescendant_ShouldBeTrue_ForTheFolderItselfAndItsDescendants()
    {
        //Arrange
        var top = VaultFakers.CreateFolder();
        var middle = VaultFakers.CreateFolder(parentID: top.ID);
        var bottom = VaultFakers.CreateFolder(parentID: middle.ID);
        var queries = CreateQueries([top, middle, bottom]);

        //Act
        var itself = await queries.IsSelfOrDescendant(top.ID, top.ID, CancellationToken.None);
        var child = await queries.IsSelfOrDescendant(middle.ID, top.ID, CancellationToken.None);
        var grandchild = await queries.IsSelfOrDescendant(bottom.ID, top.ID, CancellationToken.None);

        //Assert
        Assert.True(itself);
        Assert.True(child);
        Assert.True(grandchild);
    }

    [Trait("FolderQueries", "IsSelfOrDescendant")]
    [Fact(DisplayName = "OK a ancestral, a irmã e a raiz não são descendentes")]
    public async Task IsSelfOrDescendant_ShouldBeFalse_ForAncestorsAndUnrelatedFolders()
    {
        //Arrange
        var top = VaultFakers.CreateFolder();
        var middle = VaultFakers.CreateFolder(parentID: top.ID);
        var sibling = VaultFakers.CreateFolder(parentID: top.ID);
        var queries = CreateQueries([top, middle, sibling]);

        //Act
        var ancestor = await queries.IsSelfOrDescendant(top.ID, middle.ID, CancellationToken.None);
        var unrelated = await queries.IsSelfOrDescendant(sibling.ID, middle.ID, CancellationToken.None);
        var unknown = await queries.IsSelfOrDescendant(Guid.CreateVersion7(), top.ID, CancellationToken.None);

        //Assert
        Assert.False(ancestor);
        Assert.False(unrelated);
        Assert.False(unknown);
    }

    /// <summary>A subida pelas pastas pai é limitada: um documento que já tenha ciclo (que a gravação não deixa mais criar) não pode travar a API, que segura o cofre durante a consulta.</summary>
    [Trait("FolderQueries", "IsSelfOrDescendant")]
    [Fact(DisplayName = "OK termina num documento que já tem ciclo")]
    public async Task IsSelfOrDescendant_ShouldEnd_WhenTheDocumentAlreadyHasACycle()
    {
        //Arrange
        var firstID = Guid.CreateVersion7();
        var secondID = Guid.CreateVersion7();
        var queries = CreateQueries([VaultFakers.CreateFolder(iD: firstID, parentID: secondID), VaultFakers.CreateFolder(iD: secondID, parentID: firstID)]);

        //Act
        // Task.Run: a consulta é síncrona por dentro, e um laço sem fim travaria o teste antes de o prazo valer.
        var isDescendant = await Task.Run(() => queries.IsSelfOrDescendant(firstID, Guid.CreateVersion7(), CancellationToken.None)).WaitAsync(TimeSpan.FromSeconds(5));

        //Assert
        Assert.False(isDescendant);
    }
}
