using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Folders.Domain;
using Prism.Application.Folders.Repositories;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Folders;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Folders;

/// <summary>
/// O que o repository entrega ao `SaveAsync` é uma função, e é ela que o serviço roda com o cofre
/// reservado. Estes testes fazem o papel do serviço: rodam a função contra um documento que já tem o
/// que uma requisição concorrente teria gravado entre a conferência do handler e a gravação, e conferem
/// que a regra vale ali dentro (RN-PASTA-002 a 004): é o que fecha a janela da corrida, sem depender de
/// as duas requisições calharem de se cruzar.
/// </summary>
public sealed class FolderRepositoryTests
{
    private readonly Mock<IVaultService> _vault = new();
    private VaultDocument? _saved;

    private static VaultDocument Document(IReadOnlyList<VaultFolderRecord> folders, IReadOnlyList<VaultConnectionRecord>? connections = null)
        => new("marina.costa", folders, connections ?? []);

    private static VaultFolderRecord ToRecord(Folder folder)
        => new(folder.ID, folder.ParentID, folder.Name, folder.CreatedAt, folder.UpdatedAt);

    /// <summary>Roda a função do `SaveAsync` contra o documento atual, como o serviço faz, e responde o que o teste mandou (sucesso por padrão).</summary>
    private FolderRepository CreateRepository(VaultDocument current, EVaultError? failure = null)
    {
        _vault.Setup(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()))
            .Returns((Func<VaultDocument, VaultDocument> change, CancellationToken _) =>
            {
                _saved = change(current);

                return Task.FromResult(failure is null ? UnitResult.Success<EVaultError>() : UnitResult.Failure(failure.Value));
            });

