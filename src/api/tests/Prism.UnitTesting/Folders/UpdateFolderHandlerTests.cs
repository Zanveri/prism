using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Moq;
using Prism.Application.Common.Protections;
using Prism.Application.Common.Vault;
using Prism.Application.Folders.Domain;
using Prism.Application.Folders.Features.UpdateFolder;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Queries;
using Prism.Application.Folders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Fakers.Folders;
using System.Net;

namespace Prism.UnitTesting.Folders;

public sealed class UpdateFolderHandlerTests
{
    private static readonly DateTime CreatedAt = new(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc);

    private readonly Mock<IFolderQueries> _folderQueries = new();
    private readonly Mock<IFolderRepository> _folderRepository = new();
    private readonly FakeTimeProvider _timeProvider = new(new DateTimeOffset(2026, 10, 9, 12, 0, 0, TimeSpan.Zero));

    /// <summary>As proteções que valem para uma pasta sem nenhuma, a dela e as das pastas acima (RN-PROT-004).</summary>
    private static readonly EffectiveProtections NoProtections = new(false, null, null, null);

    private void SetupGetByID(Folder folder, CancellationToken cancellationToken, EffectiveProtections? protections = null)
        => _folderRepository.Setup(r => r.GetByID(folder.ID, cancellationToken)).ReturnsAsync(Result.Success<(Folder, EffectiveProtections), ApiErrorDto>((folder, protections ?? NoProtections)));

