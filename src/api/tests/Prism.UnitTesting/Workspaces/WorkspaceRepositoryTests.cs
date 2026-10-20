using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Workspaces.Domain;
using Prism.Application.Workspaces.Repositories;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Workspaces;

/// <summary>
/// O repository entrega ao `SaveAsync` uma função, que o serviço roda com o cofre reservado, sobre o documento mais recente. Estes testes fazem o papel do
/// serviço: a área de trabalho gravada troca a anterior inteira (RN-ABAS-006: fechar uma aba a tira do que volta), sem mexer no resto do cofre, e a mesma
/// área de trabalho de novo (a tela grava a cada mudança e antes de o cofre fechar) é "nada a gravar": a mesma instância do documento, e o serviço não regrava.
/// </summary>
public sealed class WorkspaceRepositoryTests
{
    private readonly Mock<IVaultService> _vault = new();
    private VaultDocument? _saved;

    private static VaultDocument Document(VaultWorkspaceRecord workspace)
        => new("marina.costa", [VaultFakers.CreateFolder()], [VaultFakers.CreateConnection()], [VaultFakers.CreateScript()], workspace, []);

    private WorkspaceRepository CreateRepository(VaultDocument current, EVaultError? failure = null)
    {
        _vault.Setup(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()))
            .Returns((Func<VaultDocument, VaultDocument> change, CancellationToken _) =>
            {
                _saved = change(current);

                return Task.FromResult(failure is null ? UnitResult.Success<EVaultError>() : UnitResult.Failure(failure.Value));
            });

        return new WorkspaceRepository(_vault.Object);
    }

    [Trait("WorkspaceRepository", "Replace")]
    [Fact(DisplayName = "OK a área de trabalho gravada troca a anterior inteira, sem mexer no resto do cofre")]
    public async Task Replace_ShouldBeOK()
    {
        //Arrange
        var current = Document(VaultFakers.CreateWorkspace(0, VaultFakers.CreateQueryTab(sql: "SELECT 'antes'"), VaultFakers.CreateTableTab()));
        var connectionID = Guid.CreateVersion7();
        var scriptID = Guid.CreateVersion7();
        var workspace = Workspace.Create([WorkspaceTab.CreateTable(connectionID, "vendas", "loja", "pedidos", "diagram"), WorkspaceTab.CreateQuery(connectionID, null, "SELECT 'depois'", scriptID, dirty: true, sqlTooLarge: false), WorkspaceTab.CreateQuery(null, null, "", null, dirty: false, sqlTooLarge: true)], 1);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Replace(workspace, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(_saved);
        Assert.Equal(1, _saved.Workspace.ActiveIndex);
        Assert.Equal(
        [
            new VaultWorkspaceTabRecord("table", connectionID, "vendas", null, null, false, false, "loja", "pedidos", "diagram"),
            new VaultWorkspaceTabRecord("query", connectionID, null, "SELECT 'depois'", scriptID, true, false, null, null, null),
            new VaultWorkspaceTabRecord("query", null, null, "", null, false, true, null, null, null),
        ], _saved.Workspace.Tabs);
        Assert.Same(current.Folders, _saved.Folders);
        Assert.Same(current.Connections, _saved.Connections);
        Assert.Same(current.Scripts, _saved.Scripts);
    }

    [Trait("WorkspaceRepository", "Replace")]
    [Fact(DisplayName = "OK a área de trabalho vazia apaga a gravada (a última aba fechou)")]
    public async Task Replace_WithAnEmptyWorkspace_ClearsTheSavedOne()
    {
        //Arrange
        var current = Document(VaultFakers.CreateWorkspace(0, VaultFakers.CreateQueryTab()));
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Replace(Workspace.Create([], null), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Empty(_saved!.Workspace.Tabs);
        Assert.Null(_saved.Workspace.ActiveIndex);
    }

    [Trait("WorkspaceRepository", "Replace")]
    [Fact(DisplayName = "OK a mesma área de trabalho de novo não regrava: a função devolve o mesmo documento")]
    public async Task Replace_WithTheSameWorkspace_ReturnsTheSameDocument()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        var current = Document(VaultFakers.CreateWorkspace(1, VaultFakers.CreateQueryTab(connectionID: connectionID, database: "vendas", sql: "SELECT 1"), VaultFakers.CreateTableTab(connectionID: connectionID, view: "structure")));
        var same = Workspace.Create([WorkspaceTab.CreateQuery(connectionID, "vendas", "SELECT 1", null, dirty: false, sqlTooLarge: false), WorkspaceTab.CreateTable(connectionID, null, "loja", "clientes", "structure")], 1);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Replace(same, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Same(current, _saved);
    }

    [Trait("WorkspaceRepository", "Replace")]
    [Fact(DisplayName = "OK só a aba ativa mudou: grava")]
    public async Task Replace_WhenOnlyTheActiveTabChanged_Saves()
    {
        //Arrange
        var current = Document(VaultFakers.CreateWorkspace(0, VaultFakers.CreateQueryTab(sql: "SELECT 1"), VaultFakers.CreateQueryTab(sql: "SELECT 2")));
        var changed = Workspace.Create([WorkspaceTab.CreateQuery(null, null, "SELECT 1", null, dirty: false, sqlTooLarge: false), WorkspaceTab.CreateQuery(null, null, "SELECT 2", null, dirty: false, sqlTooLarge: false)], 1);
        var repository = CreateRepository(current);

        //Act
        await repository.Replace(changed, CancellationToken.None);

        //Assert
        Assert.NotSame(current, _saved);
        Assert.Equal(1, _saved!.Workspace.ActiveIndex);
    }

    [Trait("WorkspaceRepository", "Replace")]
    [Theory(DisplayName = "Erro cofre fechado ou disco que falha respondem o erro do cofre")]
    [InlineData(EVaultError.Locked, HttpStatusCode.Unauthorized, "VAULT_LOCKED")]
    [InlineData(EVaultError.Unavailable, HttpStatusCode.ServiceUnavailable, "VAULT_UNAVAILABLE")]
    public async Task Replace_WhenTheVaultRefuses_ReturnsTheVaultError(EVaultError failure, HttpStatusCode status, string type)
    {
        //Arrange
        var repository = CreateRepository(Document(VaultWorkspaceRecord.Empty), failure);

        //Act
        var result = await repository.Replace(Workspace.Create([WorkspaceTab.CreateQuery(null, null, "SELECT 1", null, dirty: false, sqlTooLarge: false)], 0), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(status, result.Error.StatusCode);
        Assert.Equal(type, result.Error.Type);
    }
}
