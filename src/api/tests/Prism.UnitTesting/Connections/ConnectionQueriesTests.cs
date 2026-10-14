using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Queries;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;

namespace Prism.UnitTesting.Connections;

public sealed class ConnectionQueriesTests
{
    private readonly Mock<IVaultService> _vault = new();

    [Trait("ConnectionQueries", "GetRecordByID")]
    [Fact(DisplayName = "OK devolve o registro com a senha")]
    public async Task GetRecordByID_ShouldReturnTheRecord()
    {
        //Arrange
        var record = VaultFakers.CreateConnection(password: "segredo");
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", [], [VaultFakers.CreateConnection(), record], [], VaultWorkspaceRecord.Empty)));
        var queries = new ConnectionQueries(_vault.Object);

        //Act
        var result = await queries.GetRecordByID(record.ID, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Same(record, result.Value);
    }

    /// <summary>Sucesso com `null`: o cofre foi lido e a conexão não está nele. É o que separa "não existe" (404) de "cofre fechado" (401).</summary>
    [Trait("ConnectionQueries", "GetRecordByID")]
    [Fact(DisplayName = "OK sucesso com nulo quando a conexão não existe")]
    public async Task GetRecordByID_ShouldBeNull_WhenTheConnectionDoesNotExist()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", [], [VaultFakers.CreateConnection()], [], VaultWorkspaceRecord.Empty)));
        var queries = new ConnectionQueries(_vault.Object);

        //Act
        var result = await queries.GetRecordByID(Guid.CreateVersion7(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Null(result.Value);
    }

    [Trait("ConnectionQueries", "GetRecordByID")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task GetRecordByID_ShouldBeError_WhenTheVaultIsLocked()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));
        var queries = new ConnectionQueries(_vault.Object);

        //Act
        var result = await queries.GetRecordByID(Guid.CreateVersion7(), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Locked, result.Error);
    }
}
