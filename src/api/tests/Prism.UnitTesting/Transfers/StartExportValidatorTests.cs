using FluentValidation.TestHelper;
using Prism.Application.Transfers.Features.StartExport;
using Prism.Application.Transfers.Models.Dtos;
using System.Text.Json;

namespace Prism.UnitTesting.Transfers;

/// <summary>
/// RN-EXPORT-016, o primeiro passo: a forma do pedido e as faixas da seção 6, todas recusadas de uma vez com `EXPORT_OPTIONS_INVALID` no campo, pelo
/// caminho em camelCase que a tela lê. O que depende do banco da conexão não é daqui.
/// </summary>
public sealed class StartExportValidatorTests
{
    private const string OptionsInvalid = "EXPORT_OPTIONS_INVALID";

    private static readonly StartExportValidator Validator = new();

    private static StartExportCommand Command(
        ExportSourceDto? source = null,
        IReadOnlyList<ExportColumnDto>? columns = null,
        string? format = "csv",
        string? options = null,
        ExportOutputDto? output = null,
        long windowID = 1)
        => new()
        {
            Source = source ?? new ExportSourceDto { Kind = "query", ConnectionID = Guid.CreateVersion7(), Sql = "SELECT 1 AS id" },
            Columns = columns ?? [new ExportColumnDto { Position = 0, Name = "id" }],
            Format = format,
            Options = options is null ? null : JsonDocument.Parse(options).RootElement.Clone(),
            Output = output ?? new ExportOutputDto(),
            WindowID = windowID
        };

    private static void AssertRefused(StartExportCommand command, string field)
        => Validator.TestValidate(command).ShouldHaveValidationErrorFor(field).WithErrorCode(OptionsInvalid);

    [Trait("StartExportValidator", "StartExportCommand")]
    [Fact(DisplayName = "OK o pedido do resultado, sem opções, e o da tabela com o .zip")]
    public void Validate_ShouldBeOK()
    {
        //Arrange
        var table = Command(
            source: new ExportSourceDto { Kind = "table", ConnectionID = Guid.CreateVersion7(), Schema = "estoque", Table = "pedido" },
            columns: [new ExportColumnDto { Position = 1, Name = "cliente" }, new ExportColumnDto { Position = 0, Name = "id" }],
            output: new ExportOutputDto { Bom = true, Zip = true, EntryName = "pedido_2026-10-16_143005.csv" });

        //Act
        var query = Validator.TestValidate(Command());
        var tableResult = Validator.TestValidate(table);

        //Assert
        query.ShouldNotHaveAnyValidationErrors();
        tableResult.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("StartExportValidator", "StartExportCommand")]
    [Fact(DisplayName = "OK a área de transferência com o texto, sem BOM nem .zip")]
    public void Validate_Clipboard_ShouldBeOK()
        => Validator.TestValidate(Command(format: "markdown", output: new ExportOutputDto { Clipboard = true })).ShouldNotHaveAnyValidationErrors();

    [Trait("StartExportValidator", "StartExportCommand")]
    [Fact(DisplayName = "Erro sem origem, com o tipo fora da lista, e sem o comando")]
    public void Validate_Source_ShouldBeRefusedOnTheField()
    {
        //Assert
        AssertRefused(Command(source: null) with { Source = null }, "source");
        AssertRefused(Command(source: new ExportSourceDto { Kind = "view", ConnectionID = Guid.CreateVersion7() }), "source.kind");
        AssertRefused(Command(source: new ExportSourceDto { Kind = "query", ConnectionID = Guid.CreateVersion7(), Sql = "  " }), "source.sql");
        AssertRefused(Command(source: new ExportSourceDto { Kind = "query", ConnectionID = Guid.CreateVersion7(), Sql = new string('a', 1024 * 1024 + 1) }), "source.sql");
        AssertRefused(Command(source: new ExportSourceDto { Kind = "query", ConnectionID = Guid.CreateVersion7(), Sql = "SELECT 1", Name = "" }), "source.name");
    }

    [Trait("StartExportValidator", "StartExportCommand")]
    [Theory(DisplayName = "Erro o esquema e a tabela fora de 1 a 256 caracteres ou com U+0000")]
    [InlineData("", "pedido", "source.schema")]
    [InlineData("estoque", "", "source.table")]
    [InlineData("estoque", "pe\0dido", "source.table")]
    public void Validate_TableNames_ShouldBeRefusedOnTheField(string schema, string table, string field)
        => AssertRefused(Command(source: new ExportSourceDto { Kind = "table", ConnectionID = Guid.CreateVersion7(), Schema = schema, Table = table }), field);

