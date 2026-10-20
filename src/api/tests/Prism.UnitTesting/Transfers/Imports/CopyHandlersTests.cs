using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Queries;
using Prism.Application.Transfers.Features.PreviewCopy;
using Prism.Application.Transfers.Features.StartCopy;
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
/// RN-IMPORT-023, 024 e 027: a prévia e o começo da cópia para outro banco, antes de tocar nos bancos: a posição do mapeamento, a origem nas regras da
/// exportação, o destino (com o somente leitura dele) e a tabela de destino que é a própria origem; e a contagem obrigatória do Db2 e do Informix com a
/// origem e o destino no mesmo banco.
/// </summary>
public sealed class CopyHandlersTests
{
    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IVaultService> _vaultService = new();
    private readonly Mock<IDriverService> _driverService = new();
    private readonly Mock<IImportPreviewService> _importPreviewService = new();
    private readonly Mock<ITransferService> _transferService = new();
    private readonly Guid _jobID = Guid.CreateVersion7();
    private VaultConnectionRecord _source = VaultFakers.CreateConnection(host: "origem.invalid", userName: "leitor", password: "segredo", engine: EDatabaseEngine.PostgreSql) with { Port = 5432, Database = "loja" };
    private VaultConnectionRecord _target = VaultFakers.CreateConnection(host: "destino.invalid", userName: "gravador", password: "segredo", engine: EDatabaseEngine.PostgreSql) with { Port = 5432, Database = "dw" };
    private CopyJob? _job;
    private CopyPreviewRequest? _preview;

