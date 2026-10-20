using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Moq;
using Prism.Application.Connections.Features.VerifyConnection;
using Prism.Application.Connections.Models.Dtos;
using Prism.Application.Connections.Queries;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Connections;

/// <summary>
/// RN-VERIF-002: `POST api/user/connections/{id}/verification`. A geração do cofre é lida antes da conexão, a consulta é a gravada nela, e o
/// desfecho do registro de sessões vira o DTO com o estado em texto e o instante da resposta; a falha do banco é resposta, e não erro.
/// </summary>
public sealed class VerifyConnectionHandlerTests
{
    private const long Generation = 11;

    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();
    private readonly Mock<IVaultService> _vaultService = new();
    private readonly FakeTimeProvider _timeProvider = new(new DateTimeOffset(2026, 10, 15, 14, 32, 5, TimeSpan.Zero));

    private VerifyConnectionHandler CreateHandler()
        => new(_connectionQueries.Object, _databaseSessionService.Object, _vaultService.Object, _timeProvider);

    [Trait("VerifyConnectionHandler", "VerifyConnectionCommand")]
    [Theory(DisplayName = "OK cada desfecho vira o estado em texto, com o instante da resposta")]
    [InlineData(EVerificationStatus.Ok, "ok")]
    [InlineData(EVerificationStatus.Busy, "busy")]
    [InlineData(EVerificationStatus.NotConnected, "notConnected")]
    public async Task Handle_ShouldMapTheOutcome(EVerificationStatus status, string text)
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection() with { VerificationQuery = "SELECT 1" };
        var calls = new List<string>();
        _vaultService.SetupGet(v => v.Generation).Callback(() => calls.Add("Generation")).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).Callback(() => calls.Add("GetRecordByID")).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));
        _databaseSessionService.Setup(s => s.VerifyAsync(record.ID, "SELECT 1", Generation, cancellationToken)).ReturnsAsync(new ConnectionVerification(status, status == EVerificationStatus.Ok ? 3 : null));

        //Act
        var result = await CreateHandler().Handle(new VerifyConnectionCommand(record.ID), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(new ConnectionVerificationDto { Status = text, CheckedAt = _timeProvider.GetUtcNow().UtcDateTime, ElapsedMs = status == EVerificationStatus.Ok ? 3 : null }, result.Value);
        Assert.Equal(["Generation", "GetRecordByID"], calls);
        _databaseSessionService.Verify(s => s.VerifyAsync(record.ID, "SELECT 1", Generation, cancellationToken), Times.Once);
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>A falha do banco é resposta 200, `failed`, com a mensagem como veio e o SQLSTATE; sem consulta própria, a do banco (nula).</summary>
    [Trait("VerifyConnectionHandler", "VerifyConnectionCommand")]
    [Fact(DisplayName = "OK a falha do banco é failed, com a mensagem, o SQLSTATE e o tempo")]
    public async Task Handle_ShouldReturnTheDatabaseFailure()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var record = VaultFakers.CreateConnection();
        _vaultService.SetupGet(v => v.Generation).Returns(Generation);
        _connectionQueries.Setup(q => q.GetRecordByID(record.ID, cancellationToken)).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));
        _databaseSessionService.Setup(s => s.VerifyAsync(record.ID, null, Generation, cancellationToken)).ReturnsAsync(new ConnectionVerification(EVerificationStatus.Failed, 12, "terminating connection due to administrator command", "57P01"));

        //Act
        var result = await CreateHandler().Handle(new VerifyConnectionCommand(record.ID), cancellationToken);

        //Assert
        Assert.Equal(new ConnectionVerificationDto { Status = "failed", CheckedAt = _timeProvider.GetUtcNow().UtcDateTime, ElapsedMs = 12, Message = "terminating connection due to administrator command", SqlState = "57P01" }, result.Value);
    }

    [Trait("VerifyConnectionHandler", "VerifyConnectionCommand")]
    [Fact(DisplayName = "Erro conexão que não existe é 404, e nada é verificado")]
    public async Task Handle_ShouldBeError_NotFound()
    {
        //Arrange
        var id = Guid.CreateVersion7();
        _connectionQueries.Setup(q => q.GetRecordByID(id, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(null));

        //Act
        var result = await CreateHandler().Handle(new VerifyConnectionCommand(id), CancellationToken.None);

        //Assert
        Assert.Equal(("CONNECTION_NOT_FOUND", HttpStatusCode.NotFound), (result.Error.Type, result.Error.StatusCode));
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("VerifyConnectionHandler", "VerifyConnectionCommand")]
    [Fact(DisplayName = "Erro cofre fechado é 401, e nada é verificado")]
    public async Task Handle_ShouldBeError_Locked()
    {
        //Arrange
        var id = Guid.CreateVersion7();
        _connectionQueries.Setup(q => q.GetRecordByID(id, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure<VaultConnectionRecord?, EVaultError>(EVaultError.Locked));

        //Act
        var result = await CreateHandler().Handle(new VerifyConnectionCommand(id), CancellationToken.None);

        //Assert
        Assert.Equal(("VAULT_LOCKED", HttpStatusCode.Unauthorized), (result.Error.Type, result.Error.StatusCode));
        _databaseSessionService.VerifyNoOtherCalls();
    }
}