    [Trait("StartExportValidator", "StartExportCommand")]
    [Fact(DisplayName = "OK o nome de 256 caracteres; Erro o de 257")]
    public void Validate_TableName_AtTheLimit()
    {
        //Arrange
        ExportSourceDto Source(int length) => new() { Kind = "table", ConnectionID = Guid.CreateVersion7(), Schema = "estoque", Table = new string('t', length) };

        //Assert
        Validator.TestValidate(Command(source: Source(256))).ShouldNotHaveAnyValidationErrors();
        AssertRefused(Command(source: Source(257)), "source.table");
    }

    public static TheoryData<ExportColumnDto[]> InvalidColumns()
        => new()
        {
            Array.Empty<ExportColumnDto>(),
            new[] { new ExportColumnDto { Position = -1, Name = "id" } },
            new[] { new ExportColumnDto { Position = 0, Name = "id" }, new ExportColumnDto { Position = 0, Name = "cliente" } },
            new[] { new ExportColumnDto { Position = 0, Name = "" } },
            new[] { new ExportColumnDto { Position = 0, Name = null } },
            new[] { new ExportColumnDto { Position = 0, Name = new string('c', 257) } }
        };

    [Trait("StartExportValidator", "StartExportCommand")]
    [Theory(DisplayName = "Erro sem colunas, com posição negativa ou repetida, ou com o nome fora da faixa")]
    [MemberData(nameof(InvalidColumns))]
    public void Validate_Columns_ShouldBeRefusedOnTheField(ExportColumnDto[] columns)
        => AssertRefused(Command(columns: columns), "columns");

    [Trait("StartExportValidator", "StartExportCommand")]
    [Fact(DisplayName = "Erro mais de 32.767 colunas")]
    public void Validate_TooManyColumns_ShouldBeRefused()
        => AssertRefused(Command(columns: [.. Enumerable.Range(0, 32768).Select(position => new ExportColumnDto { Position = position, Name = $"c{position}" })]), "columns");

    /// <summary>Os formatos que esta versão ainda não escreve são recusados no campo, com a frase que diz isso, antes de qualquer trabalho.</summary>
    [Trait("StartExportValidator", "StartExportCommand")]
    [Theory(DisplayName = "Erro o formato fora da lista e o que esta versão ainda não escreve")]
    [InlineData("pdf", "O formato deve ser um destes: csv, sourceCode, dbUnit, html, json, markdown, sql, txt, xlsx, xml.")]
    [InlineData(null, "O formato deve ser um destes: csv, sourceCode, dbUnit, html, json, markdown, sql, txt, xlsx, xml.")]
    [InlineData("CSV", "O formato deve ser um destes: csv, sourceCode, dbUnit, html, json, markdown, sql, txt, xlsx, xml.")]
    public void Validate_Format_ShouldBeRefusedOnTheField(string? format, string message)
        => Validator.TestValidate(Command(format: format)).ShouldHaveValidationErrorFor("format").WithErrorCode(OptionsInvalid).WithErrorMessage(message);

    [Trait("StartExportValidator", "StartExportCommand")]
    [Theory(DisplayName = "Erro o formato que esta versão ainda não escreve")]
    [InlineData("xml")]
    [InlineData("dbUnit")]
    [InlineData("xlsx")]
    public void Validate_FormatNotWrittenYet_ShouldBeRefusedOnTheField(string format)
        => Validator.TestValidate(Command(format: format)).ShouldHaveValidationErrorFor("format").WithErrorCode(OptionsInvalid)
            .WithErrorMessage($"O formato {format} ainda não é exportado por esta versão do Prism.");

    /// <summary>RN-EXPORT-011: duas colunas com o mesmo nome fariam um `INSERT` que o banco recusa; nos outros formatos o nome repetido passa.</summary>
    [Trait("StartExportValidator", "StartExportCommand")]
    [Fact(DisplayName = "Erro o SQL com duas colunas de mesmo nome; OK nos outros formatos")]
    public void Validate_SqlWithRepeatedColumnNames_ShouldBeRefused()
    {
        //Arrange
        ExportColumnDto[] columns = [new() { Position = 0, Name = "id" }, new() { Position = 1, Name = "ID" }, new() { Position = 2, Name = "id" }];
        var source = new ExportSourceDto { Kind = "query", ConnectionID = Guid.CreateVersion7(), Sql = "SELECT a.id, a.id AS \"ID\", b.id FROM a, b", Name = "pedido" };

        //Act
        var sql = Validator.TestValidate(Command(source: source, columns: columns, format: "sql"));
        var json = Validator.TestValidate(Command(source: source, columns: columns, format: "json"));

        //Assert
        sql.ShouldHaveValidationErrorFor("columns").WithErrorCode(OptionsInvalid).WithErrorMessage("O resultado tem duas colunas chamadas id: deixe uma de fora na Extração.");
        json.ShouldNotHaveAnyValidationErrors();
    }

