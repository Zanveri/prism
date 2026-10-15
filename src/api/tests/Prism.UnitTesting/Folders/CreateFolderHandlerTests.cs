using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Moq;
using Prism.Application.Common.Protections;
using Prism.Application.Common.Vault;
using Prism.Application.Folders.Domain;
using Prism.Application.Folders.Features.CreateFolder;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Queries;
using Prism.Application.Folders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Fakers.Folders;
using System.Net;

namespace Prism.UnitTesting.Folders;

public sealed class CreateFolderHandlerTests
{
    private readonly Mock<IFolderQueries> _folderQueries = new();
    private readonly Mock<IFolderRepository> _folderRepository = new();
    private readonly FakeTimeProvider _timeProvider = new(new DateTimeOffset(2026, 10, 9, 12, 0, 0, TimeSpan.Zero));

    [Trait("CreateFolderHandler", "CreateFolderCommand")]
    [Fact(DisplayName = "OK cria na raiz com o nome normalizado e a data do relógio")]
    public async Task Handle_ShouldBeOK_Root()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = FolderFakers.ReturnCreateFolderCommandValid(name: "  Produção   Sul ");
        Folder? inserted = null;
        _folderQueries.Setup(q => q.Exists("Produção Sul", null, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Insert(It.IsAny<Folder>(), cancellationToken)).Callback<Folder, CancellationToken>((folder, _) => inserted = folder).ReturnsAsync(Result.Success<EffectiveProtections, ApiErrorDto>(new EffectiveProtections(false, null, null, null)));
        var handler = new CreateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(inserted);
        Assert.Equal("Produção Sul", inserted.Name);
        Assert.Null(inserted.ParentID);
        Assert.Equal(_timeProvider.GetUtcNow().UtcDateTime, inserted.CreatedAt);
        Assert.Equal(inserted.CreatedAt, inserted.UpdatedAt);
        Assert.Equal(inserted.ID, result.Value.ID);
        Assert.Equal("Produção Sul", result.Value.Name);
        Assert.Null(result.Value.ParentID);
        Assert.Equal(inserted.CreatedAt, result.Value.CreatedAt);
        Assert.Equal(inserted.UpdatedAt, result.Value.UpdatedAt);
        _folderQueries.Verify(q => q.Exists("Produção Sul", null, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Insert(inserted, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>RN-PASTA-005: o ambiente vai normalizado ao cofre e volta na resposta.</summary>
    [Trait("CreateFolderHandler", "CreateFolderCommand")]
    [Fact(DisplayName = "OK cria com o ambiente normalizado")]
    public async Task Handle_ShouldBeOK_WithEnvironment()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = FolderFakers.ReturnCreateFolderCommandValid(name: "Produção", environmentName: "  Produção   Sul ", environmentColor: " #FF8A7A ");
        Folder? inserted = null;
        _folderQueries.Setup(q => q.Exists("Produção", null, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Insert(It.IsAny<Folder>(), cancellationToken)).Callback<Folder, CancellationToken>((folder, _) => inserted = folder).ReturnsAsync(Result.Success<EffectiveProtections, ApiErrorDto>(new EffectiveProtections(false, null, null, null)));
        var handler = new CreateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(inserted);
        Assert.Equal("Produção Sul", inserted.EnvironmentName);
        Assert.Equal("#FF8A7A", inserted.EnvironmentColor);
        Assert.Equal("Produção Sul", result.Value.EnvironmentName);
        Assert.Equal("#FF8A7A", result.Value.EnvironmentColor);
    }

    /// <summary>RN-PASTA-007: a cor da pasta vai aparada ao cofre e volta na resposta, à parte do ambiente.</summary>
    [Trait("CreateFolderHandler", "CreateFolderCommand")]
    [Fact(DisplayName = "OK cria com a cor da pasta aparada e sem ambiente")]
    public async Task Handle_ShouldBeOK_WithColor()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = FolderFakers.ReturnCreateFolderCommandValid(name: "Produção", color: " #7DB2FF ");
        Folder? inserted = null;
        _folderQueries.Setup(q => q.Exists("Produção", null, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Insert(It.IsAny<Folder>(), cancellationToken)).Callback<Folder, CancellationToken>((folder, _) => inserted = folder).ReturnsAsync(Result.Success<EffectiveProtections, ApiErrorDto>(new EffectiveProtections(false, null, null, null)));
        var handler = new CreateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(inserted);
        Assert.Equal("#7DB2FF", inserted.Color);
        Assert.Null(inserted.EnvironmentName);
        Assert.Equal("#7DB2FF", result.Value.Color);
        Assert.Null(result.Value.EnvironmentColor);
    }

    [Trait("CreateFolderHandler", "CreateFolderCommand")]
    [Fact(DisplayName = "OK cria dentro de uma pasta que existe")]
    public async Task Handle_ShouldBeOK_Child()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var parentID = Guid.CreateVersion7();
        var command = FolderFakers.ReturnCreateFolderCommandValid(parentID: parentID);
        _folderQueries.Setup(q => q.Exists(command.Name, parentID, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Insert(It.IsAny<Folder>(), cancellationToken)).ReturnsAsync(Result.Success<EffectiveProtections, ApiErrorDto>(new EffectiveProtections(false, null, null, null)));
        var handler = new CreateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(parentID, result.Value.ParentID);
        _folderQueries.Verify(q => q.Exists(command.Name, parentID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Insert(It.Is<Folder>(folder => folder.ParentID == parentID), cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>
    /// Uma pasta pai que não existe não tem irmãs: a conferência de nome segue, e é a gravação que diz que
    /// a pasta pai não está lá. O handler não a decide por `ExistsByID`, cujo `false` também é o que a
    /// consulta responde com o cofre fechado.
    /// </summary>
    [Trait("CreateFolderHandler", "CreateFolderCommand")]
    [Fact(DisplayName = "Erro pasta pai não existe, dito pela gravação")]
    public async Task Handle_ShouldBeError_FolderRepository_Insert_ParentNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var parentID = Guid.CreateVersion7();
        var command = FolderFakers.ReturnCreateFolderCommandValid(parentID: parentID);
        _folderQueries.Setup(q => q.Exists(command.Name, parentID, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Insert(It.IsAny<Folder>(), cancellationToken)).ReturnsAsync(Result.Failure<EffectiveProtections, ApiErrorDto>(FolderErrors.ParentNotFound(parentID)));
        var handler = new CreateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _folderQueries.Verify(q => q.Exists(command.Name, parentID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Insert(It.Is<Folder>(folder => folder.ParentID == parentID), cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>O cofre fechou entre a barreira e a conferência: ela respondeu "livre" por não ter lido nada, e a gravação recusa com 401, e não 404.</summary>
    [Trait("CreateFolderHandler", "CreateFolderCommand")]
    [Fact(DisplayName = "Erro cofre fechado, dito pela gravação")]
    public async Task Handle_ShouldBeError_FolderRepository_Insert_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var parentID = Guid.CreateVersion7();
        var command = FolderFakers.ReturnCreateFolderCommandValid(parentID: parentID);
        _folderQueries.Setup(q => q.Exists(command.Name, parentID, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Insert(It.IsAny<Folder>(), cancellationToken)).ReturnsAsync(Result.Failure<EffectiveProtections, ApiErrorDto>(VaultErrors.From(EVaultError.Locked)));
        var handler = new CreateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _folderQueries.Verify(q => q.Exists(command.Name, parentID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Insert(It.IsAny<Folder>(), cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    [Trait("CreateFolderHandler", "CreateFolderCommand")]
    [Fact(DisplayName = "Erro nome já existe entre as irmãs")]
    public async Task Handle_ShouldBeError_FolderQueries_Exists()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = FolderFakers.ReturnCreateFolderCommandValid(name: " Produção ");
        _folderQueries.Setup(q => q.Exists("Produção", null, cancellationToken)).ReturnsAsync(true);
        var handler = new CreateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_ALREADY_EXISTS", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _folderQueries.Verify(q => q.Exists("Produção", null, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Insert(It.IsAny<Folder>(), It.IsAny<CancellationToken>()), Times.Never);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>
    /// A corrida: a conferência passou (outra requisição ainda não tinha gravado) e a regra, dentro da
    /// gravação, recusou. O handler devolve a recusa do repository sem mudar nada.
    /// </summary>
    [Trait("CreateFolderHandler", "CreateFolderCommand")]
    [Fact(DisplayName = "Erro recusa do repository na gravação")]
    public async Task Handle_ShouldBeError_FolderRepository_Insert()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = FolderFakers.ReturnCreateFolderCommandValid();
        _folderQueries.Setup(q => q.Exists(command.Name, null, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Insert(It.IsAny<Folder>(), cancellationToken)).ReturnsAsync(Result.Failure<EffectiveProtections, ApiErrorDto>(FolderErrors.AlreadyExists(command.Name)));
        var handler = new CreateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_ALREADY_EXISTS", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _folderQueries.Verify(q => q.Exists(command.Name, null, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Insert(It.IsAny<Folder>(), cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }
}
