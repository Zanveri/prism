using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Queries;
using Prism.Application.Transfers.Features.StartExport;
using Prism.Application.Transfers.Features.StartImport;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Drivers.Services;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Text.Json;

namespace Prism.UnitTesting.Transfers;

/// <summary>
/// RN-AUDIT-002 e 005: a exportação e a importação de dados gravam um registro do tipo Dados, sem o nome do arquivo; a importação que esvazia a tabela
/// antes (`empty: true`) sobe para o nível Crítico.
/// </summary>
public sealed class TransferJournalTests
{
    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IVaultService> _vaultService = new();
    private readonly Mock<IDriverService> _driverService = new();
    private readonly Mock<IImportPreviewService> _importPreviewService = new();
    private readonly Mock<ITransferService> _transferService = new();
    private readonly Mock<IJournalRecorder> _journal = new();
    private readonly VaultConnectionRecord _record = VaultFakers.CreateConnection(name: "MES Produção", host: "db.invalid", userName: "leitor", password: "segredo", engine: EDatabaseEngine.PostgreSql, database: "mes_prod", environmentName: "Produção", environmentColor: "red");
    private readonly List<JournalEntryStart> _starts = [];

    public TransferJournalTests()
    {
        _vaultService.SetupGet(vault => vault.Generation).Returns(1);
        _vaultService.Setup(vault => vault.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument { Connections = [_record] }));
        _connectionQueries.Setup(queries => queries.GetRecordByID(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(_record));
        _connectionQueries.Setup(queries => queries.IsReadOnly(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<bool?, EVaultError>(false));
        _transferService.Setup(service => service.StartExport(It.IsAny<ExportJob>())).Returns(Result.Success<Guid, ETransferStartFailure>(Guid.CreateVersion7()));
        _transferService.Setup(service => service.StartImport(It.IsAny<ImportJob>())).Returns(Result.Success<Guid, ETransferStartFailure>(Guid.CreateVersion7()));
        _journal.Setup(recorder => recorder.Begin(It.IsAny<JournalEntryStart>())).Callback((JournalEntryStart start) => _starts.Add(start)).Returns(301);
    }

    [Trait("StartExportHandler", "Journal")]
    [Fact(DisplayName = "OK a exportação grava o comando e a conexão no diário, sem o nome do arquivo")]
    public async Task Export_RecordsWithoutFileName()
    {
        //Arrange
        const string secretFileName = "clientes-confidenciais-2026.csv";
        var handler = new StartExportHandler(_connectionQueries.Object, _vaultService.Object, _driverService.Object, _transferService.Object, _journal.Object);
        var command = new StartExportCommand
        {
            Source = new ExportSourceDto { Kind = "query", ConnectionID = _record.ID, Sql = "SELECT id, nome FROM public.clientes", Name = secretFileName },
            Columns = [new ExportColumnDto { Position = 0, Name = "id" }, new ExportColumnDto { Position = 1, Name = "nome" }],
            Format = "csv",
            Output = new ExportOutputDto { Zip = true, EntryName = secretFileName },
            WindowID = 1
        };

        //Act
        var result = await handler.Handle(command, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        var start = Assert.Single(_starts);
        Assert.Equal((EJournalKind.Data, EJournalLevel.Warning, "Exportação de dados"), (start.Kind, start.Level, start.Action));
        Assert.Equal("SELECT id, nome FROM public.clientes", start.Sql);
        Assert.DoesNotContain(secretFileName, start.Sql ?? string.Empty);
        Assert.DoesNotContain(secretFileName, start.Reason);
        Assert.DoesNotContain(secretFileName, start.Action);
    }

    [Trait("StartImportHandler", "Journal")]
    [Fact(DisplayName = "OK a importação que esvazia a tabela antes é gravada como Crítico")]
    public async Task Import_EmptyingTableFirst_IsCritical()
    {
        //Arrange
        var fileID = Guid.CreateVersion7();
        var handler = new StartImportHandler(_connectionQueries.Object, _vaultService.Object, _driverService.Object, _importPreviewService.Object, _transferService.Object, _journal.Object);
        var command = new StartImportCommand
        {
            FileID = fileID.ToString("D"),
            Format = "csv",
            Target = new ImportTargetDto { ConnectionID = _record.ID, Schema = "producao", Table = "apontamento" },
            Mapping = [new ImportMappingDto { Source = 0, Target = "id" }],
            Load = JsonDocument.Parse("{\"empty\":true,\"commitEvery\":1000,\"check\":false}").RootElement.Clone(),
            WindowID = 1
        };

        //Act
        var result = await handler.Handle(command, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        var start = Assert.Single(_starts);
        Assert.Equal((EJournalKind.Data, EJournalLevel.Critical, "Importação de dados"), (start.Kind, start.Level, start.Action));
        Assert.Contains("producao.apontamento", start.Reason);
        Assert.DoesNotContain(fileID.ToString("D"), start.Sql ?? string.Empty);
        Assert.DoesNotContain(fileID.ToString("D"), start.Reason);
    }
}
