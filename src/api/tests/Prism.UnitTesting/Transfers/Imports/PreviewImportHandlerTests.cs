using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Queries;
using Prism.Application.Transfers.Features.PreviewImport;
using Prism.Application.Transfers.Features.ReadImportFile;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Drivers.Services;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// RN-IMPORT-007 e 009 a 011: as rotas das prévias, na ordem do começo da importação (RN-IMPORT-014) e sem tocar no banco antes da prévia: o arquivo, a
/// conexão, o banco de dados, o usuário e a senha, o driver e o somente leitura; e as recusas da prévia traduzidas nos códigos da seção 36.
/// </summary>
public sealed class PreviewImportHandlerTests
{
    private const string FileID = "0192f3a4-5b6c-7d8e-9fa0-b1c2d3e4f5a6";

    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IDriverService> _driverService = new();
    private readonly Mock<IImportPreviewService> _importPreviewService = new();
    private readonly VaultConnectionRecord _record = VaultFakers.CreateConnection(host: "db.invalid", userName: "gravador", password: "segredo", engine: EDatabaseEngine.PostgreSql);
    private ImportPreviewRequest? _request;

    public PreviewImportHandlerTests()
    {
        _connectionQueries.Setup(queries => queries.GetRecordByID(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(() => Result.Success<VaultConnectionRecord?, EVaultError>(_record));
        _connectionQueries.Setup(queries => queries.IsReadOnly(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<bool?, EVaultError>(false));
        _importPreviewService.Setup(service => service.PreviewAsync(It.IsAny<ImportPreviewRequest>(), It.IsAny<CancellationToken>()))
            .Callback((ImportPreviewRequest request, CancellationToken _) => _request = request)
            .ReturnsAsync(Result.Success<ImportConvertedPreview, ImportPreviewFailure>(new ImportConvertedPreview(new ImportTargetTable("estoque", "pedido", false, [], []), ["id"], [new ImportMappingEntry(0, "id")], 1, [])));
    }

    private PreviewImportHandler CreateHandler()
        => new(_connectionQueries.Object, _driverService.Object, _importPreviewService.Object);

    private PreviewImportCommand Command(string? database = null)
        => new()
        {
            FileID = FileID,
            Format = "csv",
            Values = new ImportValuesDto { Decimal = "comma", ThousandsDot = true, Dates = "dayMonthYear" },
            Target = new ImportTargetDto { ConnectionID = _record.ID, Database = database, Schema = "estoque", Table = "pedido" },
            Mapping = [new ImportMappingDto { Source = 0, Target = "id" }]
        };

    [Trait("PreviewImportHandler", "PreviewImportCommand")]
    [Fact(DisplayName = "OK a prévia vai com a conexão do cofre, o banco de dados pedido, os formatos e o mapeamento")]
    public async Task Handle_ShouldPreviewWithTheVaultConnection()
    {
        //Act
        var result = await CreateHandler().Handle(Command("outro"), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(new ConnectionSettings(EDatabaseEngine.PostgreSql, "db.invalid", _record.Port, "outro", "gravador", "segredo"), _request!.Settings);
        Assert.Equal(new ImportValueFormats(EImportDecimal.Comma, true, EImportDates.DayMonthYear), _request.Formats);
        Assert.Equal([new ImportMappingEntry(0, "id")], _request.Mapping!);
        Assert.Equal(CsvImportOptions.Default, _request.Options);
        Assert.Equal(("estoque", "pedido"), (_request.Schema, _request.Table));
        Assert.Equal("id", result.Value.Mapping.Single().Target);
    }

    [Trait("PreviewImportHandler", "PreviewImportCommand")]
    [Fact(DisplayName = "ERRO o arquivo que sumiu e o grande demais vêm antes da conexão")]
    public async Task Handle_File_ShouldBeCheckedFirst()
    {
        //Arrange
        _importPreviewService.SetupSequence(service => service.CheckFile(It.IsAny<Guid>()))
            .Returns(new ImportFileRefusal(EImportFileRefusal.Missing))
            .Returns(new ImportFileRefusal(EImportFileRefusal.TooLarge, 2_576_980_378));

        //Act
        var missing = await CreateHandler().Handle(Command(), CancellationToken.None);
        var tooLarge = await CreateHandler().Handle(Command(), CancellationToken.None);

        //Assert
        Assert.Equal((HttpStatusCode.NotFound, "IMPORT_FILE_MISSING"), (missing.Error.StatusCode, missing.Error.Type));
        Assert.Equal("O arquivo escolhido não está mais com o Prism. Escolha o arquivo de novo.", missing.Error.Detail);
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "IMPORT_FILE_TOO_LARGE"), (tooLarge.Error.StatusCode, tooLarge.Error.Type));
        Assert.Equal("O arquivo tem 2,4 GB, e o Prism importa até 2 GB.", tooLarge.Error.Detail);
        _connectionQueries.Verify(queries => queries.GetRecordByID(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Trait("PreviewImportHandler", "PreviewImportCommand")]
    [Fact(DisplayName = "ERRO a conexão sem senha, no campo, com importe de novo, e a conexão somente leitura, sem ir ao banco")]
    public async Task Handle_Connection_ShouldBeRefusedBeforeTheDatabase()
    {
        //Arrange
        var withoutPassword = VaultFakers.CreateConnection(host: "db.invalid", userName: "gravador", password: string.Empty, engine: EDatabaseEngine.PostgreSql);
        _connectionQueries.Setup(queries => queries.GetRecordByID(withoutPassword.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(withoutPassword));
        var command = Command() with { Target = new ImportTargetDto { ConnectionID = withoutPassword.ID, Schema = "estoque", Table = "pedido" } };

        //Act
        var credentials = await CreateHandler().Handle(command, CancellationToken.None);
        _connectionQueries.Setup(queries => queries.IsReadOnly(_record.ID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<bool?, EVaultError>(true));
        var readOnly = await CreateHandler().Handle(Command(), CancellationToken.None);
        var invalidDatabase = await CreateHandler().Handle(Command("\u0001"), CancellationToken.None);

        //Assert
        Assert.Equal("CONNECTION_CREDENTIALS_MISSING", credentials.Error.Type);
        Assert.Equal(["Esta conexão não tem senha gravada. Preencha-a em Editar conexão e importe de novo."], ((Dictionary<string, string[]>)credentials.Error.Extensions["errors"]!)["password"]);
        Assert.Equal("CONNECTION_READ_ONLY", readOnly.Error.Type);
        Assert.Equal("A conexão é somente leitura, e a importação grava na tabela. Nada foi enviado ao banco.", readOnly.Error.Detail);
        Assert.Equal("DATABASE_NAME_INVALID", invalidDatabase.Error.Type);
        _importPreviewService.Verify(service => service.PreviewAsync(It.IsAny<ImportPreviewRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Trait("PreviewImportHandler", "PreviewImportCommand")]
    [Fact(DisplayName = "ERRO a conexão que não existe é 404")]
    public async Task Handle_MissingConnection_ShouldBeNotFound()
    {
        //Arrange
        var command = Command() with { Target = new ImportTargetDto { ConnectionID = Guid.CreateVersion7(), Schema = "estoque", Table = "pedido" } };
        _connectionQueries.Setup(queries => queries.GetRecordByID(command.Target!.ConnectionID, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<VaultConnectionRecord?, EVaultError>(null));

        //Act
        var result = await CreateHandler().Handle(command, CancellationToken.None);

        //Assert
        Assert.Equal((HttpStatusCode.NotFound, "CONNECTION_NOT_FOUND"), (result.Error.StatusCode, result.Error.Type));
    }

    [Trait("PreviewImportHandler", "PreviewImportCommand")]
    [Theory(DisplayName = "ERRO cada recusa da prévia vira o código da seção 36")]
    [InlineData(EImportPreviewFailure.TableNotFound, HttpStatusCode.NotFound, "IMPORT_TABLE_NOT_FOUND")]
    [InlineData(EImportPreviewFailure.NotATable, HttpStatusCode.UnprocessableEntity, "IMPORT_TARGET_NOT_TABLE")]
    [InlineData(EImportPreviewFailure.MappingInvalid, HttpStatusCode.UnprocessableEntity, "IMPORT_MAPPING_INVALID")]
    [InlineData(EImportPreviewFailure.Unreadable, HttpStatusCode.UnprocessableEntity, "IMPORT_FILE_UNREADABLE")]
    [InlineData(EImportPreviewFailure.Database, HttpStatusCode.UnprocessableEntity, "DATABASE_CONNECTION_FAILED")]
    [InlineData(EImportPreviewFailure.FileMissing, HttpStatusCode.NotFound, "IMPORT_FILE_MISSING")]
    public async Task Handle_PreviewFailure_ShouldBeTranslated(EImportPreviewFailure kind, HttpStatusCode status, string code)
    {
        //Arrange
        var failure = new ImportPreviewFailure(kind, "motivo", new ImportReadFailure(EImportReadReason.Encoding, "O arquivo não é UTF-8 válido na linha 3. Escolha a codificação dele.", 3), new DatabaseFailure(EDatabaseFailure.ConnectionFailed, "password authentication failed", "28P01"), "mapping[0].source");
        _importPreviewService.Setup(service => service.PreviewAsync(It.IsAny<ImportPreviewRequest>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure<ImportConvertedPreview, ImportPreviewFailure>(failure));

        //Act
        var result = await CreateHandler().Handle(Command(), CancellationToken.None);

        //Assert
        Assert.Equal((status, code), (result.Error.StatusCode, result.Error.Type));
        if (kind == EImportPreviewFailure.Unreadable)
            Assert.Equal(("encoding", 3L), ((string)result.Error.Extensions["reason"]!, (long)result.Error.Extensions["line"]!));

        if (kind == EImportPreviewFailure.MappingInvalid)
            Assert.Equal(["IMPORT_MAPPING_INVALID"], ((Dictionary<string, string[]>)result.Error.Extensions["errorCodes"]!)["mapping[0].source"]);
    }

    [Trait("ReadImportFileHandler", "ReadImportFileCommand")]
    [Fact(DisplayName = "OK a prévia do arquivo vira a resposta, com a codificação, o separador e as linhas")]
    public async Task Read_ShouldMapTheResponse()
    {
        //Arrange
        var info = new ImportReadInfo(new ImportEncodingInfo("utf-8", true), ";", null, null, null, ["id", "nome"]);
        _importPreviewService.Setup(service => service.ReadAsync(Guid.Parse(FileID), "csv", CsvImportOptions.Default, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<ImportFilePreview, ImportPreviewFailure>(new ImportFilePreview(info, 2, [new ImportFileRow(2, ["1", null], true)])));

        //Act
        var result = await new ReadImportFileHandler(_importPreviewService.Object).Handle(new ReadImportFileCommand { FileID = FileID, Format = "csv" }, CancellationToken.None);

        //Assert
        Assert.Equal(new ImportEncodingDto("utf-8", true), result.Value.Encoding);
        Assert.Equal(";", result.Value.Delimiter);
        Assert.Null(result.Value.Sheets);
        Assert.Equal(["id", "nome"], result.Value.Columns);
        Assert.Equal((2L, true), (result.Value.Rows[0].Line, result.Value.Rows[0].Short));
        Assert.Equal(["1", null], result.Value.Rows[0].Values);
    }
}
