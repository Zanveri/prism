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
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", [], [VaultFakers.CreateConnection(), record], [], VaultWorkspaceRecord.Empty, [])));
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
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", [], [VaultFakers.CreateConnection()], [], VaultWorkspaceRecord.Empty, [])));
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

    /// <summary>RN-PROT-002 e 004: somente leitura pela opção dela ou de uma pasta acima, no documento do cofre aberto agora.</summary>
    [Trait("ConnectionQueries", "IsReadOnly")]
    [Fact(DisplayName = "OK somente leitura pela própria opção ou pela de uma pasta acima, e não sem nenhuma")]
    public async Task IsReadOnly_ShouldBeTheEffectiveReadOnly()
    {
        //Arrange
        var factory = VaultFakers.CreateFolder() with { ReadOnly = true };
        var line = VaultFakers.CreateFolder(parentID: factory.ID);
        var inherited = VaultFakers.CreateConnection(folderID: line.ID);
        var own = VaultFakers.CreateConnection() with { ReadOnly = true };
        var none = VaultFakers.CreateConnection();
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", [factory, line], [inherited, own, none], [], VaultWorkspaceRecord.Empty, [])));
        var queries = new ConnectionQueries(_vault.Object);

        //Act
        var ofInherited = await queries.IsReadOnly(inherited.ID, CancellationToken.None);
        var ofOwn = await queries.IsReadOnly(own.ID, CancellationToken.None);
        var ofNone = await queries.IsReadOnly(none.ID, CancellationToken.None);

        //Assert
        Assert.True(ofInherited.Value);
        Assert.True(ofOwn.Value);
        Assert.False(ofNone.Value);
    }

    [Trait("ConnectionQueries", "IsReadOnly")]
    [Fact(DisplayName = "OK sucesso com nulo quando a conexão não existe, e o cofre fechado é falha")]
    public async Task IsReadOnly_ShouldBeNullForAMissingConnection_AndFailWhenLocked()
    {
        //Arrange
        _vault.SetupSequence(v => v.Read())
            .Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", [], [VaultFakers.CreateConnection()], [], VaultWorkspaceRecord.Empty, [])))
            .Returns(Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));
        var queries = new ConnectionQueries(_vault.Object);

        //Act
        var missing = await queries.IsReadOnly(Guid.CreateVersion7(), CancellationToken.None);
        var locked = await queries.IsReadOnly(Guid.CreateVersion7(), CancellationToken.None);

        //Assert
        Assert.True(missing.IsSuccess);
        Assert.Null(missing.Value);
        Assert.Equal(EVaultError.Locked, locked.Error);
    }
}
