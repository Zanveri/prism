using CSharpFunctionalExtensions;
using Microsoft.Extensions.Options;
using Moq;
using Prism.Application.Common.Protections;
using Prism.Application.Connections.Features.DeleteConnection;
using Prism.Application.Connections.Features.RevealConnectionPassword;
using Prism.Application.Connections.Features.UpdateConnection;
using Prism.Application.Connections.Queries;
using Prism.Application.Connections.Repositories;
using Prism.Application.ConnectionTransfers.Features.ExportConnections;
using Prism.Application.Sessions.Features.SignIn;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.ConnectionFiles.Services;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Journal.Clients;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Transfers.Services;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Serilog.Core;

namespace Prism.UnitTesting.Journal;

public sealed class AccountJournalTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("prism-account-journal-").FullName;

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, recursive: true);
    }

    [Trait("AccountJournal", "SignIn")]
    [Fact(DisplayName = "Entradas com senha errada são resumidas na próxima entrada certa como nível Alto")]
    public async Task WrongSignIns_AreSummarizedOnNextSuccess_AsHigh()
    {
        var attemptsFile = new SignInAttemptsFile(Options.Create(new VaultOptions { DataDirectory = _tempDir }));
        var recorder = new SpyJournalRecorder();
        var clock = new ManualTimeProvider(new DateTimeOffset(2026, 10, 30, 14, 2, 0, TimeSpan.FromHours(-3)));

        var vaultService = new Mock<IVaultService>();
        vaultService
            .SetupSequence(service => service.UnlockAsync("marina.costa", It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(UnitResult.Failure(EVaultError.InvalidCredentials))
            .ReturnsAsync(UnitResult.Failure(EVaultError.InvalidCredentials))
            .ReturnsAsync(UnitResult.Failure(EVaultError.InvalidCredentials))
            .ReturnsAsync(UnitResult.Success<EVaultError>());

        var handler = new SignInHandler(vaultService.Object, attemptsFile, recorder, clock);

        clock.Set(new DateTimeOffset(2026, 10, 30, 14, 2, 0, TimeSpan.FromHours(-3)));
        await handler.Handle(new SignInCommand { UserName = "marina.costa", Password = "errada-1" }, CancellationToken.None);

        clock.Set(new DateTimeOffset(2026, 10, 30, 14, 3, 0, TimeSpan.FromHours(-3)));
        await handler.Handle(new SignInCommand { UserName = "marina.costa", Password = "errada-2" }, CancellationToken.None);

        clock.Set(new DateTimeOffset(2026, 10, 30, 14, 5, 0, TimeSpan.FromHours(-3)));
        await handler.Handle(new SignInCommand { UserName = "marina.costa", Password = "errada-3" }, CancellationToken.None);

        Assert.Empty(recorder.Records);

        clock.Set(new DateTimeOffset(2026, 10, 30, 14, 6, 0, TimeSpan.FromHours(-3)));
        var signedIn = await handler.Handle(new SignInCommand { UserName = "marina.costa", Password = "certa" }, CancellationToken.None);

        Assert.True(signedIn.IsSuccess);
        var highRecord = Assert.Single(recorder.Records, item => item.Start.Level == EJournalLevel.High);
        Assert.Equal(EJournalKind.Security, highRecord.Start.Kind);
        Assert.Equal("3 entradas com senha errada desde a última (30/10 14:02, 14:03, 14:05)", highRecord.Start.Reason);
        Assert.Equal(EJournalOutcome.Ok, highRecord.End.Outcome);
        Assert.Contains(recorder.Records, item => item.Start.Level == EJournalLevel.Info && item.Start.Action == "Entrada no cofre");
        Assert.Empty(attemptsFile.Take("marina.costa"));
    }

    [Trait("AccountJournal", "SignIn")]
    [Fact(DisplayName = "O arquivo de tentativas guarda só as horas, sem usuário nem senha")]
    public async Task AttemptsFile_HoldsOnlyTimes()
    {
        var attemptsFile = new SignInAttemptsFile(Options.Create(new VaultOptions { DataDirectory = _tempDir }));
        var recorder = new SpyJournalRecorder();
        var clock = new ManualTimeProvider(new DateTimeOffset(2026, 10, 30, 14, 2, 0, TimeSpan.FromHours(-3)));

        var vaultService = new Mock<IVaultService>();
        vaultService
            .Setup(service => service.UnlockAsync("marina.costa", It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(UnitResult.Failure(EVaultError.InvalidCredentials));

        var handler = new SignInHandler(vaultService.Object, attemptsFile, recorder, clock);
        await handler.Handle(new SignInCommand { UserName = "marina.costa", Password = "segredo-super-secreto" }, CancellationToken.None);

        var filePath = Path.Combine(_tempDir, "journal", "marina.costa.attempts");
        Assert.True(File.Exists(filePath));

        var content = await File.ReadAllTextAsync(filePath);
        Assert.DoesNotContain("marina.costa", content, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("segredo-super-secreto", content, StringComparison.OrdinalIgnoreCase);
        var singleLine = Assert.Single(content.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries));
        Assert.True(DateTimeOffset.TryParse(singleLine, out _));
    }

    [Trait("AccountJournal", "RevealPassword")]
    [Fact(DisplayName = "Revelar senha da conexão grava nível Alto tanto no acerto quanto no erro")]
    public async Task RevealPassword_RecordsHigh_OkAndError()
    {
        var connectionId = Guid.NewGuid();
        var record = CreateConnectionRecord(connectionId, readOnly: false, confirmCommands: null);
        var document = new VaultDocument("marina.costa", [], [record], [], VaultWorkspaceRecord.Empty, []);

        var queries = new Mock<IConnectionQueries>();
        queries
            .Setup(q => q.GetRecordByID(connectionId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));

        var vaultService = new Mock<IVaultService>();
        vaultService.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(document));
        vaultService
            .Setup(v => v.ReadIfPasswordMatchesAsync("senha-certa", It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<VaultDocument?, EVaultError>(document));
        vaultService
            .Setup(v => v.ReadIfPasswordMatchesAsync("senha-errada", It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<VaultDocument?, EVaultError>(null));

        var recorder = new SpyJournalRecorder();
        var handler = new RevealConnectionPasswordHandler(queries.Object, vaultService.Object, recorder);

        var okResult = await handler.Handle(new RevealConnectionPasswordCommand { ID = connectionId, Password = "senha-certa" }, CancellationToken.None);
        var errResult = await handler.Handle(new RevealConnectionPasswordCommand { ID = connectionId, Password = "senha-errada" }, CancellationToken.None);

        Assert.True(okResult.IsSuccess);
        Assert.True(errResult.IsFailure);
        Assert.Equal(2, recorder.Records.Count);

        var first = recorder.Records[0];
        Assert.Equal(EJournalKind.Security, first.Start.Kind);
        Assert.Equal(EJournalLevel.High, first.Start.Level);
        Assert.Equal("Senha da conexão revelada", first.Start.Action);
        Assert.Equal(EJournalOutcome.Ok, first.End.Outcome);
        Assert.Equal(connectionId, first.Start.Connection?.ConnectionId);

        var second = recorder.Records[1];
        Assert.Equal(EJournalKind.Security, second.Start.Kind);
        Assert.Equal(EJournalLevel.High, second.Start.Level);
        Assert.Equal("Senha da conexão revelada", second.Start.Action);
        Assert.Equal(EJournalOutcome.Error, second.End.Outcome);
        Assert.Equal("INVALID_PASSWORD", second.End.ErrorCode);
    }

    [Trait("AccountJournal", "FifthWrongPassword")]
    [Fact(DisplayName = "O quinto erro seguido de senha é gravado como Crítico antes de o cofre fechar")]
    public async Task FifthWrongPassword_RecordedBeforeLock_AsCritical()
    {
        var vaultOptions = Options.Create(new VaultOptions
        {
            DataDirectory = _tempDir,
            MemoryKiB = 8,
            Iterations = 1,
            Parallelism = 1
        });
        var fileClient = new VaultFileClient(vaultOptions, Logger.None);
        using var vaultService = new VaultService(fileClient, vaultOptions, VaultCrypto.DeriveKey, VaultCrypto.NewKey, Logger.None);

        var created = await vaultService.CreateAsync("marina.costa", "senha-correta-123", CancellationToken.None);
        Assert.True(created.IsSuccess);

        var connectionId = Guid.NewGuid();
        var record = CreateConnectionRecord(connectionId, readOnly: false, confirmCommands: null);
        await vaultService.SaveAsync(doc => doc with { Connections = [record] }, CancellationToken.None);

        var queries = new Mock<IConnectionQueries>();
        queries
            .Setup(q => q.GetRecordByID(connectionId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => vaultService.Read().Map(doc => (VaultConnectionRecord?)doc.Connections.FirstOrDefault(c => c.ID == connectionId)));

        var events = new List<string>();
        var recorder = new SpyJournalRecorder(onRecord: (start, _) => events.Add($"record:{start.Level}:{start.Action}:unlocked={vaultService.IsUnlocked}"));
        vaultService.FifthFailedVerification += () => recorder.Record(
            new JournalEntryStart(DateTimeOffset.UtcNow, EJournalKind.Security, "Quinto erro de senha", EJournalLevel.Critical, "Quinto erro seguido de senha: o cofre foi fechado."),
            new JournalEntryEnd(DateTimeOffset.UtcNow, 0, EJournalOutcome.Error, ErrorCode: "VAULT_LOCKED"));
        vaultService.Locked += () => events.Add("vault:Locked");

        var handler = new RevealConnectionPasswordHandler(queries.Object, vaultService, recorder);

        for (var i = 1; i <= 4; i++)
        {
            var attempt = await handler.Handle(new RevealConnectionPasswordCommand { ID = connectionId, Password = $"errada-{i}" }, CancellationToken.None);
            Assert.True(attempt.IsFailure);
            Assert.Equal("INVALID_PASSWORD", attempt.Error.Type);
            Assert.True(vaultService.IsUnlocked);
        }

        var fifth = await handler.Handle(new RevealConnectionPasswordCommand { ID = connectionId, Password = "errada-5" }, CancellationToken.None);
        Assert.True(fifth.IsFailure);
        Assert.Equal("VAULT_LOCKED", fifth.Error.Type);
        Assert.False(vaultService.IsUnlocked);

        var criticalIdx = events.IndexOf("record:Critical:Quinto erro de senha:unlocked=True");
        var lockedIdx = events.IndexOf("vault:Locked");
        Assert.True(criticalIdx >= 0, $"Eventos observados: {string.Join(", ", events)}");
        Assert.True(lockedIdx > criticalIdx, $"O registro Crítico precisa acontecer antes do bloqueio do cofre. Eventos: {string.Join(", ", events)}");
    }

    [Trait("AccountJournal", "Protections")]
    [Fact(DisplayName = "Desligar somente leitura grava Alto e ligar grava Informativo")]
    public async Task ReadOnlyTurnedOff_IsHigh_TurnedOn_IsInfo()
    {
        var connectionId = Guid.NewGuid();
        var currentRecord = CreateConnectionRecord(connectionId, readOnly: true, confirmCommands: null);

        var queries = new Mock<IConnectionQueries>();
        queries
            .Setup(q => q.GetRecordByID(connectionId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => Result.Success<VaultConnectionRecord?, EVaultError>(currentRecord));

        var repository = new Mock<IConnectionRepository>();
        repository
            .Setup(r => r.Update(It.IsAny<Prism.Application.Connections.Domain.Connection>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Prism.Application.Connections.Domain.Connection updated, string? _, string? _, CancellationToken _) =>
            {
                currentRecord = currentRecord with { ReadOnly = updated.ReadOnly ? true : null, ConfirmCommands = updated.ConfirmCommands };
                return Result.Success<EffectiveProtections, ApiErrorDto>(new EffectiveProtections(updated.ReadOnly, null, updated.ConfirmCommands, null));
            });

        var recorder = new SpyJournalRecorder();
        var handler = new UpdateConnectionHandler(queries.Object, repository.Object, TimeProvider.System, null, recorder);

        var offResult = await handler.Handle(new UpdateConnectionCommand
        {
            ID = connectionId,
            Name = currentRecord.Name,
            Engine = currentRecord.Engine,
            Host = currentRecord.Host,
            Port = currentRecord.Port,
            Database = currentRecord.Database,
            UserName = currentRecord.UserName,
            ReadOnly = false,
            UserPassword = "senha"
        }, CancellationToken.None);

        var onResult = await handler.Handle(new UpdateConnectionCommand
        {
            ID = connectionId,
            Name = currentRecord.Name,
            Engine = currentRecord.Engine,
            Host = currentRecord.Host,
            Port = currentRecord.Port,
            Database = currentRecord.Database,
            UserName = currentRecord.UserName,
            ReadOnly = true,
            UserPassword = "senha"
        }, CancellationToken.None);

        Assert.True(offResult.IsSuccess);
        Assert.True(onResult.IsSuccess);
        Assert.Equal(2, recorder.Records.Count);

        Assert.Equal(EJournalLevel.High, recorder.Records[0].Start.Level);
        Assert.Equal("Somente leitura desligado", recorder.Records[0].Start.Action);

        Assert.Equal(EJournalLevel.Info, recorder.Records[1].Start.Level);
        Assert.Equal("Somente leitura ligado", recorder.Records[1].Start.Action);
    }

    [Trait("AccountJournal", "Protections")]
    [Fact(DisplayName = "Afrouxar confirmação de comandos grava nível Alto")]
    public async Task ConfirmationLoosened_IsHigh()
    {
        var connectionId = Guid.NewGuid();
        var currentRecord = CreateConnectionRecord(connectionId, readOnly: false, confirmCommands: ProtectionRules.ConfirmAll);

        var queries = new Mock<IConnectionQueries>();
        queries
            .Setup(q => q.GetRecordByID(connectionId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => Result.Success<VaultConnectionRecord?, EVaultError>(currentRecord));

        var repository = new Mock<IConnectionRepository>();
        repository
            .Setup(r => r.Update(It.IsAny<Prism.Application.Connections.Domain.Connection>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Prism.Application.Connections.Domain.Connection updated, string? _, string? _, CancellationToken _) =>
            {
                currentRecord = currentRecord with { ConfirmCommands = updated.ConfirmCommands };
                return Result.Success<EffectiveProtections, ApiErrorDto>(new EffectiveProtections(updated.ReadOnly, null, updated.ConfirmCommands, null));
            });

        var recorder = new SpyJournalRecorder();
        var handler = new UpdateConnectionHandler(queries.Object, repository.Object, TimeProvider.System, null, recorder);

        var loosened = await handler.Handle(new UpdateConnectionCommand
        {
            ID = connectionId,
            Name = currentRecord.Name,
            Engine = currentRecord.Engine,
            Host = currentRecord.Host,
            Port = currentRecord.Port,
            Database = currentRecord.Database,
            UserName = currentRecord.UserName,
            ConfirmCommands = ProtectionRules.ConfirmIrreversible
        }, CancellationToken.None);

        Assert.True(loosened.IsSuccess);
        var entry = Assert.Single(recorder.Records);
        Assert.Equal(EJournalLevel.High, entry.Start.Level);
        Assert.Equal("Confirmação afrouxada", entry.Start.Action);
    }

    [Trait("AccountJournal", "ExportConnections")]
    [Fact(DisplayName = "Exportar conexões com senhas grava nível Alto")]
    public async Task ExportConnectionsWithPasswords_IsHigh()
    {
        var connectionId = Guid.NewGuid();
        var record = CreateConnectionRecord(connectionId, readOnly: false, confirmCommands: null);
        var document = new VaultDocument("marina.costa", [], [record], [], VaultWorkspaceRecord.Empty, []);

        var vaultService = new Mock<IVaultService>();
        vaultService.SetupGet(v => v.Generation).Returns(1L);
        vaultService.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(document));
        vaultService
            .Setup(v => v.ReadIfPasswordMatchesAsync("senha-prism", It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<VaultDocument?, EVaultError>(document));

        var fileService = new Mock<IConnectionFileService>();
        fileService
            .Setup(f => f.SealAsync(It.IsAny<It.IsAnyType>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync("prism-connections|cifrado");

        var recorder = new SpyJournalRecorder();
        var handler = new ExportConnectionsHandler(vaultService.Object, fileService.Object, Logger.None, recorder);

        var exported = await handler.Handle(new ExportConnectionsCommand
        {
            Connections = [new ExportConnectionChoice { ID = connectionId, Credentials = "userAndPassword" }],
            Passphrase = "senha-exportacao-forte",
            UserPassword = "senha-prism"
        }, CancellationToken.None);

        Assert.True(exported.IsSuccess);
        var entry = Assert.Single(recorder.Records);
        Assert.Equal(EJournalKind.Security, entry.Start.Kind);
        Assert.Equal(EJournalLevel.High, entry.Start.Level);
        Assert.Equal("Exportação de conexões com senhas", entry.Start.Action);
        Assert.Equal(EJournalOutcome.Ok, entry.End.Outcome);
    }

    [Trait("AccountJournal", "DeleteConnection")]
    [Fact(DisplayName = "Excluir conexão grava nível Atenção com retrato da conexão")]
    public async Task ConnectionDeleted_IsWarning()
    {
        var connectionId = Guid.NewGuid();
        var record = CreateConnectionRecord(connectionId, readOnly: false, confirmCommands: null);
        var document = new VaultDocument("marina.costa", [], [record], [], VaultWorkspaceRecord.Empty, []);

        var repository = new Mock<IConnectionRepository>();
        repository
            .Setup(r => r.Delete(connectionId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(UnitResult.Success<ApiErrorDto>());

        var vaultService = new Mock<IVaultService>();
        vaultService.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(document));

        var recorder = new SpyJournalRecorder();
        var handler = new DeleteConnectionHandler(
            repository.Object,
            Mock.Of<IDatabaseSessionService>(),
            Mock.Of<ITransferService>(),
            vaultService.Object,
            recorder);

        var deleted = await handler.Handle(new DeleteConnectionCommand(connectionId), CancellationToken.None);

        Assert.True(deleted.IsSuccess);
        var entry = Assert.Single(recorder.Records);
        Assert.Equal(EJournalKind.Connections, entry.Start.Kind);
        Assert.Equal(EJournalLevel.Warning, entry.Start.Level);
        Assert.Equal("Conexão excluída", entry.Start.Action);
        Assert.Equal(connectionId, entry.Start.Connection?.ConnectionId);
        Assert.Equal("MES Produção", entry.Start.Connection?.Name);
    }

    private static VaultConnectionRecord CreateConnectionRecord(Guid id, bool readOnly, string? confirmCommands)
        => new(
            id,
             null,
            "MES Produção",
            EDatabaseEngine.PostgreSql,
            "localhost",
            5432,
            "mes_prod",
            "app",
            "segredo-banco",
            "Produção",
            "#E5484D",
            DateTime.UtcNow,
            DateTime.UtcNow,
            ConfirmCommands: confirmCommands,
            ReadOnly: readOnly ? true : null);

    private sealed class SpyJournalRecorder(Action<JournalEntryStart, JournalEntryEnd>? onRecord = null) : IJournalRecorder
    {
        private long _nextId;

        public List<(JournalEntryStart Start, JournalEntryEnd End)> Records { get; } = [];

        public long Begin(JournalEntryStart start)
            => Interlocked.Increment(ref _nextId);

        public void Complete(long id, JournalEntryEnd end)
        {
        }

        public void Record(JournalEntryStart start, JournalEntryEnd end)
        {
            Records.Add((start, end));
            onRecord?.Invoke(start, end);
        }
    }

    private sealed class ManualTimeProvider(DateTimeOffset initial) : TimeProvider
    {
        private DateTimeOffset _now = initial;

        public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.CreateCustomTimeZone("BRT", TimeSpan.FromHours(-3), "BRT", "BRT");

        public override DateTimeOffset GetUtcNow()
            => _now.ToUniversalTime();

        public void Set(DateTimeOffset value)
            => _now = value;
    }
}
