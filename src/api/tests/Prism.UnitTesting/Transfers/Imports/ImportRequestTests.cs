using FluentValidation.TestHelper;
using Prism.Application.Transfers.Features.PreviewImport;
using Prism.Application.Transfers.Features.ReadImportFile;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Infrastructure.Transfers.Imports;
using System.Text.Json;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// As notas da seção 36: a forma dos pedidos das prévias da importação, recusada de uma vez com `IMPORT_OPTIONS_INVALID` no campo, pelo caminho em camelCase
/// que a tela lê, e as opções do leitor lidas à mão, com o padrão do Prism no que não vem.
/// </summary>
public sealed class ImportRequestTests
{
    private const string OptionsInvalid = "IMPORT_OPTIONS_INVALID";
    private const string FileID = "0192f3a4-5b6c-7d8e-9fa0-b1c2d3e4f5a6";

    private static readonly ReadImportFileValidator ReadValidator = new();
    private static readonly PreviewImportValidator PreviewValidator = new();

    private static JsonElement Json(string json)
        => JsonDocument.Parse(json).RootElement.Clone();

    private static PreviewImportCommand Preview(string format = "csv", string? reader = null, ImportValuesDto? values = null, ImportTargetDto? target = null, IReadOnlyList<ImportMappingDto?>? mapping = null)
        => new()
        {
            FileID = FileID,
            Format = format,
            Reader = reader is null ? null : Json(reader),
            Values = values,
            Target = target ?? new ImportTargetDto { ConnectionID = Guid.CreateVersion7(), Schema = "estoque", Table = "pedido" },
            Mapping = mapping
        };

    [Trait("ImportReaderOptionsReader", "Read")]
    [Fact(DisplayName = "OK sem opções, os padrões do Prism em cada formato")]
    public void Read_WithoutOptions_ShouldUseTheDefaults()
    {
        //Act
        var (csv, _) = ImportReaderOptionsReader.Read(ImportFormats.Csv, null, keys: true);
        var (tsv, _) = ImportReaderOptionsReader.Read(ImportFormats.Tsv, Json("{}"), keys: true);
        var (json, _) = ImportReaderOptionsReader.Read(ImportFormats.Json, Json("""{"keys": ["id", "nome"]}"""), keys: true);
        var (read, _) = ImportReaderOptionsReader.Read(ImportFormats.Json, Json("""{"keys": ["id"]}"""), keys: false);
        var (xlsx, _) = ImportReaderOptionsReader.Read(ImportFormats.Xlsx, Json("""{"sheet": "Pedidos", "header": false}"""), keys: true);

        //Assert
        Assert.Equal(CsvImportOptions.Default, csv);
        Assert.Equal(CsvImportOptions.Default with { Delimiter = "\t" }, tsv);
        Assert.Equal(["id", "nome"], ((JsonImportOptions)json!).Keys!);
        Assert.Null(((JsonImportOptions)read!).Keys);
        Assert.Equal(new XlsxImportOptions("Pedidos", false, true), xlsx);
    }

    [Trait("ImportReaderOptionsReader", "Read")]
    [Fact(DisplayName = "ERRO cada opção fora da lista, da faixa ou do tipo, no campo dela")]
    public void Read_InvalidOptions_ShouldBeRefusedOnTheField()
    {
        //Act
        var (_, csv) = ImportReaderOptionsReader.Read(ImportFormats.Csv, Json("""{"encoding": "latin2", "delimiter": ":", "quote": "single", "nullText": "a\tb", "header": "sim"}"""), keys: true);
        var (_, tsv) = ImportReaderOptionsReader.Read(ImportFormats.Tsv, Json("""{"delimiter": ";"}"""), keys: true);
        var (_, json) = ImportReaderOptionsReader.Read(ImportFormats.Json, Json("""{"keys": ["id", "id"]}"""), keys: true);
        var (_, xlsx) = ImportReaderOptionsReader.Read(ImportFormats.Xlsx, Json($$"""{"sheet": "{{new string('p', 32)}}"}"""), keys: true);
        var (_, shape) = ImportReaderOptionsReader.Read(ImportFormats.Csv, Json("[]"), keys: true);

        //Assert
        Assert.Equal(["reader.encoding", "reader.delimiter", "reader.quote", "reader.nullText", "reader.header"], csv.Select(error => error.Field));
        Assert.Equal("O texto do nulo não pode ter caractere de controle.", csv.Single(error => error.Field == "reader.nullText").Message);
        Assert.Equal("No TSV o separador é a tabulação.", tsv.Single().Message);
        Assert.Equal("reader.keys", json.Single().Field);
        Assert.Equal("reader.sheet", xlsx.Single().Field);
        Assert.Equal("reader", shape.Single().Field);
    }

