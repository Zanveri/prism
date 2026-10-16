using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.ScriptFolders.Domain;
using Prism.Application.ScriptFolders.Repositories;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.ScriptFolders;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.ScriptFolders;

/// <summary>
/// O que o repository entrega ao `SaveAsync` é uma função, e é ela que o serviço roda com o cofre reservado. Estes testes fazem o papel do serviço: rodam a
/// função contra um documento que já tem o que outra janela teria gravado, e conferem que cada regra da RN-SCRIPT-007 vale ali dentro: o nome único entre as
/// irmãs sem diferenciar maiúsculas, a pasta pai que existe, o ciclo e a pasta vazia (com o script que a outra janela acabou de pôr nela).
/// </summary>
public sealed class ScriptFolderRepositoryTests
{
    private static readonly DateTime Now = new(2026, 10, 16, 12, 0, 0, DateTimeKind.Utc);

    private readonly Mock<IVaultService> _vault = new();
    private VaultDocument? _saved;

    private static VaultDocument Document(IReadOnlyList<VaultScriptFolderRecord> folders, params VaultScriptRecord[] scripts)
        => new("marina.costa", [VaultFakers.CreateFolder()], [VaultFakers.CreateConnection()], scripts, VaultWorkspaceRecord.Empty, folders);

    private static VaultScriptFolderRecord ToRecord(ScriptFolder folder)
        => new(folder.ID, folder.ParentID, folder.Name, folder.CreatedAt, folder.UpdatedAt);

    /// <summary>Roda a função do `SaveAsync` contra o documento atual, como o serviço faz, e responde o que o teste mandou (sucesso por padrão).</summary>
    private ScriptFolderRepository CreateRepository(VaultDocument current, EVaultError? failure = null)
    {
        _vault.Setup(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()))
            .Returns((Func<VaultDocument, VaultDocument> change, CancellationToken _) =>
            {
                _saved = change(current);

                return Task.FromResult(failure is null ? UnitResult.Success<EVaultError>() : UnitResult.Failure(failure.Value));
            });

