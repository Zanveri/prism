using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Queries;
using Prism.Application.Transfers.Features.StartExport;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Drivers.Services;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Net;
using System.Text.Json;

namespace Prism.UnitTesting.Transfers;

/// <summary>
/// RN-EXPORT-016: o começo da exportação, na ordem da regra e sem tocar no banco: a conexão, o banco de dados, o usuário e a senha, o driver, o que depende
/// do banco (mais de um comando, o filtro, a leitura, as linhas por comando no Informix), e o limite e o cofre no registro. A geração do cofre é lida antes
/// das credenciais e vai ao registro.
/// </summary>
public sealed class StartExportHandlerTests
{
    private const long Generation = 7;

    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IVaultService> _vaultService = new();
    private readonly Mock<IDriverService> _driverService = new();
    private readonly Mock<ITransferService> _transferService = new();
    private readonly VaultConnectionRecord _record = VaultFakers.CreateConnection(host: "db.invalid", userName: "leitor", password: "segredo", engine: EDatabaseEngine.PostgreSql);
    private ExportJob? _job;

    public StartExportHandlerTests()
    {
        _vaultService.SetupGet(vault => vault.Generation).Returns(Generation);
        _connectionQueries.Setup(queries => queries.GetRecordByID(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(() => Result.Success<VaultConnectionRecord?, EVaultError>(_record));
        _transferService.Setup(service => service.StartExport(It.IsAny<ExportJob>())).Callback((ExportJob job) => _job = job).Returns(Result.Success<Guid, ETransferStartFailure>(Guid.CreateVersion7()));
    }

    private StartExportHandler CreateHandler()
        => new(_connectionQueries.Object, _vaultService.Object, _driverService.Object, _transferService.Object);

    private StartExportCommand TableCommand(VaultConnectionRecord? record = null)
        => new()
        {
            Source = new ExportSourceDto { Kind = "table", ConnectionID = (record ?? _record).ID, Schema = "estoque", Table = "pe\"dido" },
            Columns = [new ExportColumnDto { Position = 1, Name = "cliente" }, new ExportColumnDto { Position = 0, Name = "id" }],
            Count = true,
            Format = "csv",
            Output = new ExportOutputDto { Bom = true },
            WindowID = 2
        };

    private StartExportCommand QueryCommand(string sql, string? filter = null, string format = "csv", JsonElement? options = null)
        => new()
        {
            Source = new ExportSourceDto { Kind = "query", ConnectionID = _record.ID, Sql = sql, Filter = filter, Name = "pedido", Database = "outro" },
            Columns = [new ExportColumnDto { Position = 0, Name = "id" }],
            Format = format,
            Options = options,
            Output = new ExportOutputDto { Zip = true, EntryName = "pedido.csv" },
            WindowID = 3
        };

    /// <summary>RN-EXPORT-002: a tabela pelo navegador exporta o `SELECT` das colunas marcadas, na ordem da posição, com os nomes entre aspas e a aspa dobrada.</summary>
    [Trait("StartExportHandler", "StartExportCommand")]
    [Fact(DisplayName = "OK a tabela começa o trabalho com o SELECT das colunas marcadas, a geração lida antes e as credenciais do cofre")]
    public async Task Handle_Table_ShouldStartTheJob()
    {
        //Act
        var result = await CreateHandler().Handle(TableCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("SELECT \"id\", \"cliente\" FROM \"estoque\".\"pe\"\"dido\"", _job!.Sql);
        Assert.Equal((Generation, 2L, false, true, "pe\"dido", true, (string?)null, false), (_job.VaultGeneration, _job.WindowID, _job.CheckColumns, _job.Count, _job.SourceName, _job.Bom, _job.ZipEntryName, _job.Clipboard));
        Assert.Equal([new ExportColumnChoice(0, "id"), new ExportColumnChoice(1, "cliente")], _job.Columns);
        Assert.Equal(new ConnectionSettings(EDatabaseEngine.PostgreSql, "db.invalid", _record.Port, _record.Database, "leitor", "segredo"), _job.Settings);
        Assert.Equal(new CsvExportOptions(";", true, ECsvQuoting.Auto, true, "\r\n", string.Empty, EExportBinary.Hex), _job.Options);
    }

    /// <summary>RN-EXPORT-002: o resultado exporta o comando com o filtro junto, conferido pela posição e pelo nome, no banco de dados pedido.</summary>
    [Trait("StartExportHandler", "StartExportCommand")]
    [Fact(DisplayName = "OK o resultado começa o trabalho com o comando montado, as colunas conferidas e o .zip")]
    public async Task Handle_Query_ShouldStartTheJobWithTheFilteredCommand()
    {
        //Act
        var result = await CreateHandler().Handle(QueryCommand("SELECT * FROM loja.pedido", "status = 'aberto'"), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("SELECT * FROM loja.pedido WHERE (status = 'aberto')", _job!.Sql);
        Assert.Equal(("outro", true, "pedido", "pedido.csv"), (_job.Settings.Database, _job.CheckColumns, _job.SourceName, _job.ZipEntryName));
    }

    [Trait("StartExportHandler", "StartExportCommand")]
    [Fact(DisplayName = "OK o resultado sem nome é resultado")]
    public async Task Handle_Query_WithoutName_IsResultado()
    {
        //Arrange
        var command = QueryCommand("SELECT 1 AS id");

        //Act
        await CreateHandler().Handle(command with { Source = command.Source! with { Name = null } }, CancellationToken.None);

        //Assert
        Assert.Equal("resultado", _job!.SourceName);
    }

    [Trait("StartExportHandler", "StartExportCommand")]
    [Fact(DisplayName = "Erro a conexão que não existe é 404, e o cofre fechado é 401")]
    public async Task Handle_ShouldBeError_ConnectionNotFound_OrVaultLocked()
    {
        //Arrange
        var missing = VaultFakers.CreateConnection();
        var locked = VaultFakers.CreateConnection();
        _connectionQueries.Setup(queries => queries.GetRecordByID(missing.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(null));
        _connectionQueries.Setup(queries => queries.GetRecordByID(locked.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure<VaultConnectionRecord?, EVaultError>(EVaultError.Locked));

        //Act
        var notFound = await CreateHandler().Handle(TableCommand(missing), CancellationToken.None);
        var vaultLocked = await CreateHandler().Handle(TableCommand(locked), CancellationToken.None);

        //Assert
        AssertError(notFound, HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
        AssertError(vaultLocked, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        _transferService.Verify(service => service.StartExport(It.IsAny<ExportJob>()), Times.Never);
    }

    [Trait("StartExportHandler", "StartExportCommand")]
    [Theory(DisplayName = "Erro o banco de dados pedido fora da regra é DATABASE_NAME_INVALID")]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("a\nb")]
    public async Task Handle_ShouldBeError_DatabaseNameInvalid(string database)
    {
        //Arrange
        var command = QueryCommand("SELECT 1 AS id");

        //Act
        var result = await CreateHandler().Handle(command with { Source = command.Source! with { Database = database } }, CancellationToken.None);

        //Assert
        AssertError(result, HttpStatusCode.UnprocessableEntity, "DATABASE_NAME_INVALID");
    }

    /// <summary>
    /// RN-EXPORT-015 e RN-TRANSF-016: a conexão sem usuário ou sem senha, no campo que falta, com a frase do assistente. O usuário só de espaços falta, como
    /// na abertura de uma sessão.
    /// </summary>
    [Trait("StartExportHandler", "StartExportCommand")]
    [Theory(DisplayName = "Erro a conexão sem usuário ou sem senha é CONNECTION_CREDENTIALS_MISSING no campo")]
    [InlineData("", "segredo", "userName", "Esta conexão não tem usuário gravado. Preencha-o em Editar conexão e exporte de novo.")]
    [InlineData("   ", "segredo", "userName", "Esta conexão não tem usuário gravado. Preencha-o em Editar conexão e exporte de novo.")]
    [InlineData("leitor", "", "password", "Esta conexão não tem senha gravada. Preencha-a em Editar conexão e exporte de novo.")]
    public async Task Handle_ShouldBeError_CredentialsMissing(string userName, string password, string field, string message)
    {
        //Arrange
        var record = VaultFakers.CreateConnection(userName: userName, password: password, engine: EDatabaseEngine.PostgreSql);
        _connectionQueries.Setup(queries => queries.GetRecordByID(record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));

        //Act
        var result = await CreateHandler().Handle(TableCommand(record), CancellationToken.None);

        //Assert
        AssertError(result, HttpStatusCode.UnprocessableEntity, "CONNECTION_CREDENTIALS_MISSING");
        Assert.Equal([message], ((Dictionary<string, string[]>)result.Error.Extensions["errors"]!)[field]);
        Assert.Equal(["CONNECTION_CREDENTIALS_MISSING"], ((Dictionary<string, string[]>)result.Error.Extensions["errorCodes"]!)[field]);
    }

    [Trait("StartExportHandler", "StartExportCommand")]
    [Fact(DisplayName = "Erro sem o driver é DRIVER_NOT_INSTALLED, com o driver")]
    public async Task Handle_ShouldBeError_DriverNotInstalled()
    {
        //Arrange
        _driverService.Setup(service => service.RefusalFor(EDatabaseEngine.PostgreSql)).Returns(new DatabaseFailure(EDatabaseFailure.DriverNotInstalled, "O driver não está instalado.", DriverID: "ibm-db2"));

        //Act
        var result = await CreateHandler().Handle(TableCommand(), CancellationToken.None);

        //Assert
        AssertError(result, HttpStatusCode.UnprocessableEntity, "DRIVER_NOT_INSTALLED");
        Assert.Equal("ibm-db2", result.Error.Extensions["driverID"]);
    }

    /// <summary>RN-EXPORT-002 e 016: mais de um comando, o filtro que não se junta e o que não é leitura, pelo dialeto do banco da conexão, nessa ordem.</summary>
    [Trait("StartExportHandler", "StartExportCommand")]
    [Theory(DisplayName = "Erro o comando recusado pelo texto, antes do trabalho")]
    [InlineData("SELECT 1; SELECT 2", null, "MULTIPLE_STATEMENTS_NOT_SUPPORTED")]
    [InlineData("SELECT 1 AS id", "1 = 1; DROP TABLE x", "FILTER_INVALID")]
    [InlineData("DELETE FROM loja.pedido", null, "EXPORT_SOURCE_NOT_READ")]
    [InlineData("SELECT * FROM loja.pedido FOR UPDATE", null, "EXPORT_SOURCE_NOT_READ")]
    public async Task Handle_ShouldBeError_TheCommand(string sql, string? filter, string code)
    {
        //Act
        var result = await CreateHandler().Handle(QueryCommand(sql, filter), CancellationToken.None);

        //Assert
        AssertError(result, HttpStatusCode.UnprocessableEntity, code);
        _transferService.Verify(service => service.StartExport(It.IsAny<ExportJob>()), Times.Never);
    }

    [Trait("StartExportHandler", "StartExportCommand")]
    [Fact(DisplayName = "Erro o que não é leitura diz o motivo no detalhe e na extensão")]
    public async Task Handle_ShouldBeError_NotRead_WithTheReason()
    {
        //Act
        var result = await CreateHandler().Handle(QueryCommand("DELETE FROM loja.pedido"), CancellationToken.None);

        //Assert
        Assert.Equal("Exportar executa o comando de novo, e só se exporta uma leitura: um DELETE não é leitura. Nada foi enviado ao banco.", result.Error.Detail);
        Assert.Equal("um DELETE não é leitura", result.Error.Extensions["reason"]);
    }

    /// <summary>RN-EXPORT-011: no Informix, mais de uma linha por comando é recusada no campo.</summary>
    [Trait("StartExportHandler", "StartExportCommand")]
    [Fact(DisplayName = "Erro no Informix, mais de uma linha por comando é EXPORT_OPTIONS_INVALID no campo")]
    public async Task Handle_ShouldBeError_InformixRowsPerStatement()
    {
        //Arrange
        var record = VaultFakers.CreateConnection(engine: EDatabaseEngine.Informix);
        _connectionQueries.Setup(queries => queries.GetRecordByID(record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(record));
        var command = TableCommand(record) with { Format = "sql", Options = JsonDocument.Parse("""{ "rowsPerStatement": 2 }""").RootElement };

        //Act
        var result = await CreateHandler().Handle(command, CancellationToken.None);

        //Assert
        AssertError(result, HttpStatusCode.UnprocessableEntity, "EXPORT_OPTIONS_INVALID");
        Assert.Equal(["O Informix não aceita várias linhas num INSERT."], ((Dictionary<string, string[]>)result.Error.Extensions["errors"]!)["options.rowsPerStatement"]);
    }

    [Trait("StartExportHandler", "StartExportCommand")]
    [Theory(DisplayName = "Erro o registro recusa pelo limite (409) e pelo cofre que mudou (401)")]
    [InlineData(ETransferStartFailure.LimitReached, HttpStatusCode.Conflict, "TRANSFER_LIMIT_REACHED")]
    [InlineData(ETransferStartFailure.VaultChanged, HttpStatusCode.Unauthorized, "VAULT_LOCKED")]
    public async Task Handle_ShouldBeError_TheRegistryRefusal(ETransferStartFailure failure, HttpStatusCode status, string code)
    {
        //Arrange
        _transferService.Setup(service => service.StartExport(It.IsAny<ExportJob>())).Returns(Result.Failure<Guid, ETransferStartFailure>(failure));

        //Act
        var result = await CreateHandler().Handle(TableCommand(), CancellationToken.None);

        //Assert
        AssertError(result, status, code);
    }

    /// <summary>RN-CONN-014: a conexão excluída enquanto o trabalho entrava no registro: ele é cancelado e esquecido, e a resposta é 404.</summary>
    [Trait("StartExportHandler", "StartExportCommand")]
    [Fact(DisplayName = "Erro a conexão excluída no meio do começo cancela e esquece o trabalho")]
    public async Task Handle_ShouldBeError_ConnectionDeletedWhileStarting()
    {
        //Arrange
        var reads = 0;
        _connectionQueries.Setup(queries => queries.GetRecordByID(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(() => ++reads == 1 ? Result.Success<VaultConnectionRecord?, EVaultError>(_record) : Result.Success<VaultConnectionRecord?, EVaultError>(null));
        var id = Guid.CreateVersion7();
        _transferService.Setup(service => service.StartExport(It.IsAny<ExportJob>())).Returns(Result.Success<Guid, ETransferStartFailure>(id));

        //Act
        var result = await CreateHandler().Handle(TableCommand(), CancellationToken.None);

        //Assert
        AssertError(result, HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND");
        _transferService.Verify(service => service.DeleteAsync(id), Times.Exactly(2));
    }

    [Trait("StartExportHandler", "StartExportCommand")]
    [Fact(DisplayName = "OK o pedido não imprime o comando nem os nomes")]
    public void Command_ShouldNotPrintTheCommand()
    {
        //Arrange
        var command = QueryCommand("SELECT segredo FROM loja.pedido");

        //Act
        var text = $"{command} {command.Source} {command.Columns![0]} {command.Output}";

        //Assert
        Assert.DoesNotContain("segredo", text, StringComparison.Ordinal);
        Assert.DoesNotContain("pedido", text, StringComparison.Ordinal);
    }

    private static void AssertError<T>(Result<T, ApiErrorDto> result, HttpStatusCode status, string code)
    {
        Assert.True(result.IsFailure);
        Assert.Equal((status, code), (result.Error.StatusCode, result.Error.Type));
    }
}
