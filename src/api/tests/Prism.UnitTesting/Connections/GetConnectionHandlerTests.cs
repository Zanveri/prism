using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Common.Protections;
using Prism.Application.Connections.Features.GetConnection;
using Prism.Application.Connections.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Connections;

public sealed class GetConnectionHandlerTests
{
    private readonly Mock<IVaultService> _vault = new();

    private static VaultDocument Document(IReadOnlyList<VaultFolderRecord> folders, params VaultConnectionRecord[] connections)
        => new("marina.costa", folders, connections, [], VaultWorkspaceRecord.Empty);

    [Trait("GetConnectionHandler", "GetConnectionCommand")]
    [Fact(DisplayName = "OK devolve a conexão sem a senha")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection(password: "segredo");
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(Document([], VaultFakers.CreateConnection(), record)));
        var handler = new GetConnectionHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetConnectionCommand(record.ID), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(record.ToDto(new EffectiveProtections(false, null, null, null)), result.Value);
        Assert.True(result.Value.HasPassword);
        _vault.Verify(v => v.Read(), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    /// <summary>RN-PROT-004: as proteções que valem saem das pastas acima, lidas do mesmo documento.</summary>
    [Trait("GetConnectionHandler", "GetConnectionCommand")]
    [Fact(DisplayName = "OK devolve as proteções que valem, com a pasta acima que as impõe")]
    public async Task Handle_ShouldBeOK_WithTheInheritedProtections()
    {
        //Arrange
        var factory = VaultFakers.CreateFolder(name: "Fábrica") with { ReadOnly = true, ConfirmCommands = "irreversible" };
        var line = VaultFakers.CreateFolder(parentID: factory.ID, name: "Linha 1");
        var record = VaultFakers.CreateConnection(folderID: line.ID) with { ConfirmCommands = "all" };
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(Document([factory, line], record)));
        var handler = new GetConnectionHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetConnectionCommand(record.ID), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.False(result.Value.ReadOnly);
        Assert.Equal("all", result.Value.ConfirmCommands);
        Assert.Equal(new ProtectionsDto { ReadOnly = true, ReadOnlyFolderID = factory.ID, ConfirmCommands = "all", ConfirmCommandsFolderID = null }, result.Value.Protections);
    }

    [Trait("GetConnectionHandler", "GetConnectionCommand")]
    [Fact(DisplayName = "Erro conexão não existe")]
    public async Task Handle_ShouldBeError_NotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var id = Guid.CreateVersion7();
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(Document([], VaultFakers.CreateConnection())));
        var handler = new GetConnectionHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetConnectionCommand(id), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _vault.Verify(v => v.Read(), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("GetConnectionHandler", "GetConnectionCommand")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Handle_ShouldBeError_VaultService_Read_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var id = Guid.CreateVersion7();
        _vault.Setup(v => v.Read()).Returns(Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));
        var handler = new GetConnectionHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetConnectionCommand(id), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _vault.Verify(v => v.Read(), Times.Once);
        _vault.VerifyNoOtherCalls();
    }
}
