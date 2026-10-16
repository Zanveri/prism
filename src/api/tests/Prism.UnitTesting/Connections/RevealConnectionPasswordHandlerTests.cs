using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Features.RevealConnectionPassword;
using Prism.Application.Connections.Queries;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Connections;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Connections;

/// <summary>
/// RN-CONN-002 e RN-CONN-003. Quem confere a senha, conta os erros seguidos e fecha o cofre no quinto é o serviço do cofre, e
/// ele entrega o documento do mesmo cofre que a senha abriu: o handler só traduz, e a senha que devolve sai desse documento,
/// nunca da primeira leitura (que só serve para o 404 não gastar uma das cinco tentativas).
/// </summary>
public sealed class RevealConnectionPasswordHandlerTests
{
    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IVaultService> _vault = new();

    private static VaultDocument Document(params VaultConnectionRecord[] connections)
        => new("marina.costa", [], connections, [], VaultWorkspaceRecord.Empty, []);

    [Trait("RevealConnectionPasswordHandler", "RevealConnectionPasswordCommand")]
    [Fact(DisplayName = "OK senha do usuário certa revela a senha da conexão")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection(password: "senha-do-banco");
        var command = ConnectionFakers.ReturnRevealConnectionPasswordCommandValid(iD: record.ID, password: "senha-do-usuario");
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));
        _vault.Setup(v => v.ReadIfPasswordMatchesAsync("senha-do-usuario", cancellationToken)).ReturnsAsync(Result.Success<VaultDocument?, EVaultError>(Document(record)));
        var handler = new RevealConnectionPasswordHandler(_connectionQueries.Object, _vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("senha-do-banco", result.Value.Password);
        _connectionQueries.Verify(q => q.GetRecordByID(record.ID, cancellationToken), Times.Once);
        _vault.Verify(v => v.ReadIfPasswordMatchesAsync("senha-do-usuario", cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _vault.VerifyNoOtherCalls();
    }

    /// <summary>
    /// A senha devolvida é a do documento que a conferência entregou, e não a da primeira leitura: entre as duas a senha da conexão
    /// pode ter mudado. O registro da primeira leitura nunca é usado para responder.
    /// </summary>
    [Trait("RevealConnectionPasswordHandler", "RevealConnectionPasswordCommand")]
    [Fact(DisplayName = "OK a senha vem do documento da conferência, e não da primeira leitura")]
    public async Task Handle_ShouldBeOK_ThePasswordComesFromTheVerifiedDocument()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var firstRead = VaultFakers.CreateConnection(password: "senha-da-primeira-leitura");
        var verified = VaultFakers.CreateConnection(iD: firstRead.ID, password: "senha-do-documento-conferido");
        var command = ConnectionFakers.ReturnRevealConnectionPasswordCommandValid(iD: firstRead.ID, password: "senha-do-usuario");
        _connectionQueries.Setup(q => q.GetRecordByID(firstRead.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(firstRead));
        _vault.Setup(v => v.ReadIfPasswordMatchesAsync("senha-do-usuario", cancellationToken)).ReturnsAsync(Result.Success<VaultDocument?, EVaultError>(Document(VaultFakers.CreateConnection(), verified)));
        var handler = new RevealConnectionPasswordHandler(_connectionQueries.Object, _vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("senha-do-documento-conferido", result.Value.Password);
        _connectionQueries.Verify(q => q.GetRecordByID(firstRead.ID, cancellationToken), Times.Once);
        _vault.Verify(v => v.ReadIfPasswordMatchesAsync("senha-do-usuario", cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _vault.VerifyNoOtherCalls();
    }

    /// <summary>
    /// O cofre trocou de dono entre a primeira leitura e a conferência (outro usuário virou o cofre aberto, e a senha conferida é a
    /// dele): a conexão não está no documento conferido, e a resposta é 404, sem a senha da conexão lida antes.
    /// </summary>
    [Trait("RevealConnectionPasswordHandler", "RevealConnectionPasswordCommand")]
    [Fact(DisplayName = "Erro conexão que a primeira leitura achou não está no documento conferido")]
    public async Task Handle_ShouldBeError_VaultService_ReadIfPasswordMatchesAsync_OtherVault()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection(password: "senha-do-banco-do-primeiro-usuario");
        var command = ConnectionFakers.ReturnRevealConnectionPasswordCommandValid(iD: record.ID, password: "senha-do-segundo-usuario");
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));
        _vault.Setup(v => v.ReadIfPasswordMatchesAsync("senha-do-segundo-usuario", cancellationToken)).ReturnsAsync(Result.Success<VaultDocument?, EVaultError>(Document(VaultFakers.CreateConnection())));
        var handler = new RevealConnectionPasswordHandler(_connectionQueries.Object, _vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.DoesNotContain("senha-do-banco-do-primeiro-usuario", result.Error.Detail);
        _connectionQueries.Verify(q => q.GetRecordByID(record.ID, cancellationToken), Times.Once);
        _vault.Verify(v => v.ReadIfPasswordMatchesAsync("senha-do-segundo-usuario", cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _vault.VerifyNoOtherCalls();
    }

    /// <summary>A conexão é carregada antes de conferir a senha: um ID que não existe responde 404 e não gasta uma das cinco tentativas.</summary>
    [Trait("RevealConnectionPasswordHandler", "RevealConnectionPasswordCommand")]
    [Fact(DisplayName = "Erro conexão não existe, sem conferir a senha")]
    public async Task Handle_ShouldBeError_ConnectionQueries_GetRecordByID_NotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = ConnectionFakers.ReturnRevealConnectionPasswordCommandValid();
        _connectionQueries.Setup(q => q.GetRecordByID(command.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(null));
        var handler = new RevealConnectionPasswordHandler(_connectionQueries.Object, _vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _connectionQueries.Verify(q => q.GetRecordByID(command.ID, cancellationToken), Times.Once);
        _vault.Verify(v => v.ReadIfPasswordMatchesAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        _connectionQueries.VerifyNoOtherCalls();
        _vault.VerifyNoOtherCalls();
    }

    [Trait("RevealConnectionPasswordHandler", "RevealConnectionPasswordCommand")]
    [Fact(DisplayName = "Erro cofre fechado na leitura, sem conferir a senha")]
    public async Task Handle_ShouldBeError_ConnectionQueries_GetRecordByID_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = ConnectionFakers.ReturnRevealConnectionPasswordCommandValid();
        _connectionQueries.Setup(q => q.GetRecordByID(command.ID, cancellationToken)).ReturnsAsync(Result.Failure<VaultConnectionRecord?, EVaultError>(EVaultError.Locked));
        var handler = new RevealConnectionPasswordHandler(_connectionQueries.Object, _vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _connectionQueries.Verify(q => q.GetRecordByID(command.ID, cancellationToken), Times.Once);
        _vault.Verify(v => v.ReadIfPasswordMatchesAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        _connectionQueries.VerifyNoOtherCalls();
        _vault.VerifyNoOtherCalls();
    }

    [Trait("RevealConnectionPasswordHandler", "RevealConnectionPasswordCommand")]
    [Fact(DisplayName = "Erro senha do usuário errada, e nada é revelado")]
    public async Task Handle_ShouldBeError_VaultService_ReadIfPasswordMatchesAsync_Wrong()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection(password: "senha-do-banco");
        var command = ConnectionFakers.ReturnRevealConnectionPasswordCommandValid(iD: record.ID, password: "senha-errada");
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));
        _vault.Setup(v => v.ReadIfPasswordMatchesAsync("senha-errada", cancellationToken)).ReturnsAsync(Result.Success<VaultDocument?, EVaultError>(null));
        var handler = new RevealConnectionPasswordHandler(_connectionQueries.Object, _vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_PASSWORD", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.DoesNotContain("senha-do-banco", result.Error.Detail);
        _connectionQueries.Verify(q => q.GetRecordByID(record.ID, cancellationToken), Times.Once);
        _vault.Verify(v => v.ReadIfPasswordMatchesAsync("senha-errada", cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _vault.VerifyNoOtherCalls();
    }

    /// <summary>RN-CONN-003: o quinto erro seguido já fechou o cofre, e a resposta é 401 `VAULT_LOCKED` no lugar do 422.</summary>
    [Trait("RevealConnectionPasswordHandler", "RevealConnectionPasswordCommand")]
    [Fact(DisplayName = "Erro quinto erro seguido, cofre fechado")]
    public async Task Handle_ShouldBeError_VaultService_ReadIfPasswordMatchesAsync_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection(password: "senha-do-banco");
        var command = ConnectionFakers.ReturnRevealConnectionPasswordCommandValid(iD: record.ID, password: "senha-errada");
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));
        _vault.Setup(v => v.ReadIfPasswordMatchesAsync("senha-errada", cancellationToken)).ReturnsAsync(Result.Failure<VaultDocument?, EVaultError>(EVaultError.Locked));
        var handler = new RevealConnectionPasswordHandler(_connectionQueries.Object, _vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _connectionQueries.Verify(q => q.GetRecordByID(record.ID, cancellationToken), Times.Once);
        _vault.Verify(v => v.ReadIfPasswordMatchesAsync("senha-errada", cancellationToken), Times.Once);
        _connectionQueries.VerifyNoOtherCalls();
        _vault.VerifyNoOtherCalls();
    }
}
