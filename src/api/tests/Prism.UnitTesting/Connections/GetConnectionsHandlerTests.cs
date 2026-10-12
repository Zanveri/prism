using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Features.GetConnections;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Connections;

public sealed class GetConnectionsHandlerTests
{
    private readonly Mock<IVaultService> _vault = new();

    [Trait("GetConnectionsHandler", "GetConnectionsCommand")]
    [Fact(DisplayName = "OK a lista inteira, pelo nome sem diferenciar maiúsculas e depois pelo ID, sem senha")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var low = Guid.Parse("00000000-0000-7000-8000-000000000001");
        var high = Guid.Parse("00000000-0000-7000-8000-000000000002");
        var beta = VaultFakers.CreateConnection(name: "beta");
        var alfa = VaultFakers.CreateConnection(name: "Alfa");
        var twinB = VaultFakers.CreateConnection(name: "Gama", iD: high, password: string.Empty);
        var twinA = VaultFakers.CreateConnection(name: "gama", iD: low, password: "segredo");
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", [], [beta, twinB, alfa, twinA])));
        var handler = new GetConnectionsHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetConnectionsCommand(), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal([alfa.ID, beta.ID, low, high], result.Value.Select(connection => connection.ID));
        Assert.Equal([true, true, true, false], result.Value.Select(connection => connection.HasPassword));
        _vault.Verify(v => v.Read(), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("GetConnectionsHandler", "GetConnectionsCommand")]
    [Fact(DisplayName = "OK cofre sem conexões é lista vazia")]
    public async Task Handle_ShouldBeOK_Empty()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", [VaultFakers.CreateFolder()], [])));
        var handler = new GetConnectionsHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetConnectionsCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value);
        _vault.Verify(v => v.Read(), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    /// <summary>Uma lista vazia seria a resposta errada para um cofre fechado: a tela mostraria a árvore sem conexões em vez de voltar ao login.</summary>
    [Trait("GetConnectionsHandler", "GetConnectionsCommand")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Handle_ShouldBeError_VaultService_Read_Locked()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));
        var handler = new GetConnectionsHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetConnectionsCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _vault.Verify(v => v.Read(), Times.Once);
        _vault.VerifyNoOtherCalls();
    }
}