    private void SetupUpdateOK(CancellationToken cancellationToken, EffectiveProtections? protections = null)
        => _folderRepository.Setup(r => r.Update(It.IsAny<Folder>(), It.IsAny<string?>(), cancellationToken)).ReturnsAsync(Result.Success<EffectiveProtections, ApiErrorDto>(protections ?? NoProtections));

    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK renomeia e muda de pasta, carimbando UpdatedAt com o relógio")]
    public async Task Handle_ShouldBeOK_RenameAndMove()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var oldParentID = Guid.CreateVersion7();
        var newParentID = Guid.CreateVersion7();
        var folder = FolderFakers.Create(parentID: oldParentID, name: "Antiga", createdAt: CreatedAt);
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, name: "  Nova   pasta ", parentID: newParentID);
        SetupGetByID(folder, cancellationToken);
        _folderQueries.Setup(q => q.IsSelfOrDescendant(newParentID, folder.ID, cancellationToken)).ReturnsAsync(false);
        _folderQueries.Setup(q => q.Exists("Nova pasta", newParentID, cancellationToken)).ReturnsAsync(false);
        SetupUpdateOK(cancellationToken);
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(folder.ID, result.Value.ID);
        Assert.Equal("Nova pasta", result.Value.Name);
        Assert.Equal(newParentID, result.Value.ParentID);
        Assert.Equal(CreatedAt, result.Value.CreatedAt);
        Assert.Equal(_timeProvider.GetUtcNow().UtcDateTime, result.Value.UpdatedAt);
        _folderRepository.Verify(r => r.GetByID(folder.ID, cancellationToken), Times.Once);
        _folderQueries.Verify(q => q.IsSelfOrDescendant(newParentID, folder.ID, cancellationToken), Times.Once);
        _folderQueries.Verify(q => q.Exists("Nova pasta", newParentID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Update(It.Is<Folder>(updated => updated.ID == folder.ID && updated.Name == "Nova pasta" && updated.ParentID == newParentID), null, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>Salvar sem editar não muda nada: a pasta volta como estava, sem conferência, sem carimbo e sem regravar o cofre.</summary>
    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK nada mudou e nada é gravado")]
    public async Task Handle_ShouldBeOK_WhenNothingChanged()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var parentID = Guid.CreateVersion7();
        var updatedAt = CreatedAt.AddDays(1);
        var folder = FolderFakers.Create(parentID: parentID, name: "Produção Sul", createdAt: CreatedAt, updatedAt: updatedAt);
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, name: "  Produção   Sul ", parentID: parentID);
        SetupGetByID(folder, cancellationToken);
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("Produção Sul", result.Value.Name);
        Assert.Equal(updatedAt, result.Value.UpdatedAt);
        _folderRepository.Verify(r => r.GetByID(folder.ID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Update(It.IsAny<Folder>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>RN-PASTA-005: o ambiente igual depois de normalizado também é "nada mudou".</summary>
    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK o mesmo ambiente, com espaços sobrando, não é mudança e nada é gravado")]
    public async Task Handle_ShouldBeOK_WhenTheEnvironmentDidNotChange()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var updatedAt = CreatedAt.AddDays(1);
        var folder = FolderFakers.Create(name: "Produção", createdAt: CreatedAt, updatedAt: updatedAt, environmentName: "Produção Sul", environmentColor: "#FF8A7A");
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, name: "Produção", environmentName: " Produção  Sul", environmentColor: "#FF8A7A ");
        SetupGetByID(folder, cancellationToken);
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("Produção Sul", result.Value.EnvironmentName);
        Assert.Equal(updatedAt, result.Value.UpdatedAt);
        _folderRepository.Verify(r => r.GetByID(folder.ID, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>RN-PASTA-005: só o ambiente muda. Grava e carimba, sem conferir nome nem ciclo, porque a chave da pasta é a mesma.</summary>
    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK só o ambiente muda: grava sem conferir duplicidade nem ciclo")]
    public async Task Handle_ShouldBeOK_WhenOnlyTheEnvironmentChanged()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var parentID = Guid.CreateVersion7();
        var folder = FolderFakers.Create(parentID: parentID, name: "Produção", createdAt: CreatedAt);
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, name: "Produção", parentID: parentID, environmentName: "Produção", environmentColor: "#FF8A7A");
        SetupGetByID(folder, cancellationToken);
        SetupUpdateOK(cancellationToken);
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("Produção", result.Value.EnvironmentName);
        Assert.Equal("#FF8A7A", result.Value.EnvironmentColor);
        Assert.Equal(_timeProvider.GetUtcNow().UtcDateTime, result.Value.UpdatedAt);
        _folderRepository.Verify(r => r.GetByID(folder.ID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Update(It.Is<Folder>(updated => updated.ID == folder.ID && updated.EnvironmentName == "Produção" && updated.EnvironmentColor == "#FF8A7A"), null, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>O `PATCH` grava a pasta por inteiro, como o da conexão: sem ambiente no corpo, a pasta fica sem ambiente. Quem só move ou renomeia manda o que ela já tem.</summary>
    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK sem ambiente no corpo a pasta fica sem ambiente")]
    public async Task Handle_ShouldRemoveTheEnvironment_WhenTheBodyHasNone()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var folder = FolderFakers.Create(name: "Produção", createdAt: CreatedAt, environmentName: "Produção", environmentColor: "#FF8A7A");
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, name: "Produção");
        SetupGetByID(folder, cancellationToken);
        SetupUpdateOK(cancellationToken);
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Null(result.Value.EnvironmentName);
        Assert.Null(result.Value.EnvironmentColor);
        _folderRepository.Verify(r => r.Update(It.Is<Folder>(updated => updated.EnvironmentName == null && updated.EnvironmentColor == null), null, cancellationToken), Times.Once);
    }

    /// <summary>RN-PASTA-007: só a cor da pasta muda. Grava e carimba, sem conferir nome nem ciclo, e o ambiente fica como estava.</summary>
    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK só a cor muda: grava sem conferir duplicidade nem ciclo, e o ambiente fica")]
    public async Task Handle_ShouldBeOK_WhenOnlyTheColorChanged()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var parentID = Guid.CreateVersion7();
        var folder = FolderFakers.Create(parentID: parentID, name: "Produção", createdAt: CreatedAt, environmentName: "Produção", environmentColor: "#FF8A7A");
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, name: "Produção", parentID: parentID, environmentName: "Produção", environmentColor: "#FF8A7A", color: "#7DB2FF");
        SetupGetByID(folder, cancellationToken);
        SetupUpdateOK(cancellationToken);
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("#7DB2FF", result.Value.Color);
        Assert.Equal("Produção", result.Value.EnvironmentName);
        Assert.Equal(_timeProvider.GetUtcNow().UtcDateTime, result.Value.UpdatedAt);
        _folderRepository.Verify(r => r.GetByID(folder.ID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Update(It.Is<Folder>(updated => updated.ID == folder.ID && updated.Color == "#7DB2FF" && updated.EnvironmentColor == "#FF8A7A"), null, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>RN-PASTA-007: a mesma cor, com espaços sobrando, é "nada mudou"; e o corpo sem cor (o `PATCH` grava a pasta por inteiro) a tira.</summary>
    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK a mesma cor não regrava, e sem cor no corpo a pasta fica sem cor")]
    public async Task Handle_ShouldKeepOrRemoveTheColor()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var updatedAt = CreatedAt.AddDays(1);
        var same = FolderFakers.Create(name: "Produção", createdAt: CreatedAt, updatedAt: updatedAt, color: "#7DB2FF");
        var removed = FolderFakers.Create(name: "Geral", createdAt: CreatedAt, color: "#7DB2FF");
        SetupGetByID(same, cancellationToken);
        SetupGetByID(removed, cancellationToken);
        SetupUpdateOK(cancellationToken);
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var unchanged = await handler.Handle(FolderFakers.ReturnUpdateFolderCommandValid(iD: same.ID, name: "Produção", color: " #7DB2FF"), cancellationToken);
        var cleared = await handler.Handle(FolderFakers.ReturnUpdateFolderCommandValid(iD: removed.ID, name: "Geral"), cancellationToken);

        //Assert
        Assert.True(unchanged.IsSuccess);
        Assert.Equal(updatedAt, unchanged.Value.UpdatedAt);
        Assert.True(cleared.IsSuccess);
        Assert.Null(cleared.Value.Color);
        _folderRepository.Verify(r => r.Update(It.Is<Folder>(updated => updated.ID == same.ID), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
        _folderRepository.Verify(r => r.Update(It.Is<Folder>(updated => updated.ID == removed.ID && updated.Color == null), null, cancellationToken), Times.Once);
    }

    /// <summary>Só a caixa da letra muda: grava, mas não é duplicidade, porque a pasta não colide com ela mesma. RN-PASTA-002.</summary>
    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK só a caixa do nome muda e nada é conferido")]
    public async Task Handle_ShouldBeOK_WhenKeyDidNotChange()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var parentID = Guid.CreateVersion7();
        var folder = FolderFakers.Create(parentID: parentID, name: "Produção", createdAt: CreatedAt);
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, name: "  PRODUÇÃO ", parentID: parentID);
        SetupGetByID(folder, cancellationToken);
        SetupUpdateOK(cancellationToken);
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("PRODUÇÃO", result.Value.Name);
        Assert.Equal(parentID, result.Value.ParentID);
        _folderRepository.Verify(r => r.GetByID(folder.ID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Update(It.IsAny<Folder>(), null, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK só renomeia e confere a duplicidade sem tocar na pasta pai")]
    public async Task Handle_ShouldBeOK_RenameOnly()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var parentID = Guid.CreateVersion7();
        var folder = FolderFakers.Create(parentID: parentID, name: "Antiga", createdAt: CreatedAt);
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, name: "Nova", parentID: parentID);
        SetupGetByID(folder, cancellationToken);
        _folderQueries.Setup(q => q.Exists("Nova", parentID, cancellationToken)).ReturnsAsync(false);
        SetupUpdateOK(cancellationToken);
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("Nova", result.Value.Name);
        _folderQueries.Verify(q => q.Exists("Nova", parentID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Update(It.IsAny<Folder>(), null, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.GetByID(folder.ID, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>Mover para a raiz (`parentID` nulo) não tem pasta pai a conferir nem ciclo possível; o nome continua valendo entre as irmãs da raiz.</summary>
    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK move para a raiz")]
    public async Task Handle_ShouldBeOK_MoveToRoot()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var folder = FolderFakers.Create(parentID: Guid.CreateVersion7(), name: "Linha 1", createdAt: CreatedAt);
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, name: "Linha 1", parentID: null);
        SetupGetByID(folder, cancellationToken);
        _folderQueries.Setup(q => q.Exists("Linha 1", null, cancellationToken)).ReturnsAsync(false);
        SetupUpdateOK(cancellationToken);
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Null(result.Value.ParentID);
        _folderQueries.Verify(q => q.Exists("Linha 1", null, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Update(It.Is<Folder>(updated => updated.ParentID == null), null, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.GetByID(folder.ID, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "Erro pasta não existe")]
    public async Task Handle_ShouldBeError_FolderRepository_GetByID()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = FolderFakers.ReturnUpdateFolderCommandValid();
        _folderRepository.Setup(r => r.GetByID(command.ID, cancellationToken)).ReturnsAsync(Result.Failure<(Folder, EffectiveProtections), ApiErrorDto>(FolderErrors.NotFound(command.ID)));
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _folderRepository.Verify(r => r.GetByID(command.ID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Update(It.IsAny<Folder>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>
    /// Uma pasta pai que não existe não é ancestral nem duplicidade para as consultas: elas seguem, e é a
    /// gravação que diz que a pasta pai não está lá. O handler não a decide por `ExistsByID`, cujo `false`
    /// também é o que a consulta responde com o cofre fechado.
    /// </summary>
    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "Erro nova pasta pai não existe, dito pela gravação")]
    public async Task Handle_ShouldBeError_FolderRepository_Update_ParentNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var newParentID = Guid.CreateVersion7();
        var folder = FolderFakers.Create(name: "Produção", createdAt: CreatedAt);
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, name: "Produção", parentID: newParentID);
        SetupGetByID(folder, cancellationToken);
        _folderQueries.Setup(q => q.IsSelfOrDescendant(newParentID, folder.ID, cancellationToken)).ReturnsAsync(false);
        _folderQueries.Setup(q => q.Exists("Produção", newParentID, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Update(It.IsAny<Folder>(), null, cancellationToken)).ReturnsAsync(Result.Failure<EffectiveProtections, ApiErrorDto>(FolderErrors.ParentNotFound(newParentID)));
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _folderRepository.Verify(r => r.GetByID(folder.ID, cancellationToken), Times.Once);
        _folderQueries.Verify(q => q.IsSelfOrDescendant(newParentID, folder.ID, cancellationToken), Times.Once);
        _folderQueries.Verify(q => q.Exists("Produção", newParentID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Update(It.IsAny<Folder>(), null, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>O cofre fechou entre o carregamento da pasta e as consultas: elas respondem "não" por não terem lido nada, e a gravação recusa com 401, e não 404.</summary>
    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "Erro cofre fechado, dito pela gravação")]
    public async Task Handle_ShouldBeError_FolderRepository_Update_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var newParentID = Guid.CreateVersion7();
        var folder = FolderFakers.Create(name: "Produção", createdAt: CreatedAt);
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, name: "Produção", parentID: newParentID);
        SetupGetByID(folder, cancellationToken);
        _folderQueries.Setup(q => q.IsSelfOrDescendant(newParentID, folder.ID, cancellationToken)).ReturnsAsync(false);
        _folderQueries.Setup(q => q.Exists("Produção", newParentID, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Update(It.IsAny<Folder>(), null, cancellationToken)).ReturnsAsync(Result.Failure<EffectiveProtections, ApiErrorDto>(VaultErrors.From(EVaultError.Locked)));
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _folderRepository.Verify(r => r.GetByID(folder.ID, cancellationToken), Times.Once);
        _folderQueries.Verify(q => q.IsSelfOrDescendant(newParentID, folder.ID, cancellationToken), Times.Once);
        _folderQueries.Verify(q => q.Exists("Produção", newParentID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Update(It.IsAny<Folder>(), null, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>RN-PASTA-003: a pasta nova é a própria pasta ou uma descendente dela.</summary>
    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "Erro mover para dentro dela mesma ou de uma descendente")]
    public async Task Handle_ShouldBeError_FolderQueries_IsSelfOrDescendant()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var newParentID = Guid.CreateVersion7();
        var folder = FolderFakers.Create(createdAt: CreatedAt);
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, parentID: newParentID);
        SetupGetByID(folder, cancellationToken);
        _folderQueries.Setup(q => q.IsSelfOrDescendant(newParentID, folder.ID, cancellationToken)).ReturnsAsync(true);
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_CYCLE", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _folderQueries.Verify(q => q.IsSelfOrDescendant(newParentID, folder.ID, cancellationToken), Times.Once);
        _folderQueries.Verify(q => q.Exists(It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);
        _folderRepository.Verify(r => r.Update(It.IsAny<Folder>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
        _folderRepository.Verify(r => r.GetByID(folder.ID, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "Erro nome já existe entre as irmãs")]
    public async Task Handle_ShouldBeError_FolderQueries_Exists()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var parentID = Guid.CreateVersion7();
        var folder = FolderFakers.Create(parentID: parentID, name: "Antiga", createdAt: CreatedAt);
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, name: "Produção", parentID: parentID);
        SetupGetByID(folder, cancellationToken);
        _folderQueries.Setup(q => q.Exists("Produção", parentID, cancellationToken)).ReturnsAsync(true);
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_ALREADY_EXISTS", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _folderQueries.Verify(q => q.Exists("Produção", parentID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Update(It.IsAny<Folder>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
        _folderRepository.Verify(r => r.GetByID(folder.ID, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }

    /// <summary>A corrida: as conferências passaram e a regra, dentro da gravação, recusou (outra requisição gravou antes).</summary>
    [Trait("UpdateFolderHandler", "UpdateFolderCommand")]
    [Fact(DisplayName = "Erro recusa do repository na gravação")]
    public async Task Handle_ShouldBeError_FolderRepository_Update()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var parentID = Guid.CreateVersion7();
        var folder = FolderFakers.Create(parentID: parentID, name: "Antiga", createdAt: CreatedAt);
        var command = FolderFakers.ReturnUpdateFolderCommandValid(iD: folder.ID, name: "Nova", parentID: parentID);
        SetupGetByID(folder, cancellationToken);
        _folderQueries.Setup(q => q.Exists("Nova", parentID, cancellationToken)).ReturnsAsync(false);
        _folderRepository.Setup(r => r.Update(It.IsAny<Folder>(), null, cancellationToken)).ReturnsAsync(Result.Failure<EffectiveProtections, ApiErrorDto>(FolderErrors.AlreadyExists("Nova")));
        var handler = new UpdateFolderHandler(_folderQueries.Object, _folderRepository.Object, _timeProvider);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_ALREADY_EXISTS", result.Error.Type);
        _folderRepository.Verify(r => r.GetByID(folder.ID, cancellationToken), Times.Once);
        _folderQueries.Verify(q => q.Exists("Nova", parentID, cancellationToken), Times.Once);
        _folderRepository.Verify(r => r.Update(It.IsAny<Folder>(), null, cancellationToken), Times.Once);
        _folderQueries.VerifyNoOtherCalls();
        _folderRepository.VerifyNoOtherCalls();
    }
}
