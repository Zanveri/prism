using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Queries;
using Prism.Application.Transfers.Features.StartImport;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Drivers.Services;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Net;
using System.Text.Json;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// RN-IMPORT-014: o começo da importação, na ordem da regra e sem tocar no banco antes do 202: o arquivo, a conexão, o banco de dados, o usuário e a
/// senha, o driver e o somente leitura; depois o registro (o limite, a tabela ocupada, a troca de nome do arquivo) e a conexão lida de novo.
/// </summary>
public sealed class StartImportHandlerTests
{
    private const string FileID = "0192f3a4-5b6c-7d8e-9fa0-b1c2d3e4f5a6";

    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IVaultService> _vaultService = new();
    private readonly Mock<IDriverService> _driverService = new();
    private readonly Mock<IImportPreviewService> _importPreviewService = new();
    private readonly Mock<ITransferService> _transferService = new();
    private readonly VaultConnectionRecord _record = VaultFakers.CreateConnection(host: "db.invalid", userName: "gravador", password: "segredo", engine: EDatabaseEngine.PostgreSql);
    private readonly Guid _jobID = Guid.CreateVersion7();
    private ImportJob? _job;

    public StartImportHandlerTests()
    {
        _vaultService.SetupGet(vault => vault.Generation).Returns(4);
        _connectionQueries.Setup(queries => queries.GetRecordByID(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(() => Result.Success<VaultConnectionRecord?, EVaultError>(_record));
        _connectionQueries.Setup(queries => queries.IsReadOnly(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<bool?, EVaultError>(false));
        _transferService.Setup(service => service.StartImport(It.IsAny<ImportJob>()))
            .Callback((ImportJob job) => _job = job)
            .Returns(Result.Success<Guid, ETransferStartFailure>(_jobID));
    }

    private StartImportHandler CreateHandler()
        => new(_connectionQueries.Object, _vaultService.Object, _driverService.Object, _importPreviewService.Object, _transferService.Object);

    private StartImportCommand Command(string? database = null, string load = """{"empty": true, "commitEvery": null, "check": false}""")
        => new()
        {
            FileID = FileID,
            Format = "json",
            Reader = JsonDocument.Parse("""{"keys": ["id", "nome"]}""").RootElement.Clone(),
            Values = new ImportValuesDto { Decimal = "comma", Dates = "dayMonthYear" },
            Target = new ImportTargetDto { ConnectionID = _record.ID, Database = database, Schema = "estoque", Table = "pedido" },
            Mapping = [new ImportMappingDto { Source = 1, Target = "nome" }],
            Load = JsonDocument.Parse(load).RootElement.Clone(),
            WindowID = 3
        };

    [Trait("StartImportHandler", "StartImportCommand")]
    [Fact(DisplayName = "OK o trabalho começa com a conexão do cofre, o banco pedido, as opções, o mapeamento e a carga, e a resposta é o id")]
    public async Task Handle_ShouldStartTheJob()
    {
        //Act
        var result = await CreateHandler().Handle(Command("outro"), CancellationToken.None);

        //Assert
        Assert.Equal(new TransferStartedDto(_jobID), result.Value);
        Assert.Equal((Guid.Parse(FileID), _record.ID, 4L, 3L, "json"), (_job!.FileID, _job.ConnectionID, _job.VaultGeneration, _job.WindowID, _job.Format));
        Assert.Equal(new ConnectionSettings(EDatabaseEngine.PostgreSql, "db.invalid", _record.Port, "outro", "gravador", "segredo"), _job.Settings);
        Assert.Equal(["id", "nome"], ((JsonImportOptions)_job.Options).Keys!);
        Assert.Equal(new ImportValueFormats(EImportDecimal.Comma, false, EImportDates.DayMonthYear), _job.Formats);
        Assert.Equal(("estoque", "pedido"), (_job.Schema, _job.Table));
        Assert.Equal([new ImportMappingEntry(1, "nome")], _job.Mapping);
        Assert.Equal(new LoadSettings(true, null, false), _job.Load);
    }

    /// <summary>
    /// RN-PROT-006 e RN-IMPORT-014: o trabalho lê a proteção do destino no cofre a cada comando, pela conexão do pedido, e para como a sessão recusaria o
    /// comando: a conexão somente leitura, a excluída (antes de o cancelamento dela chegar) e o cofre que não responde.
    /// </summary>
    [Trait("StartImportHandler", "StartImportCommand")]
    [Theory(DisplayName = "OK o trabalho pergunta ao cofre, a cada comando, se a carga para, e por quê")]
    [InlineData(false, false, null)]
    [InlineData(true, false, ETransferCancelReason.ReadOnly)]
    [InlineData(null, false, ETransferCancelReason.ConnectionDeleted)]
    [InlineData(null, true, ETransferCancelReason.Person)]
    public async Task Handle_TheJob_ShouldAskTheVaultBeforeEachCommand(bool? readOnly, bool vaultFails, ETransferCancelReason? expected)
    {
        //Arrange
        await CreateHandler().Handle(Command(), CancellationToken.None);
        _connectionQueries.Setup(queries => queries.IsReadOnly(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(vaultFails ? Result.Failure<bool?, EVaultError>(EVaultError.Unavailable) : Result.Success<bool?, EVaultError>(readOnly));

        //Act
        var stop = await _job!.TargetStop(CancellationToken.None);

        //Assert
        Assert.Equal(expected, stop);
    }

    [Trait("StartImportHandler", "StartImportCommand")]
    [Theory(DisplayName = "Erro o arquivo que sumiu, ou que o sistema não deixa abrir, é o 404 da seção 6 e vem antes da conexão")]
    [InlineData(EImportFileRefusal.Missing)]
    [InlineData(EImportFileRefusal.Unreadable)]
    public async Task Handle_FileMissing_ShouldComeFirst(EImportFileRefusal kind)
    {
        //Arrange
        _importPreviewService.Setup(service => service.CheckFile(It.IsAny<Guid>())).Returns(new ImportFileRefusal(kind, Reason: kind == EImportFileRefusal.Unreadable ? "Não foi possível ler o arquivo copiado (código 5)." : null));

        //Act
        var result = await CreateHandler().Handle(Command(), CancellationToken.None);

        //Assert
        Assert.Equal((HttpStatusCode.NotFound, "IMPORT_FILE_MISSING"), (result.Error.StatusCode, result.Error.Type));
        _connectionQueries.Verify(queries => queries.GetRecordByID(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Trait("StartImportHandler", "StartImportCommand")]
    [Fact(DisplayName = "Erro a conexão somente leitura é recusada antes do registro, sem nada ir ao banco")]
    public async Task Handle_ReadOnly_ShouldBeRefused()
    {
        //Arrange
        _connectionQueries.Setup(queries => queries.IsReadOnly(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<bool?, EVaultError>(true));

        //Act
        var result = await CreateHandler().Handle(Command(), CancellationToken.None);

        //Assert
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "CONNECTION_READ_ONLY"), (result.Error.StatusCode, result.Error.Type));
        Assert.Equal("A conexão é somente leitura, e a importação grava na tabela. Nada foi enviado ao banco.", result.Error.Detail);
        _transferService.Verify(service => service.StartImport(It.IsAny<ImportJob>()), Times.Never);
    }

    [Trait("StartImportHandler", "StartImportCommand")]
    [Fact(DisplayName = "Erro a conexão sem senha é recusada no campo, com importe de novo")]
    public async Task Handle_WithoutPassword_ShouldBeRefusedOnTheField()
    {
        //Arrange
        var record = _record with { Password = string.Empty };
        _connectionQueries.Setup(queries => queries.GetRecordByID(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));

        //Act
        var result = await CreateHandler().Handle(Command(), CancellationToken.None);

        //Assert
        Assert.Equal("CONNECTION_CREDENTIALS_MISSING", result.Error.Type);
        Assert.Equal(["Esta conexão não tem senha gravada. Preencha-a em Editar conexão e importe de novo."], ((Dictionary<string, string[]>)result.Error.Extensions["errors"]!)["password"]);
    }

    /// <summary>RN-IMPORT-014: as recusas do registro, sob a trava: o limite, o cofre que mudou, a tabela ocupada por uma importação ou uma cópia e o arquivo que sumiu.</summary>
    [Trait("StartImportHandler", "StartImportCommand")]
    [Theory(DisplayName = "Erro as recusas do registro têm o código e a frase de cada uma")]
    [InlineData(ETransferStartFailure.LimitReached, HttpStatusCode.Conflict, "TRANSFER_LIMIT_REACHED", null)]
    [InlineData(ETransferStartFailure.VaultChanged, HttpStatusCode.Unauthorized, "VAULT_LOCKED", null)]
    [InlineData(ETransferStartFailure.ImportBusy, HttpStatusCode.Conflict, "IMPORT_TARGET_BUSY", "Já há uma importação para estoque.pedido em andamento. Espere ela terminar, ou cancele-a na barra de status.")]
    [InlineData(ETransferStartFailure.CopyBusy, HttpStatusCode.Conflict, "IMPORT_TARGET_BUSY", "Já há uma cópia para estoque.pedido em andamento. Espere ela terminar, ou cancele-a na barra de status.")]
    [InlineData(ETransferStartFailure.FileMissing, HttpStatusCode.NotFound, "IMPORT_FILE_MISSING", "O arquivo escolhido não está mais com o Prism. Escolha o arquivo de novo.")]
    public async Task Handle_RegistryRefusal_ShouldHaveItsCode(ETransferStartFailure failure, HttpStatusCode status, string code, string? detail)
    {
        //Arrange
        _transferService.Setup(service => service.StartImport(It.IsAny<ImportJob>())).Returns(Result.Failure<Guid, ETransferStartFailure>(failure));

        //Act
        var result = await CreateHandler().Handle(Command(), CancellationToken.None);

        //Assert
        Assert.Equal((status, code), (result.Error.StatusCode, result.Error.Type));
        if (detail is not null)
            Assert.Equal(detail, result.Error.Detail);
    }

    /// <summary>RN-CONN-014: a conexão excluída enquanto o trabalho entrava no registro: ele é cancelado e esquecido, e a resposta é 404.</summary>
    [Trait("StartImportHandler", "StartImportCommand")]
    [Fact(DisplayName = "Erro a conexão excluída no meio do começo não deixa o trabalho")]
    public async Task Handle_ConnectionDeletedWhileStarting_ShouldForgetTheJob()
    {
        //Arrange
        _connectionQueries.SetupSequence(queries => queries.GetRecordByID(_record.ID, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(_record))
            .ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(null));

        //Act
        var result = await CreateHandler().Handle(Command(), CancellationToken.None);

        //Assert
        Assert.Equal((HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND"), (result.Error.StatusCode, result.Error.Type));
        _transferService.Verify(service => service.DeleteAsync(_jobID), Times.Exactly(2));
    }
}
