using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Features.TestConnection;
using Prism.Application.Connections.Queries;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Connections;

public sealed class TestConnectionHandlerTests
{
    private const long Generation = 7;

    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();
    private readonly Mock<IVaultService> _vaultService = new();

    private TestConnectionHandler CreateHandler()
        => new(_connectionQueries.Object, _databaseSessionService.Object, _vaultService.Object);

    private static TestConnectionCommand CreateCommand(Guid? id = null, string? password = "senha-digitada")
        => new() { ID = id, Engine = EDatabaseEngine.PostgreSql, Host = "  pg.local ", Port = 5432, Database = " producao ", UserName = " operador ", Password = password };

    /// <summary>RN-CONN-013: a senha digitada vale, e o cofre nem é consultado. Host, banco e usuário vão aparados, como o domínio os grava.</summary>
    [Trait("TestConnectionHandler", "TestConnectionCommand")]
    [Fact(DisplayName = "OK testa com a senha digitada")]
    public async Task Handle_ShouldBeOK_WithTheTypedPassword()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var settings = new ConnectionSettings(EDatabaseEngine.PostgreSql, "pg.local", 5432, "producao", "operador", "senha-digitada");
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _databaseSessionService.Setup(s => s.TestAsync(settings, null, cancellationToken)).ReturnsAsync(UnitResult.Success<DatabaseFailure>());

        //Act
        var result = await CreateHandler().Handle(CreateCommand(id: Guid.CreateVersion7()), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        _databaseSessionService.Verify(s => s.TestAsync(settings, null, cancellationToken), Times.Once);
        _vaultService.VerifyGet(v => v.Generation, Times.Exactly(2));
        _connectionQueries.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
        _vaultService.VerifyNoOtherCalls();
    }