    public CopyHandlersTests()
    {
        _vaultService.SetupGet(vault => vault.Generation).Returns(9);
        _connectionQueries.Setup(queries => queries.GetRecordByID(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync((Guid id, CancellationToken _) => Result.Success<VaultConnectionRecord?, EVaultError>(id == _source.ID ? _source : id == _target.ID ? _target : null));
        _connectionQueries.Setup(queries => queries.IsReadOnly(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<bool?, EVaultError>(false));
        _transferService.Setup(service => service.StartCopy(It.IsAny<CopyJob>())).Callback((CopyJob job) => _job = job).Returns(Result.Success<Guid, ETransferStartFailure>(_jobID));
        _importPreviewService.Setup(service => service.PreviewCopyAsync(It.IsAny<CopyPreviewRequest>(), It.IsAny<CancellationToken>()))
            .Callback((CopyPreviewRequest request, CancellationToken _) => _preview = request)
            .ReturnsAsync(Result.Success<CopyPreview, ImportPreviewFailure>(new CopyPreview(new ImportTargetTable("dw", "pedido_hist", false, [], []), [new ImportMappingEntry(0, "id")])));
    }

    private StartCopyHandler CreateStart()
        => new(_connectionQueries.Object, _vaultService.Object, _driverService.Object, _transferService.Object);

    private PreviewCopyHandler CreatePreview()
        => new(_connectionQueries.Object, _driverService.Object, _importPreviewService.Object);

    private ExportSourceDto TableSource(string table = "pedido")
        => new() { Kind = "table", ConnectionID = _source.ID, Schema = "loja", Table = table };

    private ImportTargetDto TargetTable(Guid? connectionID = null, string schema = "dw", string table = "pedido_hist")
        => new() { ConnectionID = connectionID ?? _target.ID, Schema = schema, Table = table };

    private StartCopyCommand Start(ExportSourceDto? source = null, ImportTargetDto? target = null, IReadOnlyList<ImportMappingDto?>? mapping = null, bool count = false)
        => new()
        {
            Source = source ?? TableSource(),
            Columns = [new ExportColumnDto { Position = 1, Name = "nome" }, new ExportColumnDto { Position = 0, Name = "id" }],
            Count = count,
            Target = target ?? TargetTable(),
            Mapping = mapping ?? [new ImportMappingDto { Source = 1, Target = "id" }, new ImportMappingDto { Source = 0, Target = "nome" }],
            Load = JsonDocument.Parse("""{"empty": true, "commitEvery": 500}""").RootElement.Clone(),
            WindowID = 2
        };

    [Trait("StartCopyHandler", "StartCopyCommand")]
    [Fact(DisplayName = "OK a cópia começa com as duas conexões, o SELECT da tabela de origem, as colunas na ordem do pedido e a carga")]
    public async Task Start_ShouldStartTheCopy()
    {
        //Act
        var result = await CreateStart().Handle(Start(count: true), CancellationToken.None);

        //Assert
        Assert.Equal(new TransferStartedDto(_jobID), result.Value);
        Assert.Equal((_source.ID, _target.ID, 9L, 2L), (_job!.SourceConnectionID, _job.TargetConnectionID, _job.VaultGeneration, _job.WindowID));
        Assert.Equal("SELECT \"id\", \"nome\" FROM \"loja\".\"pedido\"", _job.Sql);
        Assert.Equal([new ExportColumnChoice(1, "nome"), new ExportColumnChoice(0, "id")], _job.Columns);
        Assert.Equal((false, true, false), (_job.CheckColumns, _job.Count, _job.ForcedCount));
        Assert.Equal(("dw", "pedido_hist", "dw"), (_job.Schema, _job.Table, _job.TargetSettings.Database));
        Assert.Equal([new ImportMappingEntry(1, "id"), new ImportMappingEntry(0, "nome")], _job.Mapping);
        Assert.Equal(new LoadSettings(true, 500, false), _job.Load);
    }

    /// <summary>RN-IMPORT-023: no Db2 e no Informix com a origem e o destino no mesmo servidor, porta e banco de dados, a contagem é obrigatória.</summary>
    [Trait("StartCopyHandler", "StartCopyCommand")]
    [Theory(DisplayName = "OK a contagem é obrigatória no Db2 e no Informix com a origem e o destino no mesmo banco")]
    [InlineData(EDatabaseEngine.Db2, "ORIGEM.INVALID", true)]
    [InlineData(EDatabaseEngine.Informix, "origem.invalid", true)]
    [InlineData(EDatabaseEngine.PostgreSql, "origem.invalid", false)]
    [InlineData(EDatabaseEngine.Db2, "outro.invalid", false)]
    public async Task Start_SameIbmDatabase_ShouldForceTheCount(EDatabaseEngine engine, string targetHost, bool forced)
    {
        //Arrange
        _source = _source with { Engine = engine };
        _target = _target with { Engine = engine, Host = targetHost, Database = "loja" };

        //Act
        await CreateStart().Handle(Start(), CancellationToken.None);

        //Assert
        Assert.Equal((false, forced), (_job!.Count, _job.ForcedCount));
    }

    /// <summary>RN-IMPORT-023: a tabela de destino que é a própria origem, também por outra conexão ao mesmo servidor, porta e banco de dados.</summary>
    [Trait("StartCopyHandler", "StartCopyCommand")]
    [Fact(DisplayName = "Erro a tabela de destino que é a própria origem é recusada, pela mesma conexão e por outra ao mesmo banco")]
    public async Task Start_TargetIsTheSource_ShouldBeRefused()
    {
        //Arrange
        _target = _target with { Host = "ORIGEM.invalid", Database = "loja" };

        //Act
        var sameConnection = await CreateStart().Handle(Start(target: TargetTable(_source.ID, "loja", "pedido")), CancellationToken.None);
        var otherConnection = await CreateStart().Handle(Start(target: TargetTable(schema: "loja", table: "pedido")), CancellationToken.None);
        var otherTable = await CreateStart().Handle(Start(target: TargetTable(schema: "loja", table: "pedido_hist")), CancellationToken.None);

        //Assert
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "IMPORT_TARGET_IS_SOURCE"), (sameConnection.Error.StatusCode, sameConnection.Error.Type));
        Assert.Equal("A tabela de destino é a própria origem. Escolha outra tabela.", sameConnection.Error.Detail);
        Assert.Equal("IMPORT_TARGET_IS_SOURCE", otherConnection.Error.Type);
        Assert.True(otherTable.IsSuccess);
    }

    [Trait("StartCopyHandler", "StartCopyCommand")]
    [Fact(DisplayName = "Erro a posição do mapeamento além das colunas pedidas vem antes das conexões, no campo")]
    public async Task Start_MappingBeyondTheColumns_ShouldBeRefusedFirst()
    {
        //Act
        var result = await CreateStart().Handle(Start(mapping: [new ImportMappingDto { Source = 0, Target = "id" }, new ImportMappingDto { Source = 2, Target = "nome" }]), CancellationToken.None);

        //Assert
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "IMPORT_MAPPING_INVALID"), (result.Error.StatusCode, result.Error.Type));
        Assert.Equal(["A coluna 3 da origem não existe: foram pedidas 2 colunas."], ((Dictionary<string, string[]>)result.Error.Extensions["errors"]!)["mapping[1].source"]);
        _connectionQueries.Verify(queries => queries.GetRecordByID(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>RN-IMPORT-025: a conexão sem usuário ou sem senha diz o lado, no campo dele.</summary>
    [Trait("StartCopyHandler", "StartCopyCommand")]
    [Theory(DisplayName = "Erro a conexão sem usuário ou sem senha diz o lado, no campo")]
    [InlineData(true, true, "source.userName", "A conexão de origem não tem usuário gravado. Preencha-o em Editar conexão e copie de novo.")]
    [InlineData(false, false, "target.password", "A conexão de destino não tem senha gravada. Preencha-a em Editar conexão e copie de novo.")]
    public async Task Start_MissingCredentials_ShouldSayTheSide(bool source, bool userName, string field, string message)
    {
        //Arrange
        if (source)
            _source = _source with { UserName = userName ? string.Empty : _source.UserName, Password = userName ? _source.Password : string.Empty };
        else
            _target = _target with { UserName = userName ? string.Empty : _target.UserName, Password = userName ? _target.Password : string.Empty };

        //Act
        var result = await CreateStart().Handle(Start(), CancellationToken.None);

        //Assert
        Assert.Equal("CONNECTION_CREDENTIALS_MISSING", result.Error.Type);
        Assert.Equal([message], ((Dictionary<string, string[]>)result.Error.Extensions["errors"]!)[field]);
    }

    /// <summary>RN-PROT-002: o destino somente leitura é recusado; a origem só é lida, e a proteção dela não é consultada.</summary>
    [Trait("StartCopyHandler", "StartCopyCommand")]
    [Fact(DisplayName = "Erro o destino somente leitura é recusado, e a origem somente leitura vale")]
    public async Task Start_ReadOnlyTarget_ShouldBeRefused()
    {
        //Arrange
        _connectionQueries.Setup(queries => queries.IsReadOnly(_target.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<bool?, EVaultError>(true));

        //Act
        var result = await CreateStart().Handle(Start(), CancellationToken.None);

        //Assert
        Assert.Equal("CONNECTION_READ_ONLY", result.Error.Type);
        _connectionQueries.Verify(queries => queries.IsReadOnly(_source.ID, It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>RN-EXPORT-016: a origem dos Registros e do resultado tem as recusas da exportação, sem ir ao banco.</summary>
    [Trait("StartCopyHandler", "StartCopyCommand")]
    [Fact(DisplayName = "Erro o comando da origem que não é uma leitura é recusado como na exportação")]
    public async Task Start_SourceThatWrites_ShouldBeRefused()
    {
        //Act
        var result = await CreateStart().Handle(Start(source: new ExportSourceDto { Kind = "query", ConnectionID = _source.ID, Sql = "DELETE FROM loja.pedido" }), CancellationToken.None);

        //Assert
        Assert.Equal("EXPORT_SOURCE_NOT_READ", result.Error.Type);
        _transferService.Verify(service => service.StartCopy(It.IsAny<CopyJob>()), Times.Never);
    }

    /// <summary>RN-VAR-032 e RN-GRADE-011: o filtro do resultado não tem marcador quando o comando leva `source.params`, como no `queries` e na exportação.</summary>
    [Trait("StartCopyHandler", "StartCopyCommand")]
    [Fact(DisplayName = "Erro o filtro com marcador de parâmetro, com source.params, é FILTER_INVALID, e a cópia não começa")]
    public async Task Start_FilterWithMarkerAndParameters_ShouldBeRefused()
    {
        //Arrange
        var source = new ExportSourceDto { Kind = "query", ConnectionID = _source.ID, Sql = "SELECT id FROM loja.pedido WHERE a = $1", Filter = "b = $2", Params = JsonDocument.Parse("""[{"type":"number","value":"1"},{"type":"number","value":"2"}]""").RootElement.Clone() };

        //Act
        var result = await CreateStart().Handle(Start(source: source), CancellationToken.None);

        //Assert
        Assert.Equal("FILTER_INVALID", result.Error.Type);
        _transferService.Verify(service => service.StartCopy(It.IsAny<CopyJob>()), Times.Never);
    }

    [Trait("StartCopyHandler", "StartCopyCommand")]
    [Fact(DisplayName = "Erro a tabela ocupada por outra cópia é 409")]
    public async Task Start_Busy_ShouldBeConflict()
    {
        //Arrange
        _transferService.Setup(service => service.StartCopy(It.IsAny<CopyJob>())).Returns(Result.Failure<Guid, ETransferStartFailure>(ETransferStartFailure.CopyBusy));

        //Act
        var result = await CreateStart().Handle(Start(), CancellationToken.None);

        //Assert
        Assert.Equal((HttpStatusCode.Conflict, "IMPORT_TARGET_BUSY"), (result.Error.StatusCode, result.Error.Type));
        Assert.Equal("Já há uma cópia para dw.pedido_hist em andamento. Espere ela terminar, ou cancele-a na barra de status.", result.Error.Detail);
    }

    [Trait("PreviewCopyHandler", "PreviewCopyCommand")]
    [Fact(DisplayName = "OK a prévia da cópia lê só o destino, com os nomes das colunas pedidas para o mapeamento automático")]
    public async Task Preview_ShouldDescribeTheTarget()
    {
        //Act
        var result = await CreatePreview().Handle(new PreviewCopyCommand { Source = TableSource(), Columns = [new ExportColumnDto { Position = 0, Name = "id" }], Target = TargetTable() }, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(("dw", "pedido_hist", "pedido_hist"), (_preview!.Schema, _preview.Table, result.Value.Table.Name));
        Assert.Equal(["id"], _preview.SourceColumns);
        Assert.Null(_preview.Mapping);
        Assert.Equal(new ConnectionSettings(EDatabaseEngine.PostgreSql, "destino.invalid", 5432, "dw", "gravador", "segredo"), _preview.Settings);
    }

    [Trait("PreviewCopyHandler", "PreviewCopyCommand")]
    [Fact(DisplayName = "Erro a prévia recusa a tabela de destino que é a própria origem")]
    public async Task Preview_TargetIsTheSource_ShouldBeRefused()
    {
        //Act
        var result = await CreatePreview().Handle(new PreviewCopyCommand { Source = TableSource(), Columns = [new ExportColumnDto { Position = 0, Name = "id" }], Target = TargetTable(_source.ID, "loja", "pedido") }, CancellationToken.None);

        //Assert
        Assert.Equal("IMPORT_TARGET_IS_SOURCE", result.Error.Type);
        _importPreviewService.Verify(service => service.PreviewCopyAsync(It.IsAny<CopyPreviewRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