        return new ScriptFolderRepository(_vault.Object);
    }

    [Trait("ScriptFolderRepository", "Insert")]
    [Fact(DisplayName = "OK acrescenta a pasta ao documento sem mexer no resto")]
    public async Task Insert_ShouldBeOK()
    {
        //Arrange
        var existing = VaultFakers.CreateScriptFolder(name: "Relatórios");
        var current = Document([existing], VaultFakers.CreateScript());
        var folder = ScriptFolderFakers.Create(name: "Fechamento");
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Insert(folder, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(_saved);
        Assert.Equal([existing, ToRecord(folder)], _saved.ScriptFolders);
        Assert.Same(current.Folders, _saved.Folders);
        Assert.Same(current.Scripts, _saved.Scripts);
    }

    /// <summary>A unicidade é entre as irmãs: o mesmo nome noutra pasta, e o nome de um script no mesmo lugar, não são repetição.</summary>
    [Trait("ScriptFolderRepository", "Insert")]
    [Fact(DisplayName = "OK o mesmo nome noutra pasta e o nome de um script não são repetição")]
    public async Task Insert_SameNameElsewhereOrAsAScript_ShouldBeOK()
    {
        //Arrange
        var parent = VaultFakers.CreateScriptFolder(name: "Fechamento");
        var current = Document([parent, VaultFakers.CreateScriptFolder(name: "Mensal")], VaultFakers.CreateScript(name: "Mensal") with { FolderID = parent.ID });
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Insert(ScriptFolderFakers.Create(name: "Mensal", parentID: parent.ID), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(3, _saved!.ScriptFolders.Count);
    }

    [Trait("ScriptFolderRepository", "Insert")]
    [Fact(DisplayName = "Erro nome que uma irmã já tem, com outras maiúsculas, responde 409 com o lugar, e não grava")]
    public async Task Insert_NameTakenAmongSiblings_Returns409()
    {
        //Arrange
        var top = VaultFakers.CreateScriptFolder(name: "Fechamento");
        var middle = VaultFakers.CreateScriptFolder(name: "Mensal", parentID: top.ID);
        var current = Document([top, middle, VaultFakers.CreateScriptFolder(name: "Abril", parentID: middle.ID), VaultFakers.CreateScriptFolder(name: "Rascunhos")]);
        var repository = CreateRepository(current);

        //Act
        var inside = await repository.Insert(ScriptFolderFakers.Create(name: "abril", parentID: middle.ID), CancellationToken.None);
        var atRoot = await repository.Insert(ScriptFolderFakers.Create(name: "RASCUNHOS"), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.Conflict, inside.Error.StatusCode);
        Assert.Equal("SCRIPT_FOLDER_ALREADY_EXISTS", inside.Error.Type);
        Assert.Equal("Já existe uma pasta chamada abril em Fechamento / Mensal.", inside.Error.Detail);
        Assert.Equal("Já existe uma pasta chamada RASCUNHOS na raiz da seção Scripts.", atRoot.Error.Detail);
        Assert.Same(current, _saved);
    }

    [Trait("ScriptFolderRepository", "Insert")]
    [Fact(DisplayName = "Erro pasta pai que outra janela excluiu responde 404, e não grava")]
    public async Task Insert_ParentGone_Returns404()
    {
        //Arrange
        var current = Document([VaultFakers.CreateScriptFolder()]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Insert(ScriptFolderFakers.Create(parentID: Guid.CreateVersion7()), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.Equal("SCRIPT_FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Equal("A pasta pai não existe mais.", result.Error.Detail);
        Assert.Same(current, _saved);
    }

    [Trait("ScriptFolderRepository", "Insert")]
    [Fact(DisplayName = "Erro cofre fechado responde 401")]
    public async Task Insert_VaultLocked_Returns401()
    {
        //Arrange
        var repository = CreateRepository(Document([]), EVaultError.Locked);

        //Act
        var result = await repository.Insert(ScriptFolderFakers.Create(), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
    }

    [Trait("ScriptFolderRepository", "Update")]
    [Fact(DisplayName = "OK a alteração roda sobre o registro do documento mais recente e devolve a pasta alterada")]
    public async Task Update_ShouldBeOK()
    {
        //Arrange
        var destination = VaultFakers.CreateScriptFolder(name: "Fechamento");
        var target = VaultFakers.CreateScriptFolder(name: "Mensal");
        var current = Document([destination, target]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(target.ID, folder => folder.Change("Mensal 2026", destination.ID, Now), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(("Mensal 2026", destination.ID, target.CreatedAt, Now), (result.Value.Name, result.Value.ParentID, result.Value.CreatedAt, result.Value.UpdatedAt));
        Assert.Equal([destination, target with { Name = "Mensal 2026", ParentID = destination.ID, UpdatedAt = Now }], _saved!.ScriptFolders);
    }

    /// <summary>A pasta não colide com o nome dela mesma: mudar só as maiúsculas grava.</summary>
    [Trait("ScriptFolderRepository", "Update")]
    [Fact(DisplayName = "OK mudar só as maiúsculas do nome grava, sem colidir com a própria pasta")]
    public async Task Update_OnlyTheCase_ShouldBeOK()
    {
        //Arrange
        var target = VaultFakers.CreateScriptFolder(name: "fechamento");
        var repository = CreateRepository(Document([target]));

        //Act
        var result = await repository.Update(target.ID, folder => folder.Change("Fechamento", null, Now), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("Fechamento", Assert.Single(_saved!.ScriptFolders).Name);
    }

    [Trait("ScriptFolderRepository", "Update")]
    [Fact(DisplayName = "OK nada mudou devolve o mesmo documento, e o cofre não é regravado")]
    public async Task Update_NothingChanged_ReturnsTheSameDocument()
    {
        //Arrange
        var target = VaultFakers.CreateScriptFolder(name: "Fechamento");
        var current = Document([target]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(target.ID, folder => folder.Change(" Fechamento ", null, Now), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(target.UpdatedAt, result.Value.UpdatedAt);
        Assert.Same(current, _saved);
    }

    [Trait("ScriptFolderRepository", "Update")]
    [Fact(DisplayName = "Erro pasta que não existe responde 404")]
    public async Task Update_NotFound_Returns404()
    {
        //Arrange
        var current = Document([VaultFakers.CreateScriptFolder()]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(Guid.CreateVersion7(), folder => folder.Change("Fechamento", null, Now), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.Equal("SCRIPT_FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Same(current, _saved);
    }

    [Trait("ScriptFolderRepository", "Update")]
    [Fact(DisplayName = "Erro pasta de destino que outra janela excluiu responde 404, e não grava")]
    public async Task Update_DestinationGone_Returns404()
    {
        //Arrange
        var target = VaultFakers.CreateScriptFolder(name: "Mensal");
        var current = Document([target]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(target.ID, folder => folder.Change("Mensal", Guid.CreateVersion7(), Now), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.Equal("SCRIPT_FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Equal("A pasta de destino não existe mais.", result.Error.Detail);
        Assert.Same(current, _saved);
    }

    /// <summary>O ciclo: para dentro dela mesma, e para dentro de uma neta, que outra janela pode ter posto lá depois da leitura da tela.</summary>
    [Trait("ScriptFolderRepository", "Update")]
    [Fact(DisplayName = "Erro mover a pasta para dentro dela mesma ou de uma descendente responde 409, e não grava")]
    public async Task Update_Cycle_Returns409()
    {
        //Arrange
        var top = VaultFakers.CreateScriptFolder(name: "Fechamento");
        var child = VaultFakers.CreateScriptFolder(name: "Mensal", parentID: top.ID);
        var grandchild = VaultFakers.CreateScriptFolder(name: "Abril", parentID: child.ID);
        var current = Document([top, child, grandchild]);
        var repository = CreateRepository(current);

        //Act
        var self = await repository.Update(top.ID, folder => folder.Change("Fechamento", top.ID, Now), CancellationToken.None);
        var descendant = await repository.Update(top.ID, folder => folder.Change("Fechamento", grandchild.ID, Now), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.Conflict, self.Error.StatusCode);
        Assert.Equal("SCRIPT_FOLDER_CYCLE", self.Error.Type);
        Assert.Equal("Uma pasta não pode ir para dentro dela mesma nem de uma subpasta dela.", self.Error.Detail);
        Assert.Equal("SCRIPT_FOLDER_CYCLE", descendant.Error.Type);
        Assert.Same(current, _saved);
    }

    [Trait("ScriptFolderRepository", "Update")]
    [Fact(DisplayName = "Erro mover para onde uma irmã já tem o nome responde 409 com o destino, e não grava")]
    public async Task Update_NameTakenAtTheDestination_Returns409()
    {
        //Arrange
        var destination = VaultFakers.CreateScriptFolder(name: "Fechamento");
        var current = Document([destination, VaultFakers.CreateScriptFolder(name: "MENSAL", parentID: destination.ID)]);
        var target = VaultFakers.CreateScriptFolder(name: "Mensal");
        current = current with { ScriptFolders = [.. current.ScriptFolders, target] };
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(target.ID, folder => folder.Change("Mensal", destination.ID, Now), CancellationToken.None);

        //Assert
        Assert.Equal("SCRIPT_FOLDER_ALREADY_EXISTS", result.Error.Type);
        Assert.Equal("Já existe uma pasta chamada Mensal em Fechamento.", result.Error.Detail);
        Assert.Same(current, _saved);
    }

    [Trait("ScriptFolderRepository", "Delete")]
    [Fact(DisplayName = "OK a pasta vazia sai do documento, e o resto fica")]
    public async Task Delete_ShouldBeOK()
    {
        //Arrange
        var other = VaultFakers.CreateScriptFolder(name: "Rascunhos");
        var target = VaultFakers.CreateScriptFolder(name: "Fechamento");
        var current = Document([other, target], VaultFakers.CreateScript() with { FolderID = other.ID });
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Delete(target.ID, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal([other], _saved!.ScriptFolders);
        Assert.Same(current.Scripts, _saved.Scripts);
    }

    [Trait("ScriptFolderRepository", "Delete")]
    [Fact(DisplayName = "Erro pasta que não existe responde 404")]
    public async Task Delete_NotFound_Returns404()
    {
        //Arrange
        var current = Document([VaultFakers.CreateScriptFolder()]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Delete(Guid.CreateVersion7(), CancellationToken.None);

        //Assert
        Assert.Equal("SCRIPT_FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Same(current, _saved);
    }

    /// <summary>O script que outra janela pôs na pasta depois da leitura da tela também impede a exclusão, e a recusa diz quanto há dentro.</summary>
    [Trait("ScriptFolderRepository", "Delete")]
    [Fact(DisplayName = "Erro pasta com subpastas e scripts responde 409 com as contagens, e não grava")]
    public async Task Delete_NotEmpty_Returns409WithTheCounts()
    {
        //Arrange
        var target = VaultFakers.CreateScriptFolder(name: "Fechamento");
        var withScript = VaultFakers.CreateScriptFolder(name: "Mensal");
        var current = Document([target, withScript, VaultFakers.CreateScriptFolder(parentID: target.ID), VaultFakers.CreateScriptFolder(parentID: target.ID)],
            VaultFakers.CreateScript() with { FolderID = target.ID }, VaultFakers.CreateScript() with { FolderID = target.ID }, VaultFakers.CreateScript() with { FolderID = target.ID }, VaultFakers.CreateScript() with { FolderID = withScript.ID });
        var repository = CreateRepository(current);

        //Act
        var both = await repository.Delete(target.ID, CancellationToken.None);
        var oneScript = await repository.Delete(withScript.ID, CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.Conflict, both.Error.StatusCode);
        Assert.Equal("SCRIPT_FOLDER_NOT_EMPTY", both.Error.Type);
        Assert.Equal((2, 3), ((int)both.Error.Extensions["folders"]!, (int)both.Error.Extensions["scripts"]!));
        Assert.Equal("A pasta Fechamento tem 2 subpastas e 3 scripts. Só uma pasta vazia pode ser excluída: mova ou exclua antes o que está dentro dela.", both.Error.Detail);
        Assert.Equal((0, 1), ((int)oneScript.Error.Extensions["folders"]!, (int)oneScript.Error.Extensions["scripts"]!));
        Assert.Equal("A pasta Mensal tem 1 script. Só uma pasta vazia pode ser excluída: mova ou exclua antes o que está dentro dela.", oneScript.Error.Detail);
        Assert.Same(current, _saved);
    }

    [Trait("ScriptFolderRepository", "Delete")]
    [Fact(DisplayName = "Erro cofre fechado responde 401")]
    public async Task Delete_VaultLocked_Returns401()
    {
        //Arrange
        var target = VaultFakers.CreateScriptFolder();
        var repository = CreateRepository(Document([target]), EVaultError.Locked);

        //Act
        var result = await repository.Delete(target.ID, CancellationToken.None);

        //Assert
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
    }
}