        return new FolderRepository(_vault.Object);
    }

    private void VerifySavedOnce(CancellationToken cancellationToken)
    {
        _vault.Verify(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("FolderRepository", "Insert")]
    [Fact(DisplayName = "OK acrescenta a pasta ao documento sem mexer no resto")]
    public async Task Insert_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var existing = VaultFakers.CreateFolder();
        var connection = VaultFakers.CreateConnection(folderID: existing.ID);
        var current = Document([existing], [connection]);
        var folder = FolderFakers.Create(parentID: existing.ID);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Insert(folder, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(_saved);
        Assert.Equal([existing, ToRecord(folder)], _saved.Folders);
        Assert.Same(current.Connections, _saved.Connections);
        Assert.Equal("marina.costa", _saved.UserName);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "Insert")]
    [Fact(DisplayName = "OK o mesmo nome em outra pasta pai é permitido")]
    public async Task Insert_ShouldBeOK_WhenTheNameIsTakenUnderAnotherParent()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var first = VaultFakers.CreateFolder(name: "Produção");
        var second = VaultFakers.CreateFolder(name: "Manutenção");
        var child = VaultFakers.CreateFolder(parentID: first.ID, name: "Linha 1");
        var folder = FolderFakers.Create(parentID: second.ID, name: "Linha 1");
        var repository = CreateRepository(Document([first, second, child]));

        //Act
        var result = await repository.Insert(folder, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(4, _saved!.Folders.Count);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>A corrida da criação: a conferência do handler passou e outra requisição gravou o mesmo nome antes. RN-PASTA-002.</summary>
    [Trait("FolderRepository", "Insert")]
    [Fact(DisplayName = "Erro o nome já está no documento entre as irmãs, e o documento fica como estava")]
    public async Task Insert_ShouldBeError_WhenASiblingWithTheNameWasSavedMeanwhile()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var other = VaultFakers.CreateFolder(name: "Produção");
        var current = Document([other]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Insert(FolderFakers.Create(name: "PRODUÇÃO"), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_ALREADY_EXISTS", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>A corrida contra a exclusão: a pasta pai existia na conferência e foi excluída (estava vazia) antes de a filha ser gravada. Sem esta regra a filha ficaria órfã.</summary>
    [Trait("FolderRepository", "Insert")]
    [Fact(DisplayName = "Erro a pasta pai já não está no documento, e o documento fica como estava")]
    public async Task Insert_ShouldBeError_WhenTheParentWasDeletedMeanwhile()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var current = Document([VaultFakers.CreateFolder()]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Insert(FolderFakers.Create(parentID: Guid.CreateVersion7()), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "Insert")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Insert_ShouldBeError_IVaultService_SaveAsync_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var repository = CreateRepository(Document([]), EVaultError.Locked);

        //Act
        var result = await repository.Insert(FolderFakers.Create(), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "Insert")]
    [Fact(DisplayName = "Erro disco indisponível")]
    public async Task Insert_ShouldBeError_IVaultService_SaveAsync_Unavailable()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var repository = CreateRepository(Document([]), EVaultError.Unavailable);

        //Act
        var result = await repository.Insert(FolderFakers.Create(), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_UNAVAILABLE", result.Error.Type);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, result.Error.StatusCode);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>O serviço do cofre não regrava por uma recusa, mas o `SaveAsync` pode voltar com uma falha mesmo assim (aqui, disco indisponível); o que o usuário precisa saber é por que o pedido dele foi recusado.</summary>
    [Trait("FolderRepository", "Insert")]
    [Fact(DisplayName = "Erro a recusa da regra vale mesmo que a regravação falhe")]
    public async Task Insert_ShouldReturnTheRuleRefusal_WhenTheRewriteAlsoFails()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var repository = CreateRepository(Document([VaultFakers.CreateFolder(name: "Produção")]), EVaultError.Unavailable);

        //Act
        var result = await repository.Insert(FolderFakers.Create(name: "Produção"), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_ALREADY_EXISTS", result.Error.Type);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "Update")]
    [Fact(DisplayName = "OK troca a pasta no lugar dela e deixa as outras como estavam")]
    public async Task Update_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var before = VaultFakers.CreateFolder(name: "Antes");
        var target = VaultFakers.CreateFolder(name: "Antiga");
        var after = VaultFakers.CreateFolder(name: "Depois");
        var newParent = VaultFakers.CreateFolder(name: "Nova pai");
        var folder = FolderFakers.Create(iD: target.ID, name: "Antiga", createdAt: target.CreatedAt);
        folder.Rename("Nova", target.UpdatedAt.AddDays(1));
        folder.MoveTo(newParent.ID, target.UpdatedAt.AddDays(1));
        var repository = CreateRepository(Document([before, target, after, newParent]));

        //Act
        var result = await repository.Update(folder, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal([before, ToRecord(folder), after, newParent], _saved!.Folders);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>Só a caixa muda: a pasta continua sendo a mesma chave entre as irmãs, e não colide com ela mesma.</summary>
    [Trait("FolderRepository", "Update")]
    [Fact(DisplayName = "OK a pasta não conta como irmã de si mesma")]
    public async Task Update_ShouldBeOK_WhenOnlyTheCaseOfItsOwnNameChanges()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateFolder(name: "Produção");
        var folder = FolderFakers.Create(iD: target.ID, name: "PRODUÇÃO", createdAt: target.CreatedAt);
        var repository = CreateRepository(Document([target]));

        //Act
        var result = await repository.Update(folder, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("PRODUÇÃO", _saved!.Folders.Single().Name);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "Update")]
    [Fact(DisplayName = "Erro a pasta foi excluída enquanto isso")]
    public async Task Update_ShouldBeError_WhenTheFolderWasDeletedMeanwhile()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var current = Document([VaultFakers.CreateFolder()]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(FolderFakers.Create(), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "Update")]
    [Fact(DisplayName = "Erro a nova pasta pai foi excluída enquanto isso")]
    public async Task Update_ShouldBeError_WhenTheNewParentWasDeletedMeanwhile()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateFolder();
        var current = Document([target]);
        var folder = FolderFakers.Create(iD: target.ID, name: target.Name, parentID: Guid.CreateVersion7(), createdAt: target.CreatedAt);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(folder, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>
    /// A corrida de dois movimentos: A para dentro de B e B para dentro de A passam juntos pela
    /// conferência do handler. O primeiro grava; o segundo, ao rodar contra o documento que já tem o
    /// primeiro, fecharia um ciclo, e é recusado. RN-PASTA-003.
    /// </summary>
    [Trait("FolderRepository", "Update")]
    [Fact(DisplayName = "Erro o movimento fecharia um ciclo com um movimento gravado enquanto isso")]
    public async Task Update_ShouldBeError_WhenAConcurrentMoveWouldCloseACycle()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var a = VaultFakers.CreateFolder(name: "A");
        var b = VaultFakers.CreateFolder(parentID: a.ID, name: "B");
        var current = Document([a, b]);
        var movingAIntoB = FolderFakers.Create(iD: a.ID, name: "A", parentID: b.ID, createdAt: a.CreatedAt);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(movingAIntoB, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_CYCLE", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "Update")]
    [Fact(DisplayName = "Erro a pasta dentro dela mesma é um ciclo")]
    public async Task Update_ShouldBeError_WhenTheFolderIsMovedIntoItself()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateFolder();
        var current = Document([target]);
        var folder = FolderFakers.Create(iD: target.ID, name: target.Name, parentID: target.ID, createdAt: target.CreatedAt);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(folder, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_CYCLE", result.Error.Type);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "Update")]
    [Fact(DisplayName = "Erro uma irmã com o nome foi gravada enquanto isso")]
    public async Task Update_ShouldBeError_WhenASiblingWithTheNameWasSavedMeanwhile()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateFolder(name: "Antiga");
        var sibling = VaultFakers.CreateFolder(name: "Nova");
        var current = Document([target, sibling]);
        var folder = FolderFakers.Create(iD: target.ID, name: "NOVA", createdAt: target.CreatedAt);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(folder, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_ALREADY_EXISTS", result.Error.Type);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "Update")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Update_ShouldBeError_IVaultService_SaveAsync_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateFolder();
        var folder = FolderFakers.Create(iD: target.ID, name: target.Name, createdAt: target.CreatedAt);
        var repository = CreateRepository(Document([target]), EVaultError.Locked);

        //Act
        var result = await repository.Update(folder, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "Delete")]
    [Fact(DisplayName = "OK tira só a pasta do documento")]
    public async Task Delete_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var keep = VaultFakers.CreateFolder();
        var target = VaultFakers.CreateFolder(parentID: keep.ID);
        var current = Document([keep, target]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Delete(target.ID, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal([keep], _saved!.Folders);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "Delete")]
    [Fact(DisplayName = "Erro a pasta já foi excluída")]
    public async Task Delete_ShouldBeError_WhenTheFolderIsNotThere()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var current = Document([VaultFakers.CreateFolder()]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Delete(Guid.CreateVersion7(), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>A corrida contra a criação de uma subpasta: ela entrou no documento depois da conferência do handler. RN-PASTA-004.</summary>
    [Trait("FolderRepository", "Delete")]
    [Fact(DisplayName = "Erro uma subpasta foi gravada enquanto isso")]
    public async Task Delete_ShouldBeError_WhenASubfolderWasSavedMeanwhile()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateFolder();
        var current = Document([target, VaultFakers.CreateFolder(parentID: target.ID)]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Delete(target.ID, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_EMPTY", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "Delete")]
    [Fact(DisplayName = "Erro uma conexão foi gravada na pasta enquanto isso")]
    public async Task Delete_ShouldBeError_WhenAConnectionWasSavedMeanwhile()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateFolder();
        var current = Document([target], [VaultFakers.CreateConnection(folderID: target.ID)]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Delete(target.ID, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_EMPTY", result.Error.Type);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "Delete")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Delete_ShouldBeError_IVaultService_SaveAsync_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateFolder();
        var repository = CreateRepository(Document([target]), EVaultError.Locked);

        //Act
        var result = await repository.Delete(target.ID, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("FolderRepository", "GetByID")]
    [Fact(DisplayName = "OK devolve a pasta como está gravada")]
    public async Task GetByID_ShouldBeOK()
    {
        //Arrange
        var parent = VaultFakers.CreateFolder();
        var record = VaultFakers.CreateFolder(parentID: parent.ID);
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(Document([parent, record])));
        var repository = new FolderRepository(_vault.Object);

        //Act
        var result = await repository.GetByID(record.ID, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(record.ID, result.Value.ID);
        Assert.Equal(record.ParentID, result.Value.ParentID);
        Assert.Equal(record.Name, result.Value.Name);
        Assert.Equal(record.CreatedAt, result.Value.CreatedAt);
        Assert.Equal(record.UpdatedAt, result.Value.UpdatedAt);
        _vault.Verify(v => v.Read(), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("FolderRepository", "GetByID")]
    [Fact(DisplayName = "Erro pasta não existe")]
    public async Task GetByID_ShouldBeError_WhenTheFolderIsNotThere()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(Document([VaultFakers.CreateFolder()])));
        var repository = new FolderRepository(_vault.Object);

        //Act
        var result = await repository.GetByID(Guid.CreateVersion7(), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _vault.Verify(v => v.Read(), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("FolderRepository", "GetByID")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task GetByID_ShouldBeError_IVaultService_Read_Locked()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));
        var repository = new FolderRepository(_vault.Object);

        //Act
        var result = await repository.GetByID(Guid.CreateVersion7(), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _vault.Verify(v => v.Read(), Times.Once);
        _vault.VerifyNoOtherCalls();
    }
}