    /// <summary>RN-EXPORT-014: o XLSX não é texto e já é compactado: sem BOM, sem .zip e sem a área de transferência.</summary>
    [Trait("StartExportValidator", "StartExportCommand")]
    [Fact(DisplayName = "Erro o XLSX com BOM, .zip ou área de transferência")]
    public void Validate_XlsxOutput_ShouldBeRefused()
    {
        //Act
        var result = Validator.TestValidate(Command(format: "xlsx", output: new ExportOutputDto { Bom = true, Zip = true, EntryName = "pedido.xlsx", Clipboard = true }));

        //Assert
        result.ShouldHaveValidationErrorFor("output.bom").WithErrorCode(OptionsInvalid);
        result.ShouldHaveValidationErrorFor("output.zip").WithErrorCode(OptionsInvalid);
        result.ShouldHaveValidationErrorFor("output.clipboard").WithErrorCode(OptionsInvalid);
    }

    [Trait("StartExportValidator", "StartExportCommand")]
    [Fact(DisplayName = "Erro a opção fora da faixa vai no caminho dela")]
    public void Validate_Options_ShouldBeRefusedOnTheirPath()
    {
        //Act
        var result = Validator.TestValidate(Command(format: "txt", options: """{ "minWidth": 0, "maxWidth": 100001 }"""));

        //Assert
        result.ShouldHaveValidationErrorFor("options.minWidth").WithErrorCode(OptionsInvalid);
        result.ShouldHaveValidationErrorFor("options.maxWidth").WithErrorCode(OptionsInvalid);
    }

    [Trait("StartExportValidator", "StartExportCommand")]
    [Fact(DisplayName = "Erro a área de transferência com BOM ou .zip")]
    public void Validate_ClipboardWithBomOrZip_ShouldBeRefused()
    {
        //Act
        var result = Validator.TestValidate(Command(output: new ExportOutputDto { Clipboard = true, Bom = true, Zip = true, EntryName = "pedido.csv" }));

        //Assert
        result.ShouldHaveValidationErrorFor("output.bom").WithErrorCode(OptionsInvalid);
        result.ShouldHaveValidationErrorFor("output.zip").WithErrorCode(OptionsInvalid);
    }

    public static TheoryData<string?> InvalidEntryNames()
        => [null, "", ".", "..", "a/b.csv", "a\\b.csv", "a\nb.csv", "pedido\u202Evsc.exe", new string('a', 129)];

    [Trait("StartExportValidator", "StartExportCommand")]
    [Theory(DisplayName = "Erro com o .zip, o nome de dentro falta ou fere a regra do nome do arquivo")]
    [MemberData(nameof(InvalidEntryNames))]
    public void Validate_ZipEntryName_ShouldBeRefused(string? entryName)
        => AssertRefused(Command(output: new ExportOutputDto { Zip = true, EntryName = entryName }), "output.entryName");

    [Trait("StartExportValidator", "StartExportCommand")]
    [Fact(DisplayName = "Erro o nome de dentro do .zip sem o .zip")]
    public void Validate_EntryNameWithoutZip_ShouldBeRefused()
        => AssertRefused(Command(output: new ExportOutputDto { EntryName = "pedido.csv" }), "output.entryName");

    [Trait("StartExportValidator", "StartExportCommand")]
    [Theory(DisplayName = "Erro a janela que não é um inteiro positivo")]
    [InlineData(0)]
    [InlineData(-3)]
    public void Validate_WindowID_ShouldBeRefused(long windowID)
        => AssertRefused(Command(windowID: windowID), "windowID");

    [Trait("StartExportValidator", "StartExportCommand")]
    [Fact(DisplayName = "Erro todas as recusas vêm de uma vez")]
    public void Validate_ShouldReturnEveryRefusalAtOnce()
    {
        //Act
        var result = Validator.TestValidate(Command(columns: [], format: "pdf", output: new ExportOutputDto { EntryName = "x.csv" }, windowID: 0));

        //Assert
        Assert.Equal(["columns", "format", "output.entryName", "windowID"], result.Errors.Select(error => error.PropertyName));
        Assert.All(result.Errors, error => Assert.Equal(OptionsInvalid, error.ErrorCode));
    }
}
