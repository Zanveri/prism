using CSharpFunctionalExtensions;
using Moq;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Clients;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Services;
using Serilog.Core;
using System.Text;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// RN-IMPORT-007 e 009 a 011: as prévias da importação, com o arquivo de verdade numa pasta `transfers` temporária e o banco de mentira: a leitura sem
/// banco, a tabela lida numa conexão à parte (a que não existe, a que não é tabela), o mapeamento automático e o pedido, conferido, e a prévia convertida
/// com a recusa do Prism e a do banco, célula por célula.
/// </summary>
public sealed class ImportPreviewServiceTests : IDisposable
{
    private const string Csv = "id;Nome;Data de criação\r\n1;Ana;2024-01-15\r\n1.5;Bia;15/01/2024\r\n";

    private readonly string _data = Directory.CreateTempSubdirectory("prism-import-preview-").FullName;
    private readonly Mock<IDatabaseClient> _client = new();
    private readonly Mock<IDatabaseConnection> _connection = new();
    private readonly ConnectionSettings _settings = new(EDatabaseEngine.PostgreSql, "db.invalid", 5432, "loja", "gravador", "segredo");
    private IReadOnlyList<string>? _types;
    private IReadOnlyList<IReadOnlyList<object?>>? _values;

    public ImportPreviewServiceTests()
    {
        Directory.CreateDirectory(Path.Combine(_data, "transfers"));
        _client.SetupGet(client => client.Engine).Returns(EDatabaseEngine.PostgreSql);
        _client.Setup(client => client.OpenAsync(_settings, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<IDatabaseConnection, DatabaseFailure>(_connection.Object));
        _connection.Setup(connection => connection.LimitLockWaitAsync(It.IsAny<CancellationToken>())).ReturnsAsync(UnitResult.Success<DatabaseFailure>());
        _connection.Setup(connection => connection.DescribeImportTargetAsync("loja", "pedido", It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<ImportCatalog?, DatabaseFailure>(Catalog("table")));
        _connection.Setup(connection => connection.CheckImportCastsAsync(It.IsAny<IReadOnlyList<string>>(), It.IsAny<IReadOnlyList<IReadOnlyList<object?>>>(), It.IsAny<CancellationToken>()))
            .Callback((IReadOnlyList<string> types, IReadOnlyList<IReadOnlyList<object?>> values, CancellationToken _) => (_types, _values) = (types, values))
            .ReturnsAsync((IReadOnlyList<string> _, IReadOnlyList<IReadOnlyList<object?>> values, CancellationToken _) => Result.Success<IReadOnlyList<IReadOnlyList<string?>>, DatabaseFailure>(
                [.. values.Select(row => (IReadOnlyList<string?>)[.. row.Select(value => Equals(value, "1.5") ? "invalid input syntax for type integer: \"1.5\"" : null)])]));
    }

    public void Dispose()
        => Directory.Delete(_data, recursive: true);

    private static ImportCatalog Catalog(string kind)
        => new(
            new EditCatalogTable("loja", "pedido", kind, 1, false,
            [
                new ColumnInfo("id", "integer", false, true, 1, null, null),
                new ColumnInfo("nome", "text", true, false, 2, null, null),
                new ColumnInfo("data_de_criacao", "date", false, false, 3, "now()", null),
                new ColumnInfo("total", "numeric(12,2)", true, false, 4, "(qtd * preco)", ColumnGeneration.Always)
            ], []),
            [
                new ReferencingForeignKeyInfo("fk_item_pedido", "loja", "item", ["pedido_id"], ["id"], ForeignKeyRule.Cascade, ForeignKeyRule.NoAction),
                new ReferencingForeignKeyInfo("fk_pedido_pai", "loja", "pedido", ["pai_id"], ["id"], ForeignKeyRule.SetNull, ForeignKeyRule.NoAction),
                new ReferencingForeignKeyInfo("fk_devolucao", "loja", "devolucao", ["pedido_id"], ["id"], null, null)
            ],
            new Dictionary<string, string>());

    private ImportPreviewService CreateService()
        => new([_client.Object], new ImportFileClient(TransferSettings.For(_data), Logger.None), Logger.None);

    private Guid WriteFile(string content)
    {
        var fileID = Guid.NewGuid();
        File.WriteAllBytes(Path.Combine(_data, "transfers", $"{fileID:D}.in"), Encoding.UTF8.GetBytes(content));

        return fileID;
    }

    private ImportPreviewRequest Request(Guid fileID, IReadOnlyList<ImportMappingEntry>? mapping = null, ImportReaderOptions? options = null)
        => new(fileID, ImportFormats.Csv, options ?? CsvImportOptions.Default, ImportValueFormats.Default, _settings, "loja", "pedido", mapping);

    [Trait("ImportPreviewService", "ReadAsync")]
    [Fact(DisplayName = "OK a prévia do arquivo diz o que a leitura achou e traz as linhas como foram lidas, sem banco")]
    public async Task ReadAsync_ShouldReadTheFileWithoutTheDatabase()
    {
        //Arrange
        var fileID = WriteFile(Csv);

        //Act
        var read = await CreateService().ReadAsync(fileID, ImportFormats.Csv, CsvImportOptions.Default, CancellationToken.None);

        //Assert
        Assert.True(read.IsSuccess);
        Assert.Equal(new ImportEncodingInfo(ImportEncodings.Utf8, false), read.Value.Info.Encoding);
        Assert.Equal(";", read.Value.Info.Delimiter);
        Assert.Equal(["id", "Nome", "Data de criação"], read.Value.Info.Columns);
        Assert.Equal(3, read.Value.ShownColumns);
        Assert.Equal([2L, 3L], read.Value.Rows.Select(row => row.Line));
        Assert.Equal(["1.5", "Bia", "15/01/2024"], read.Value.Rows[1].Values);
        _client.Verify(client => client.OpenAsync(It.IsAny<ConnectionSettings>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Trait("ImportPreviewService", "ReadAsync")]
    [Fact(DisplayName = "ERRO o arquivo que falta, e a leitura recusada com o motivo e a linha")]
    public async Task ReadAsync_Refusals_ShouldSayWhy()
    {
        //Arrange
        var invalid = Guid.NewGuid();
        File.WriteAllBytes(Path.Combine(_data, "transfers", $"{invalid:D}.in"), [.. Encoding.UTF8.GetBytes("a;b\r\n1;"), 0xC3, 0x28, (byte)'\r', (byte)'\n']);

        //Act
        var missing = await CreateService().ReadAsync(Guid.NewGuid(), ImportFormats.Csv, CsvImportOptions.Default, CancellationToken.None);
        var refused = await CreateService().ReadAsync(invalid, ImportFormats.Csv, CsvImportOptions.Default with { Encoding = ImportEncodings.Utf8 }, CancellationToken.None);

        //Assert
        Assert.Equal(EImportPreviewFailure.FileMissing, missing.Error.Kind);
        Assert.Equal(EImportPreviewFailure.Unreadable, refused.Error.Kind);
        Assert.Equal(EImportReadReason.Encoding, refused.Error.Read!.Reason);
        Assert.Equal(2, refused.Error.Read.Line);
        Assert.Equal("O arquivo não é UTF-8 válido na linha 2. Escolha a codificação dele.", refused.Error.Message);
    }

    [Trait("ImportPreviewService", "PreviewAsync")]
    [Fact(DisplayName = "OK a prévia convertida: a tabela com a classe de cada coluna, o mapeamento pelo nome, a recusa do Prism e a do banco")]
    public async Task PreviewAsync_ShouldConvertWithTheSuggestedMapping()
    {
        //Arrange
        var fileID = WriteFile(Csv);

        //Act
        var preview = await CreateService().PreviewAsync(Request(fileID), CancellationToken.None);

        //Assert
        Assert.True(preview.IsSuccess, preview.IsFailure ? preview.Error.Message : null);
        var table = preview.Value.Table;
        Assert.Equal(["id", "nome", "data_de_criacao", "total"], table.Columns.Select(column => column.Name));
        Assert.Equal([EImportClass.Number, EImportClass.Text, EImportClass.Date, EImportClass.Number], table.Columns.Select(column => column.Class));
        Assert.False(table.Columns[3].Importable);
        Assert.Equal(ImportColumns.GeneratedReason, table.Columns[3].Reason);
        Assert.Equal([new ImportReference("loja", "item", "cascade"), new ImportReference("loja", "devolucao", "noAction")], table.ReferencedBy);
        Assert.Equal([new ImportMappingEntry(0, "id"), new ImportMappingEntry(1, "nome"), new ImportMappingEntry(2, "data_de_criacao")], preview.Value.Mapping);
        Assert.Equal(["integer", "text", "date"], _types);
        Assert.Equal(["1", "Ana", "2024-01-15"], _values![0]);
        Assert.Equal(["1.5", "Bia", null], _values[1]);

        var rows = preview.Value.Rows;
        Assert.Equal(3, preview.Value.ShownColumns);
        Assert.Equal([new ImportPreviewCell("1", null), new ImportPreviewCell("Ana", null), new ImportPreviewCell("2024-01-15", null)], rows[0].Cells);
        Assert.Equal(new ImportPreviewCell(null, "invalid input syntax for type integer: \"1.5\""), rows[1].Cells[0]);
        Assert.Equal(new ImportPreviewCell(null, "«15/01/2024» não é uma data no formato aaaa-mm-dd."), rows[1].Cells[2]);
        _connection.Verify(connection => connection.LimitLockWaitAsync(It.IsAny<CancellationToken>()), Times.Once);
        _connection.Verify(connection => connection.DisposeAsync(), Times.Once);
    }

    [Trait("ImportPreviewService", "PreviewAsync")]
    [Fact(DisplayName = "OK sem cabeçalho, o mapeamento automático é pela posição")]
    public async Task PreviewAsync_WithoutHeader_ShouldMapByPosition()
    {
        //Arrange
        var fileID = WriteFile("1;Ana;2024-01-15;9\r\n");

        //Act
        var preview = await CreateService().PreviewAsync(Request(fileID, options: CsvImportOptions.Default with { Header = false }), CancellationToken.None);

        //Assert
        Assert.Equal([new ImportMappingEntry(0, "id"), new ImportMappingEntry(1, "nome"), new ImportMappingEntry(2, "data_de_criacao")], preview.Value.Mapping);
        Assert.Equal(["Coluna 1", "Coluna 2", "Coluna 3", "Coluna 4"], preview.Value.Columns);
    }

    [Trait("ImportPreviewService", "PreviewAsync")]
    [Fact(DisplayName = "ERRO a tabela que não existe mais, a que não é tabela e o mapeamento pedido que não serve, cada um no campo dele")]
    public async Task PreviewAsync_TableAndMappingRefusals_ShouldSayWhy()
    {
        //Arrange
        var fileID = WriteFile(Csv);
        var service = CreateService();

        //Act
        var mappingSource = await service.PreviewAsync(Request(fileID, [new ImportMappingEntry(1, "nome"), new ImportMappingEntry(3, "id")]), CancellationToken.None);
        var mappingTarget = await service.PreviewAsync(Request(fileID, [new ImportMappingEntry(0, "total")]), CancellationToken.None);
        var mappingMissing = await service.PreviewAsync(Request(fileID, [new ImportMappingEntry(0, "obs")]), CancellationToken.None);
        _connection.Setup(connection => connection.DescribeImportTargetAsync("loja", "pedido", It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<ImportCatalog?, DatabaseFailure>(Catalog("view")));
        var view = await service.PreviewAsync(Request(fileID), CancellationToken.None);
        _connection.Setup(connection => connection.DescribeImportTargetAsync("loja", "pedido", It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<ImportCatalog?, DatabaseFailure>((ImportCatalog?)null));
        var gone = await service.PreviewAsync(Request(fileID), CancellationToken.None);

        //Assert
        Assert.Equal((EImportPreviewFailure.MappingInvalid, "mapping[1].source", "A coluna 4 do arquivo não existe: o arquivo tem 3 colunas."), (mappingSource.Error.Kind, mappingSource.Error.Field, mappingSource.Error.Message));
        Assert.Equal(("mapping[0].target", ImportColumns.GeneratedReason), (mappingTarget.Error.Field, mappingTarget.Error.Message));
        Assert.Equal(("mapping[0].target", "A tabela não tem a coluna obs."), (mappingMissing.Error.Field, mappingMissing.Error.Message));
        Assert.Equal((EImportPreviewFailure.NotATable, "Só uma tabela recebe linhas: loja.pedido é uma visão."), (view.Error.Kind, view.Error.Message));
        Assert.Equal((EImportPreviewFailure.TableNotFound, "A tabela loja.pedido não existe mais."), (gone.Error.Kind, gone.Error.Message));
        _connection.Verify(connection => connection.CheckImportCastsAsync(It.IsAny<IReadOnlyList<string>>(), It.IsAny<IReadOnlyList<IReadOnlyList<object?>>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Trait("ImportPreviewService", "PreviewAsync")]
    [Fact(DisplayName = "ERRO o banco que não conecta é a falha da prévia, com a mensagem dele, e o arquivo que falta não chega ao banco")]
    public async Task PreviewAsync_DatabaseAndFileRefusals_ShouldSayWhy()
    {
        //Arrange
        var fileID = WriteFile(Csv);
        var failure = new DatabaseFailure(EDatabaseFailure.ConnectionFailed, "password authentication failed for user \"gravador\"", "28P01");
        _client.Setup(client => client.OpenAsync(_settings, It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure<IDatabaseConnection, DatabaseFailure>(failure));

        //Act
        var database = await CreateService().PreviewAsync(Request(fileID), CancellationToken.None);
        var missing = await CreateService().PreviewAsync(Request(Guid.NewGuid()), CancellationToken.None);

        //Assert
        Assert.Equal(EImportPreviewFailure.Database, database.Error.Kind);
        Assert.Equal(failure, database.Error.Database);
        Assert.Equal(EImportPreviewFailure.FileMissing, missing.Error.Kind);
        _client.Verify(client => client.OpenAsync(_settings, It.IsAny<CancellationToken>()), Times.Once);
    }
}
