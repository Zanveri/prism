using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Common.Vault;
using Prism.Application.Folders.Features.DeleteFolder;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Queries;
using Prism.Application.Folders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using System.Net;

namespace Prism.UnitTesting.Folders;

/// <summary>
/// O handler não decide "pasta não existe" por uma consulta: a consulta devolve `bool`, e um `false` dela
/// não distingue pasta inexistente de cofre fechado. Quem responde 404 (ou 401) é a gravação do repository.
/// </summary>
public sealed class DeleteFolderHandlerTests
{
    private readonly Mock<IFolderQueries> _folderQueries = new();
    private readonly Mock<IFolderRepository> _folderRepository = new();

    [Trait("DeleteFolderHandler", "DeleteFolderCommand")]
    [Fact(DisplayName = "OK exclui a pasta vazia")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var iD = Guid.CreateVersion7();
        _folderQueries.Setup(q => q.HasChildren(iD, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Delete(iD, cancellationToken)).ReturnsAsync(UnitResult.Success<ApiErrorDto>());
        var handler = new DeleteFolderHandler(_folderQueries.Object, _folderRepository.Object);

        //Act
        var result = await handler.Handle(new DeleteFolderCommand(iD), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        _folderQueries.Verify(q => q.HasChildren(iD, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Delete(iD, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>RN-PASTA-004: subpastas e conexões contam do mesmo jeito; a consulta junta as duas.</summary>
    [Trait("DeleteFolderHandler", "DeleteFolderCommand")]
    [Fact(DisplayName = "Erro pasta com subpastas ou conexões")]
    public async Task Handle_ShouldBeError_FolderQueries_HasChildren()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var iD = Guid.CreateVersion7();
        _folderQueries.Setup(q => q.HasChildren(iD, cancellationToken)).ReturnsAsync(true);
        var handler = new DeleteFolderHandler(_folderQueries.Object, _folderRepository.Object);

        //Act
        var result = await handler.Handle(new DeleteFolderCommand(iD), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_EMPTY", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _folderQueries.Verify(q => q.HasChildren(iD, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Delete(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>Uma pasta que não existe não tem filhos: a conferência segue, e é a gravação que diz que a pasta não está lá.</summary>
    [Trait("DeleteFolderHandler", "DeleteFolderCommand")]
    [Fact(DisplayName = "Erro pasta não existe, dito pela gravação")]
    public async Task Handle_ShouldBeError_FolderRepository_Delete_NotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var iD = Guid.CreateVersion7();
        _folderQueries.Setup(q => q.HasChildren(iD, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Delete(iD, cancellationToken)).ReturnsAsync(UnitResult.Failure(FolderErrors.NotFound(iD)));
        var handler = new DeleteFolderHandler(_folderQueries.Object, _folderRepository.Object);

        //Act
        var result = await handler.Handle(new DeleteFolderCommand(iD), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _folderQueries.Verify(q => q.HasChildren(iD, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Delete(iD, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>O cofre fechou no meio da requisição: a consulta respondeu "sem filhos" por não ter lido nada, e quem recusa é a gravação, com 401, e não 404.</summary>
    [Trait("DeleteFolderHandler", "DeleteFolderCommand")]
    [Fact(DisplayName = "Erro cofre fechado, dito pela gravação")]
    public async Task Handle_ShouldBeError_FolderRepository_Delete_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var iD = Guid.CreateVersion7();
        _folderQueries.Setup(q => q.HasChildren(iD, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Delete(iD, cancellationToken)).ReturnsAsync(UnitResult.Failure(VaultErrors.From(EVaultError.Locked)));
        var handler = new DeleteFolderHandler(_folderQueries.Object, _folderRepository.Object);

        //Act
        var result = await handler.Handle(new DeleteFolderCommand(iD), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _folderQueries.Verify(q => q.HasChildren(iD, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Delete(iD, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    [Trait("DeleteFolderHandler", "DeleteFolderCommand")]
    [Fact(DisplayName = "Erro recusa do repository na gravação")]
    public async Task Handle_ShouldBeError_FolderRepository_Delete()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var iD = Guid.CreateVersion7();
        _folderQueries.Setup(q => q.HasChildren(iD, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Delete(iD, cancellationToken)).ReturnsAsync(UnitResult.Failure(FolderErrors.NotEmpty()));
        var handler = new DeleteFolderHandler(_folderQueries.Object, _folderRepository.Object);

        //Act
        var result = await handler.Handle(new DeleteFolderCommand(iD), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_EMPTY", result.Error.Type);
        _folderQueries.Verify(q => q.HasChildren(iD, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Delete(iD, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }
}
