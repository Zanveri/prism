using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Folders.Features.GetFolders;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Folders;

public sealed class GetFoldersHandlerTests
{
    private readonly Mock<IVaultService> _vault = new();

    [Trait("GetFoldersHandler", "GetFoldersCommand")]
    [Fact(DisplayName = "OK devolve todas as pastas, ordenadas pelo nome sem diferenciar maiúsculas")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var beta = VaultFakers.CreateFolder(name: "beta");
        var alfa = VaultFakers.CreateFolder(name: "Alfa");
        var delta = VaultFakers.CreateFolder(parentID: beta.ID, name: "Delta");
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", [beta, delta, alfa], [], [], VaultWorkspaceRecord.Empty)));
        var handler = new GetFoldersHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetFoldersCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(["Alfa", "beta", "Delta"], result.Value.Select(folder => folder.Name));
        var mapped = result.Value.Single(folder => folder.ID == delta.ID);
        Assert.Equal(beta.ID, mapped.ParentID);
        Assert.Equal(delta.CreatedAt, mapped.CreatedAt);
        Assert.Equal(delta.UpdatedAt, mapped.UpdatedAt);
        _vault.Verify(v => v.Read(), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("GetFoldersHandler", "GetFoldersCommand")]
    [Fact(DisplayName = "OK cofre sem pastas devolve a lista vazia")]
    public async Task Handle_ShouldBeOK_Empty()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", [], [], [], VaultWorkspaceRecord.Empty)));
        var handler = new GetFoldersHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetFoldersCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value);
        _vault.Verify(v => v.Read(), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    /// <summary>
    /// Uma lista vazia seria a resposta errada para o cofre fechado: a tela mostraria uma árvore sem
    /// pastas em vez de voltar ao login. A barreira de `api/user` já cobre o caminho normal; isto cobre
    /// o cofre que fechou no meio da requisição, ou um caminho que a barreira não reconheceu.
    /// </summary>
    [Trait("GetFoldersHandler", "GetFoldersCommand")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Handle_ShouldBeError_IVaultService_Read_Locked()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));
        var handler = new GetFoldersHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetFoldersCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _vault.Verify(v => v.Read(), Times.Once);
        _vault.VerifyNoOtherCalls();
    }
}
