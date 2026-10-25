using CSharpFunctionalExtensions;
using FluentValidation.TestHelper;
using Moq;
using Prism.Application.Connections.Queries;
using Prism.Application.Transfers.Features.StartExport;
using Prism.Application.Transfers.Models.Dtos;
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
/// RN-VAR-032 e 033, na exportação: o `source.params` de um comando de Registros ou de resultado. A forma é do validator (`EXPORT_OPTIONS_INVALID` no campo
/// `source.params[3].value`); os marcadores do comando montado contra os valores, e o que o banco da conexão não guarda, são do handler, pelo dialeto da conexão
/// (`QUERY_PARAMETERS_MISMATCH`); e o trabalho leva os valores para a contagem e a leitura.
/// </summary>
public sealed class StartExportParametersTests
{
    private static JsonElement Json(string json)
        => JsonDocument.Parse(json).RootElement.Clone();

    private static ExportSourceDto Source(string sql, string? parameters, string kind = "query")
        => new() { Kind = kind, ConnectionID = Guid.CreateVersion7(), Sql = kind == "query" ? sql : null, Schema = kind == "table" ? "loja" : null, Table = kind == "table" ? "pedido" : null, Params = parameters is null ? null : Json(parameters) };

    private static StartExportCommand Command(ExportSourceDto source)
        => new() { Source = source, Columns = [new ExportColumnDto { Position = 0, Name = "id" }], Format = "csv", Output = new ExportOutputDto(), WindowID = 1 };

    [Trait("StartExportValidator", "SourceParams")]
    [Fact(DisplayName = "Erro o source.params fora da forma é EXPORT_OPTIONS_INVALID no campo da entrada")]
    public void Validate_ShouldBeError_WithSourceParamsOutOfShape()
    {
        //Act
        var result = new StartExportValidator().TestValidate(Command(Source("SELECT $1, $2", "[{\"type\":\"number\",\"value\":\"1\"},{\"type\":\"date\",\"value\":\"2026-02-30\"}]")));

        //Assert
        result.ShouldHaveValidationErrorFor("source.params[1].value").WithErrorCode("EXPORT_OPTIONS_INVALID");
        Assert.Single(result.Errors);
    }

    [Trait("StartExportValidator", "SourceParams")]
    [Fact(DisplayName = "OK o source.params certo, ausente ou vazio passa; na origem tabela só o ausente ou vazio")]
    public void Validate_ShouldBeOK_WithAcceptedSourceParams()
    {
        //Arrange
        var validator = new StartExportValidator();

        //Assert
        validator.TestValidate(Command(Source("SELECT $1", "[{\"type\":\"number\",\"value\":\"1\"}]"))).ShouldNotHaveAnyValidationErrors();
        validator.TestValidate(Command(Source("SELECT 1", "[]"))).ShouldNotHaveAnyValidationErrors();
        validator.TestValidate(Command(Source("", "[]", kind: "table"))).ShouldNotHaveAnyValidationErrors();
        validator.TestValidate(Command(Source("", "[{\"type\":\"number\",\"value\":\"1\"}]", kind: "table"))).ShouldHaveValidationErrorFor("source.params");
    }

