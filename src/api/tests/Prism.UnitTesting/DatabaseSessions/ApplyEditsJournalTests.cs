using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Features.ApplyEdits;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Text.Json;

namespace Prism.UnitTesting.DatabaseSessions;

/// <summary>
/// RN-AUDIT-002 e 005: cada "Salvar" das pendências grava um único registro de Edição; a alteração na coluna inteira (RN-EDIT-019) sobe para nível Alto.
/// </summary>
public sealed class ApplyEditsJournalTests
{
    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();
    private readonly Mock<IVaultService> _vaultService = new();
    private readonly Mock<IJournalRecorder> _journal = new();
    private readonly List<JournalEntryStart> _starts = [];
    private readonly List<(long ID, JournalEntryEnd End)> _ends = [];
    private long _nextEntryID = 200;

    public ApplyEditsJournalTests()
    {
        _journal.Setup(recorder => recorder.Begin(It.IsAny<JournalEntryStart>())).Callback((JournalEntryStart start) => _starts.Add(start)).Returns(() => ++_nextEntryID);
        _journal.Setup(recorder => recorder.Complete(It.IsAny<long>(), It.IsAny<JournalEntryEnd>())).Callback((long id, JournalEntryEnd end) => _ends.Add((id, end)));
    }

    private ApplyEditsHandler CreateHandler()
        => new(_connectionQueries.Object, _databaseSessionService.Object, _vaultService.Object, _journal.Object);

    [Trait("ApplyEditsHandler", "Journal")]
    [Fact(DisplayName = "OK grava um único registro por Salvar, Atenção nas linhas e Alto na coluna inteira")]
    public async Task ApplyEdits_OneEntryPerSave_WholeColumnIsHigh()
    {
        //Arrange
        var (sessionID, resultID) = (Guid.CreateVersion7(), Guid.CreateVersion7());
        var connection = VaultFakers.CreateConnection(name: "MES Produção", engine: EDatabaseEngine.PostgreSql, database: "mes_prod", environmentName: "Produção", environmentColor: "red");
        _vaultService.Setup(vault => vault.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument { Connections = [connection] }));
        _databaseSessionService.Setup(service => service.ConnectionOf(sessionID)).Returns(connection.ID);
        _databaseSessionService.Setup(service => service.InfoOf(sessionID)).Returns(new DatabaseSessionInfo(sessionID, connection.ID, EDatabaseEngine.PostgreSql, "mes_prod", "16.2"));
        _connectionQueries.Setup(queries => queries.IsReadOnly(connection.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<bool?, EVaultError>(false));
        _databaseSessionService.SetupSequence(service => service.ApplyEditsAsync(sessionID, resultID, It.IsAny<IReadOnlyList<EditChange>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<int, DatabaseFailure>(2))
            .ReturnsAsync(Result.Success<int, DatabaseFailure>(1));

        var rowSave = new ApplyEditsCommand
        {
            SessionID = sessionID,
            ResultID = resultID,
            Changes =
            [
                new EditChangeDto { Kind = "update", Table = 0, Key = ["10"], Set = [new EditValueDto(1, "fechado")] },
                new EditChangeDto { Kind = "delete", Table = 0, Key = ["11"] }
            ]
        };

        var wholeColumnSave = new ApplyEditsCommand
        {
            SessionID = sessionID,
            ResultID = resultID,
            Changes =
            [
                new EditChangeDto { Kind = "updateAll", Table = 0, Set = [new EditValueDto(1, "cancelado")], Rows = JsonDocument.Parse("8410").RootElement.Clone() }
            ]
        };

        //Act
        var first = await CreateHandler().Handle(rowSave, CancellationToken.None);
        var second = await CreateHandler().Handle(wholeColumnSave, CancellationToken.None);

        //Assert
        Assert.True(first.IsSuccess);
        Assert.True(second.IsSuccess);
        Assert.Equal(2, _starts.Count);

        Assert.Equal((EJournalKind.Edit, EJournalLevel.Warning, "Salvar edições", false), (_starts[0].Kind, _starts[0].Level, _starts[0].Action, _starts[0].Confirmed));
        Assert.DoesNotContain("fechado", _starts[0].Sql ?? string.Empty);
        Assert.Equal(new JournalEntryEnd(EJournalOutcome.Ok, 2, null, null, null), _ends[0].End);

        Assert.Equal((EJournalKind.Edit, EJournalLevel.High, "Salvar da coluna inteira", true), (_starts[1].Kind, _starts[1].Level, _starts[1].Action, _starts[1].Confirmed));
        Assert.DoesNotContain("cancelado", _starts[1].Sql ?? string.Empty);
        Assert.Equal(new JournalEntryEnd(EJournalOutcome.Ok, 8410, null, null, null), _ends[1].End);
    }
}
