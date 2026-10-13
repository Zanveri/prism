using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Moq;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Domain;
using Prism.Application.Connections.Features.DuplicateConnection;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Fakers.Connections;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using System.Net;

namespace Prism.UnitTesting.Connections;

/// <summary>RN-CONN-016: duplicar é uma gravação só, e quem decide o nome e copia a senha é o repository, dentro dela.</summary>
public sealed class DuplicateConnectionHandlerTests
{
    private readonly Mock<IConnectionRepository> _connectionRepository = new();
    private readonly FakeTimeProvider _timeProvider = new(new DateTimeOffset(2026, 10, 13, 9, 0, 0, TimeSpan.Zero));
    private readonly CollectingSink _sink = new();

    private DuplicateConnectionHandler CreateHandler()
        => new(_connectionRepository.Object, _timeProvider, new LoggerConfiguration().MinimumLevel.Verbose().WriteTo.Sink(_sink).CreateLogger());

    /// <summary>A resposta é a do `GET api/user/connections/{id}`: a conexão nova, sem a senha (RN-CONN-001), só com o `HasPassword`.</summary>
    [Trait("DuplicateConnectionHandler", "DuplicateConnectionCommand")]
    [Fact(DisplayName = "OK grava a cópia com a data de agora e responde com ela, sem a senha")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = new DuplicateConnectionCommand(Guid.CreateVersion7());
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var copy = ConnectionFakers.Create(name: "MES (cópia)", password: "marca-da-senha-do-banco", environmentName: "Produção", environmentColor: "#FF0000", createdAt: now);
        _connectionRepository.Setup(r => r.Duplicate(command.ID, now, cancellationToken)).ReturnsAsync(Result.Success<Connection, ApiErrorDto>(copy));
        var handler = CreateHandler();

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(copy.ID, result.Value.ID);
        Assert.Equal(copy.FolderID, result.Value.FolderID);
        Assert.Equal("MES (cópia)", result.Value.Name);
        Assert.Equal(copy.Host, result.Value.Host);
        Assert.Equal("Produção", result.Value.EnvironmentName);
        Assert.Equal(now, result.Value.CreatedAt);
        Assert.True(result.Value.HasPassword);
        _connectionRepository.Verify(r => r.Duplicate(command.ID, now, cancellationToken), Times.Once);
        _connectionRepository.VerifyNoOtherCalls();
    }

    /// <summary>RN-LOG-001 e RN-CONN-016: o log registra os dois IDs, e nunca a senha, o host, o usuário nem o nome.</summary>
    [Trait("DuplicateConnectionHandler", "DuplicateConnectionCommand")]
    [Fact(DisplayName = "OK o log registra a conexão e a cópia pelos IDs, sem senha, host, usuário nem nome")]
    public async Task Handle_ShouldLogTheIDs_AndNeverThePassword()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = new DuplicateConnectionCommand(Guid.CreateVersion7());
        var copy = ConnectionFakers.Create(name: "marca-do-nome", host: "marca-do-host", userName: "marca-do-usuario", password: "marca-da-senha-do-banco");
        _connectionRepository.Setup(r => r.Duplicate(command.ID, It.IsAny<DateTime>(), cancellationToken)).ReturnsAsync(Result.Success<Connection, ApiErrorDto>(copy));
        var handler = CreateHandler();

        //Act
        await handler.Handle(command, cancellationToken);

        //Assert
        var logged = Assert.Single(_sink.Events);
        Assert.Equal(LogEventLevel.Information, logged.Level);
        var text = $"{logged.RenderMessage()} {string.Join(' ', logged.Properties.Select(property => $"{property.Key}={property.Value}"))}";
        Assert.Contains(command.ID.ToString(), text);
        Assert.Contains(copy.ID.ToString(), text);
        Assert.DoesNotContain("marca-", text);
    }

    [Trait("DuplicateConnectionHandler", "DuplicateConnectionCommand")]
    [Fact(DisplayName = "Erro conexão não existe, dito pela gravação, e nada vai ao log")]
    public async Task Handle_ShouldBeError_ConnectionRepository_Duplicate_NotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = new DuplicateConnectionCommand(Guid.CreateVersion7());
        _connectionRepository.Setup(r => r.Duplicate(command.ID, It.IsAny<DateTime>(), cancellationToken)).ReturnsAsync(Result.Failure<Connection, ApiErrorDto>(ConnectionErrors.NotFound(command.ID)));
        var handler = CreateHandler();

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.Empty(_sink.Events);
    }

    [Trait("DuplicateConnectionHandler", "DuplicateConnectionCommand")]
    [Fact(DisplayName = "Erro cofre fechado, dito pela gravação")]
    public async Task Handle_ShouldBeError_ConnectionRepository_Duplicate_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = new DuplicateConnectionCommand(Guid.CreateVersion7());
        _connectionRepository.Setup(r => r.Duplicate(command.ID, It.IsAny<DateTime>(), cancellationToken)).ReturnsAsync(Result.Failure<Connection, ApiErrorDto>(VaultErrors.From(EVaultError.Locked)));
        var handler = CreateHandler();

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
    }

    private sealed class CollectingSink : ILogEventSink
    {
        public List<LogEvent> Events { get; } = [];

        public void Emit(LogEvent logEvent)
            => Events.Add(logEvent);
    }
}