    private (StartExportHandler Handler, VaultConnectionRecord Record, Func<ExportJob?> Job) Create(EDatabaseEngine engine)
    {
        var record = VaultFakers.CreateConnection(host: "db.invalid", userName: "leitor", password: "segredo", engine: engine);
        var connectionQueries = new Mock<IConnectionQueries>();
        connectionQueries.Setup(queries => queries.GetRecordByID(record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(() => Result.Success<VaultConnectionRecord?, EVaultError>(record));
        var vault = new Mock<IVaultService>();
        var transfers = new Mock<ITransferService>();
        ExportJob? job = null;
        transfers.Setup(service => service.StartExport(It.IsAny<ExportJob>())).Callback((ExportJob started) => job = started).Returns(Result.Success<Guid, ETransferStartFailure>(Guid.CreateVersion7()));

        return (new StartExportHandler(connectionQueries.Object, vault.Object, new Mock<IDriverService>().Object, transfers.Object), record, () => job);
    }

    [Trait("StartExportHandler", "SourceParams")]
    [Fact(DisplayName = "OK o trabalho leva os valores do source.params, na ordem, para a contagem e a leitura")]
    public async Task Handle_ShouldStartTheJobWithTheParameters()
    {
        //Arrange
        var (handler, record, job) = Create(EDatabaseEngine.PostgreSql);
        var source = Source("SELECT id FROM loja.pedido WHERE status = $1 AND total > $2", "[{\"type\":\"text\",\"value\":\"aberta\"},{\"type\":\"number\",\"value\":\"10.5\"}]");
        source = source with { ConnectionID = record.ID };

        //Act
        var result = await handler.Handle(Command(source), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Detail : null);
        Assert.Equal([new QueryParameter(EQueryParameterType.Text, "aberta"), new QueryParameter(EQueryParameterType.Number, "10.5")], job()!.Parameters);
        Assert.Equal("SELECT id FROM loja.pedido WHERE status = $1 AND total > $2", job()!.Sql);
    }

    [Trait("StartExportHandler", "SourceParams")]
    [Fact(DisplayName = "Erro os marcadores do comando que não batem com o source.params são 422 QUERY_PARAMETERS_MISMATCH, e o trabalho não começa")]
    public async Task Handle_ShouldRefuse_WhenTheMarkersDoNotMatch()
    {
        //Arrange
        var (handler, record, job) = Create(EDatabaseEngine.Db2);
        var source = Source("SELECT id FROM loja.pedido WHERE a = ? AND b = ?", "[{\"type\":\"number\",\"value\":\"1\"}]") with { ConnectionID = record.ID };

        //Act
        var result = await handler.Handle(Command(source), CancellationToken.None);

        //Assert
        Assert.Equal(("QUERY_PARAMETERS_MISMATCH", HttpStatusCode.UnprocessableEntity), (result.Error.Type, result.Error.StatusCode));
        Assert.Equal((2, 1), ((int)result.Error.Extensions["markers"]!, (int)result.Error.Extensions["values"]!));
        Assert.Null(job());
    }

    [Trait("StartExportHandler", "SourceParams")]
    [Fact(DisplayName = "Erro o valor que o banco da conexão não guarda é EXPORT_OPTIONS_INVALID no campo source.params[i].value")]
    public async Task Handle_ShouldRefuse_AValueTheDatabaseDoesNotHold()
    {
        //Arrange
        var (handler, record, job) = Create(EDatabaseEngine.Informix);
        var source = Source("SELECT id FROM pedido WHERE a = ?", "[{\"type\":\"number\",\"value\":\"123456789012345678901234567890123\"}]") with { ConnectionID = record.ID };

        //Act
        var result = await handler.Handle(Command(source), CancellationToken.None);

        //Assert
        Assert.Equal("EXPORT_OPTIONS_INVALID", result.Error.Type);
        var errors = (Dictionary<string, string[]>)result.Error.Extensions["errors"]!;
        Assert.Equal(["O número tem 33 dígitos, e o Informix guarda até 31 pelo driver."], errors["source.params[0].value"]);
        Assert.Null(job());
    }

    [Trait("StartExportHandler", "SourceParams")]
    [Fact(DisplayName = "OK sem source.params o trabalho leva a lista vazia, e o $1 do texto vai como está")]
    public async Task Handle_WithoutSourceParams_ShouldStartTheJobWithoutParameters()
    {
        //Arrange
        var (handler, record, job) = Create(EDatabaseEngine.PostgreSql);
        var source = Source("SELECT id FROM loja.pedido WHERE a = $1", null) with { ConnectionID = record.ID };

        //Act
        var result = await handler.Handle(Command(source), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Empty(job()!.Parameters!);
    }

    [Trait("StartExportHandler", "SourceParams")]
    [Theory(DisplayName = "Erro o filtro com marcador de parâmetro, com source.params, é 422 FILTER_INVALID como no queries, e o trabalho não começa")]
    [InlineData(EDatabaseEngine.PostgreSql, "SELECT id FROM loja.pedido WHERE a = $1", "b = $2", "[{\"type\":\"number\",\"value\":\"1\"}]")]
    [InlineData(EDatabaseEngine.PostgreSql, "SELECT id FROM loja.pedido WHERE a = $1", "b = $2", "[{\"type\":\"number\",\"value\":\"1\"},{\"type\":\"number\",\"value\":\"2\"}]")]
    [InlineData(EDatabaseEngine.Db2, "SELECT id FROM loja.pedido WHERE a = ? ORDER BY c", "b = ?", "[{\"type\":\"number\",\"value\":\"1\"},{\"type\":\"number\",\"value\":\"2\"}]")]
    [InlineData(EDatabaseEngine.Informix, "SELECT id FROM pedido WHERE a = ?", "b = ?", "[{\"type\":\"number\",\"value\":\"1\"},{\"type\":\"number\",\"value\":\"2\"}]")]
    public async Task Handle_ShouldRefuse_AFilterWithAMarkerWhenThereAreParameters(EDatabaseEngine engine, string sql, string filter, string parameters)
    {
        //Arrange
        var (handler, record, job) = Create(engine);
        var source = Source(sql, parameters) with { ConnectionID = record.ID, Filter = filter };

        //Act
        var result = await handler.Handle(Command(source), CancellationToken.None);

        //Assert
        Assert.Equal(("FILTER_INVALID", HttpStatusCode.UnprocessableEntity), (result.Error.Type, result.Error.StatusCode));
        Assert.Null(job());
    }

    [Trait("StartExportHandler", "SourceParams")]
    [Fact(DisplayName = "OK o filtro sem marcador junto com o source.params entra no comando, depois dos marcadores do comando")]
    public async Task Handle_ShouldJoinAFilterWithoutMarkerToTheParameterizedCommand()
    {
        //Arrange
        var (handler, record, job) = Create(EDatabaseEngine.Db2);
        var source = Source("SELECT id FROM loja.pedido WHERE a = ? ORDER BY c", "[{\"type\":\"number\",\"value\":\"1\"}]") with { ConnectionID = record.ID, Filter = "b = 2" };

        //Act
        var result = await handler.Handle(Command(source), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Detail : null);
        Assert.Equal("SELECT id FROM loja.pedido WHERE (a = ?) AND (b = 2) ORDER BY c", job()!.Sql);
    }
}
