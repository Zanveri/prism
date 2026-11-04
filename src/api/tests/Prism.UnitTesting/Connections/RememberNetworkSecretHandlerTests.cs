using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Features.RememberNetworkSecret;
using Prism.Application.Connections.Queries;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Connections;

/// <summary>
/// RN-REDE-006: o segredo do túnel ou do proxy pedido ao conectar. A API conecta com ele antes de guardá-lo: o errado volta com a mensagem do servidor e não fica
/// na memória, e o outro segredo que ainda falta é pedido no campo dele, sem conectar.
/// </summary>
public sealed class RememberNetworkSecretHandlerTests : IDisposable
{
    private const long Generation = 7;

    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();
    private readonly Mock<IVaultService> _vaultService = new();
    private readonly UnsavedSecretsService _unsavedSecrets;
    private readonly VaultConnectionRecord _record;

    public RememberNetworkSecretHandlerTests()
    {
        _unsavedSecrets = new UnsavedSecretsService(_vaultService.Object);
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _record = VaultFakers.CreateConnection(host: "pg.local", password: "senha-guardada") with
        {
            Ssh = new ConnectionSshSettings("bastion.local", 22, "ops", "privateKey", "/chaves/id_ed25519", SaveCredentials: false)
        };
        _connectionQueries.Setup(q => q.GetRecordByID(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(_record));
    }

    public void Dispose()
        => _unsavedSecrets.Dispose();

    private RememberNetworkSecretHandler CreateHandler()
        => new(_connectionQueries.Object, _databaseSessionService.Object, _vaultService.Object, _unsavedSecrets);

    [Trait("RememberNetworkSecretHandler", "RememberNetworkSecretCommand")]
    [Fact(DisplayName = "OK conecta com a frase secreta digitada e só então a guarda na memória")]
    public async Task Handle_ShouldBeOK_TestsAndThenRemembers()
    {
        //Arrange
        ConnectionSettings? tested = null;
        _databaseSessionService.Setup(s => s.TestAsync(It.IsAny<ConnectionSettings>(), It.IsAny<CancellationToken>())).Callback<ConnectionSettings, CancellationToken>((settings, _) => tested = settings).ReturnsAsync(UnitResult.Success<DatabaseFailure>());

        //Act
        var result = await CreateHandler().Handle(new RememberNetworkSecretCommand { ID = _record.ID, SshSecret = "frase-digitada" }, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("frase-digitada", tested?.Ssh?.Secret);
        Assert.Equal("senha-guardada", tested?.Password);
        Assert.Equal("frase-digitada", _unsavedSecrets.Ssh(_record.ID)?.Secret);
    }

    [Trait("RememberNetworkSecretHandler", "RememberNetworkSecretCommand")]
    [Fact(DisplayName = "Erro a frase secreta que o servidor recusa volta com a mensagem dele, e não fica na memória")]
    public async Task Handle_ShouldBeError_TheServerRefusesTheSecret()
    {
        //Arrange
        _databaseSessionService.Setup(s => s.TestAsync(It.IsAny<ConnectionSettings>(), It.IsAny<CancellationToken>())).ReturnsAsync(UnitResult.Failure(new DatabaseFailure(EDatabaseFailure.ConnectionFailed, "Invalid passphrase.")));

        //Act
        var result = await CreateHandler().Handle(new RememberNetworkSecretCommand { ID = _record.ID, SshSecret = "frase-errada" }, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DATABASE_CONNECTION_FAILED", result.Error.Type);
        Assert.Equal("Invalid passphrase.", result.Error.Detail);
        Assert.Null(_unsavedSecrets.Ssh(_record.ID));
    }

    [Trait("RememberNetworkSecretHandler", "RememberNetworkSecretCommand")]
    [Fact(DisplayName = "Erro a senha do proxy que ainda falta é pedida no campo dela, sem conectar")]
    public async Task Handle_ShouldBeError_TheProxyPasswordIsStillMissing()
    {
        //Arrange
        _connectionQueries.Setup(q => q.GetRecordByID(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(_record with { Proxy = new ConnectionProxySettings("socks.local", 1080, "proxy-user", SaveCredentials: false) }));

        //Act
        var result = await CreateHandler().Handle(new RememberNetworkSecretCommand { ID = _record.ID, SshSecret = "frase-digitada" }, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_CREDENTIALS_MISSING", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.True(((Dictionary<string, string[]>)result.Error.Extensions["errors"]!).ContainsKey("ProxyPassword"));
        _databaseSessionService.VerifyNoOtherCalls();
        Assert.Null(_unsavedSecrets.Ssh(_record.ID));
    }
}