    /// <summary>RN-CONN-013: sem a senha no pedido e com o `id`, a senha é a do cofre.</summary>
    [Trait("TestConnectionHandler", "TestConnectionCommand")]
    [Fact(DisplayName = "OK testa com a senha guardada quando o pedido leva só o id")]
    public async Task Handle_ShouldBeOK_WithTheStoredPassword()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection(host: "pg.local", password: "senha-guardada") with { Port = 5432 };
        var settings = new ConnectionSettings(EDatabaseEngine.PostgreSql, "pg.local", 5432, "producao", "operador", "senha-guardada");
        var calls = new List<string>();
        _vaultService.SetupGet(v => v.Generation).Callback(() => calls.Add("Generation")).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).Callback(() => calls.Add("GetRecordByID")).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));
        _databaseSessionService.Setup(s => s.TestAsync(settings, null, cancellationToken)).ReturnsAsync(UnitResult.Success<DatabaseFailure>());

        //Act
        var result = await CreateHandler().Handle(CreateCommand(id: record.ID, password: null), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        // A geração é lida antes da senha guardada e conferida depois do teste.
        Assert.Equal(["Generation", "GetRecordByID", "Generation"], calls);
        _connectionQueries.Verify(q => q.GetRecordByID(record.ID, cancellationToken), Times.Once);
        _databaseSessionService.Verify(s => s.TestAsync(settings, null, cancellationToken), Times.Once);
        _vaultService.VerifyGet(v => v.Generation, Times.Exactly(2));
        _connectionQueries.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
        _vaultService.VerifyNoOtherCalls();
    }

    [Trait("TestConnectionHandler", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro cofre fechado ao ler a senha guardada")]
    public async Task Handle_ShouldBeError_ConnectionQueries_GetRecordByID_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var id = Guid.CreateVersion7();
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(id, cancellationToken)).ReturnsAsync(Result.Failure<VaultConnectionRecord?, EVaultError>(EVaultError.Locked));

        //Act
        var result = await CreateHandler().Handle(CreateCommand(id: id, password: null), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _connectionQueries.Verify(q => q.GetRecordByID(id, cancellationToken), Times.Once);
        _vaultService.VerifyGet(v => v.Generation, Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _vaultService.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("TestConnectionHandler", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro conexão não existe")]
    public async Task Handle_ShouldBeError_ConnectionQueries_GetRecordByID_NotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var id = Guid.CreateVersion7();
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(id, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(null));

        //Act
        var result = await CreateHandler().Handle(CreateCommand(id: id, password: null), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _connectionQueries.Verify(q => q.GetRecordByID(id, cancellationToken), Times.Once);
        _vaultService.VerifyGet(v => v.Generation, Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _vaultService.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>
    /// RN-CONN-013 com a RN-CONN-004: a senha gravada só vai ao servidor para o qual foi gravada. O pedido aponta para outro host (ou outra
    /// porta) sem trazer a senha: a recusa vem sem tentar conectar, e a geração do cofre nem chega a ser conferida de novo.
    /// </summary>
    [Trait("TestConnectionHandler", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro o pedido sem senha aponta para outro host")]
    public async Task Handle_ShouldBeError_WhenTheHostDiffersFromTheStoredOne()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection(host: "outro.local", password: "senha-guardada") with { Port = 5432 };
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));

        //Act
        var result = await CreateHandler().Handle(CreateCommand(id: record.ID, password: null), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_INVALID", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("Para testar com outro host ou outra porta, informe a senha da conexão.", result.Error.Detail);
        _connectionQueries.Verify(q => q.GetRecordByID(record.ID, cancellationToken), Times.Once);
        _vaultService.VerifyGet(v => v.Generation, Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
        _vaultService.VerifyNoOtherCalls();
    }

    [Trait("TestConnectionHandler", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro o pedido sem senha aponta para outra porta")]
    public async Task Handle_ShouldBeError_WhenThePortDiffersFromTheStoredOne()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection(host: "pg.local", password: "senha-guardada") with { Port = 5433 };
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));

        //Act
        var result = await CreateHandler().Handle(CreateCommand(id: record.ID, password: null), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_INVALID", result.Error.Type);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("TestConnectionHandler", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro o banco recusou, com a mensagem dele")]
    public async Task Handle_ShouldBeError_DatabaseSessionService_TestAsync_ConnectionFailed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _databaseSessionService.Setup(s => s.TestAsync(It.IsAny<ConnectionSettings>(), null, cancellationToken)).ReturnsAsync(UnitResult.Failure(new DatabaseFailure(EDatabaseFailure.ConnectionFailed, "database \"producao\" does not exist", "3D000")));

        //Act
        var result = await CreateHandler().Handle(CreateCommand(), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_CONNECTION_FAILED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("database \"producao\" does not exist", result.Error.Detail);
        _databaseSessionService.Verify(s => s.TestAsync(It.IsAny<ConnectionSettings>(), null, cancellationToken), Times.Once);
        // Falhou ao testar: a geração não chega a ser conferida.
        _vaultService.VerifyGet(v => v.Generation, Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
        _vaultService.VerifyNoOtherCalls();
    }

    /// <summary>O cofre trocou de dono enquanto o teste rodava: o resultado é de credenciais que já não são de quem pediu.</summary>
    [Trait("TestConnectionHandler", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro o cofre mudou enquanto o teste rodava")]
    public async Task Handle_ShouldBeError_VaultService_Generation_Changed()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        _vaultService.SetupSequence(v => v.Generation).Returns(Generation).Returns(Generation + 1);
        _databaseSessionService.Setup(s => s.TestAsync(It.IsAny<ConnectionSettings>(), null, cancellationToken)).ReturnsAsync(UnitResult.Success<DatabaseFailure>());

        //Act
        var result = await CreateHandler().Handle(CreateCommand(), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _databaseSessionService.Verify(s => s.TestAsync(It.IsAny<ConnectionSettings>(), null, cancellationToken), Times.Once);
        _vaultService.VerifyGet(v => v.Generation, Times.Exactly(2));
        _connectionQueries.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
        _vaultService.VerifyNoOtherCalls();
    }

    /// <summary>RN-CONN-013 e RN-VERIF-001: a consulta de verificação do formulário vai aparada ao teste, no lugar da do banco; em branco, a do banco.</summary>
    [Trait("TestConnectionHandler", "TestConnectionCommand")]
    [Theory(DisplayName = "OK testa com a consulta de verificação do formulário, aparada, ou com a do banco")]
    [InlineData("  SELECT 2 \n", "SELECT 2")]
    [InlineData("   ", null)]
    public async Task Handle_ShouldTestWithTheVerificationQuery(string query, string? sent)
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var settings = new ConnectionSettings(EDatabaseEngine.PostgreSql, "pg.local", 5432, "producao", "operador", "senha-digitada");
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _databaseSessionService.Setup(s => s.TestAsync(settings, sent, cancellationToken)).ReturnsAsync(UnitResult.Success<DatabaseFailure>());

        //Act
        var result = await CreateHandler().Handle(CreateCommand() with { VerificationQuery = query }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        _databaseSessionService.Verify(s => s.TestAsync(settings, sent, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>
    /// RN-TRANSF-016 e RN-CONN-013: com o `id`, sem a senha no pedido e sem senha gravada (a conexão que a importação trouxe sem ela, RN-TRANSF-015), a
    /// resposta é 422 `CONNECTION_CREDENTIALS_MISSING` no campo da senha, sem conectar, em vez de testar com a senha vazia. Vem antes da conferência do
    /// servidor: sem senha gravada não há o que a RN-CONN-004 proteger.
    /// </summary>
    [Trait("TestConnectionHandler", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro conexão gravada sem senha, sem a senha no pedido, é recusada no campo da senha sem conectar")]
    public async Task Handle_ShouldBeError_StoredWithoutPassword()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection(host: "outro.exemplo.invalid", userName: "datafix") with { Password = string.Empty };
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));

        //Act
        var result = await CreateHandler().Handle(CreateCommand(id: record.ID, password: null), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_CREDENTIALS_MISSING", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal(["Esta conexão não tem senha gravada. Informe a senha do banco para testar."], ((Dictionary<string, string[]>)result.Error.Extensions["errors"]!)["Password"]);
        Assert.Equal(["CONNECTION_CREDENTIALS_MISSING"], ((Dictionary<string, string[]>)result.Error.Extensions["errorCodes"]!)["Password"]);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>RN-TRANSF-016: a conexão gravada sem senha testa normalmente com a senha digitada no formulário.</summary>
    [Trait("TestConnectionHandler", "TestConnectionCommand")]
    [Fact(DisplayName = "OK conexão gravada sem senha testa com a senha digitada")]
    public async Task Handle_ShouldBeOK_StoredWithoutPasswordAndTypedPassword()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var settings = new ConnectionSettings(EDatabaseEngine.PostgreSql, "pg.local", 5432, "producao", "operador", "senha-digitada");
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _databaseSessionService.Setup(s => s.TestAsync(settings, null, cancellationToken)).ReturnsAsync(UnitResult.Success<DatabaseFailure>());

        //Act
        var result = await CreateHandler().Handle(CreateCommand(id: Guid.CreateVersion7(), password: "senha-digitada"), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        _connectionQueries.VerifyNoOtherCalls();
    }
}