    [Trait("ReadImportFileValidator", "ReadImportFileCommand")]
    [Fact(DisplayName = "OK e ERRO o identificador do arquivo, o formato e as opções do leitor")]
    public void ReadValidator_ShouldCheckTheShape()
    {
        //Act
        var fine = ReadValidator.TestValidate(new ReadImportFileCommand { FileID = FileID, Format = "xlsx" });
        var wrong = ReadValidator.TestValidate(new ReadImportFileCommand { FileID = FileID.ToUpperInvariant(), Format = "xls" });
        var path = ReadValidator.TestValidate(new ReadImportFileCommand { FileID = "../../vault", Format = "csv", Reader = Json("""{"trim": 1}""") });

        //Assert
        fine.ShouldNotHaveAnyValidationErrors();
        wrong.ShouldHaveValidationErrorFor("fileID").WithErrorCode(OptionsInvalid);
        wrong.ShouldHaveValidationErrorFor("format").WithErrorCode(OptionsInvalid);
        path.ShouldHaveValidationErrorFor("fileID").WithErrorCode(OptionsInvalid);
        path.ShouldHaveValidationErrorFor("reader.trim").WithErrorCode(OptionsInvalid);
    }

    [Trait("PreviewImportValidator", "PreviewImportCommand")]
    [Fact(DisplayName = "OK o pedido com o mapeamento automático e com o mapeamento escolhido")]
    public void PreviewValidator_ShouldAcceptTheShape()
    {
        //Act
        var automatic = PreviewValidator.TestValidate(Preview(values: new ImportValuesDto { Decimal = "comma", ThousandsDot = true, Dates = "dayMonthYear" }));
        var chosen = PreviewValidator.TestValidate(Preview(format: "json", reader: """{"keys": ["id"]}""", mapping: [new ImportMappingDto { Source = 0, Target = "id" }]));

        //Assert
        automatic.ShouldNotHaveAnyValidationErrors();
        chosen.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("PreviewImportValidator", "PreviewImportCommand")]
    [Fact(DisplayName = "ERRO os formatos dos valores, a tabela de destino e a forma do mapeamento, no campo")]
    public void PreviewValidator_ShouldRefuseOnTheField()
    {
        //Act
        var values = PreviewValidator.TestValidate(Preview(values: new ImportValuesDto { Decimal = "point", ThousandsDot = true, Dates = "us" }));
        var target = PreviewValidator.TestValidate(Preview(target: new ImportTargetDto { Schema = "", Table = new string('t', 257) }));
        var mapping = PreviewValidator.TestValidate(Preview(mapping: [new ImportMappingDto { Source = -1, Target = "id" }, new ImportMappingDto { Source = 1, Target = "id" }, new ImportMappingDto { Source = 1, Target = "" }]));
        var empty = PreviewValidator.TestValidate(Preview(mapping: []));

        //Assert
        values.ShouldHaveValidationErrorFor("values.thousandsDot").WithErrorCode(OptionsInvalid);
        values.ShouldHaveValidationErrorFor("values.dates").WithErrorCode(OptionsInvalid);
        target.ShouldHaveValidationErrorFor("target.connectionID").WithErrorCode(OptionsInvalid);
        target.ShouldHaveValidationErrorFor("target.schema").WithErrorCode(OptionsInvalid);
        target.ShouldHaveValidationErrorFor("target.table").WithErrorCode(OptionsInvalid);
        mapping.ShouldHaveValidationErrorFor("mapping[0].source").WithErrorCode(OptionsInvalid);
        mapping.ShouldHaveValidationErrorFor("mapping[1].target").WithErrorCode(OptionsInvalid);
        mapping.ShouldHaveValidationErrorFor("mapping[2].source").WithErrorCode(OptionsInvalid);
        mapping.ShouldHaveValidationErrorFor("mapping[2].target").WithErrorCode(OptionsInvalid);
        empty.ShouldHaveValidationErrorFor("mapping").WithErrorCode(OptionsInvalid);
    }
}
