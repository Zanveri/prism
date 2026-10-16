using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Writers;
using System.Text.Json;

namespace Prism.UnitTesting.Transfers;

/// <summary>
/// RN-EXPORT-006 a 013 e as notas da seção 6: as opções de cada formato, com o padrão do Prism no que não veio, e a recusa no campo (`options.…`) do
/// valor fora da lista ou da faixa e do tipo errado, todas de uma vez.
/// </summary>
public sealed class ExportOptionsReaderTests
{
    [Trait("ExportOptionsReader", "Read")]
    [Fact(DisplayName = "OK sem opções valem os padrões de cada formato")]
    public void Read_WithoutOptions_ShouldBeTheDefaults()
    {
        //Act
        var options = ExportFormats.All.ToDictionary(format => format, format => ExportOptionsReader.Read(format, null, "pedido").Options);

        //Assert
        Assert.Equal(new CsvExportOptions(";", true, ECsvQuoting.Auto, true, "\r\n", string.Empty, EExportBinary.Hex), options[ExportFormats.Csv]);
        Assert.Equal(new TxtExportOptions(true, true, true, 3, 0, false, "\r\n", EExportBinary.Hex), options[ExportFormats.Txt]);
        Assert.Equal(new HtmlExportOptions(true, true, EExportBinary.Hex), options[ExportFormats.Html]);
        Assert.Equal(new MarkdownExportOptions(true, string.Empty, EExportBinary.Hex), options[ExportFormats.Markdown]);
        Assert.Equal(new JsonExportOptions(true, true, EExportBinary.Hex), options[ExportFormats.Json]);
        Assert.Equal(new SourceCodeExportOptions(false, false, true, EExportBinary.Hex), options[ExportFormats.SourceCode]);
        Assert.Equal(new SqlExportOptions(null, "pedido", false, 10, EExportBinary.Literal), options[ExportFormats.Sql]);
        Assert.Equal(new XmlExportOptions(false, EExportBinary.Hex), options[ExportFormats.Xml]);
        Assert.Equal(new DbUnitExportOptions("pedido", true, false, EExportBinary.Hex), options[ExportFormats.DbUnit]);
        Assert.Equal(new XlsxExportOptions(EExportBinary.Hex), options[ExportFormats.Xlsx]);
    }

    [Trait("ExportOptionsReader", "Read")]
    [Fact(DisplayName = "OK as escolhas que vieram valem, e a chave que o formato não tem é ignorada")]
    public void Read_WithOptions_ShouldTakeThem()
    {
        //Arrange
        var json = Json("""{ "delimiter": "\t", "header": false, "quoting": "text", "formulaGuard": false, "lineBreak": "lf", "nullText": "NULL", "binary": "null", "rowsPerStatement": 5 }""");

        //Act
        var (options, errors) = ExportOptionsReader.Read(ExportFormats.Csv, json, null);

        //Assert
        Assert.Empty(errors);
        Assert.Equal(new CsvExportOptions("\t", false, ECsvQuoting.Text, false, "\n", "NULL", EExportBinary.Null), options);
    }

    [Trait("ExportOptionsReader", "Read")]
    [Fact(DisplayName = "Erro cada valor fora da lista, da faixa ou do tipo é recusado no campo dele")]
    public void Read_ShouldRefuseEveryInvalidValue_OnItsField()
    {
        //Arrange
        var json = Json("""{ "header": "sim", "headerLine": 1, "minWidth": 0, "maxWidth": 100001, "showNull": null, "lineBreak": "cr", "binary": "base64" }""");

        //Act
        var (options, errors) = ExportOptionsReader.Read(ExportFormats.Txt, json, null);

        //Assert
        Assert.Null(options);
        Assert.Equal(["options.minWidth", "options.maxWidth", "options.header", "options.headerLine", "options.lineBreak", "options.binary"], errors.Select(error => error.Field));
    }

    [Trait("ExportOptionsReader", "Read")]
    [Theory(DisplayName = "Erro as faixas que dependem de outra opção e os textos da pessoa")]
    [InlineData(ExportFormats.Txt, """{ "minWidth": 10, "maxWidth": 5 }""", "options.maxWidth", "A largura máxima não pode ser menor que a mínima.")]
    [InlineData(ExportFormats.Csv, """{ "nullText": "a\tb" }""", "options.nullText", "O texto do nulo não pode ter caractere de controle.")]
    [InlineData(ExportFormats.Markdown, """{ "nullText": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }""", "options.nullText", "O texto do nulo pode ter até 100 caracteres.")]
    [InlineData(ExportFormats.Sql, """{ "rowsPerStatement": 1001 }""", "options.rowsPerStatement", "As linhas por comando devem ser um número inteiro de 1 a 1.000.")]
    [InlineData(ExportFormats.Sql, """{ "schema": "a\nb" }""", "options.schema", "O nome não pode ter caractere de controle.")]
    [InlineData(ExportFormats.DbUnit, """{ "nulls": "empty" }""", "options.nulls", "O nulo deve ser omit ou mark.")]
    [InlineData(ExportFormats.SourceCode, """{ "php": "8" }""", "options.php", "A versão do PHP deve ser legacy ou short.")]
    public void Read_ShouldRefuse(string format, string json, string field, string message)
    {
        //Act
        var (options, errors) = ExportOptionsReader.Read(format, Json(json), "pedido");

        //Assert
        Assert.Null(options);
        Assert.Equal([new ExportOptionError(field, message)], errors);
    }

    /// <summary>RN-EXPORT-011: a tabela de destino do SQL e do DbUnit é a que veio; sem ela, a da origem; sem nenhuma das duas, a recusa no campo.</summary>
    [Trait("ExportOptionsReader", "Read")]
    [Theory(DisplayName = "OK a tabela de destino é a que veio, ou a da origem, e sem as duas é recusada")]
    [InlineData(ExportFormats.Sql)]
    [InlineData(ExportFormats.DbUnit)]
    public void Read_Table_ShouldDefaultToTheSource(string format)
    {
        //Act
        var given = ExportOptionsReader.Read(format, Json("""{ "table": "destino" }"""), "pedido").Options;
        var fromSource = ExportOptionsReader.Read(format, Json("""{ "table": "" }"""), "pedido").Options;
        var (missing, errors) = ExportOptionsReader.Read(format, null, null);

        //Assert
        Assert.Equal("destino", given is SqlExportOptions sql ? sql.Table : ((DbUnitExportOptions)given!).Table);
        Assert.Equal("pedido", fromSource is SqlExportOptions sqlFromSource ? sqlFromSource.Table : ((DbUnitExportOptions)fromSource!).Table);
        Assert.Null(missing);
        Assert.Equal([new ExportOptionError("options.table", "Informe a tabela de destino.")], errors);
    }

    [Trait("ExportOptionsReader", "Read")]
    [Fact(DisplayName = "Erro as opções que não são um objeto")]
    public void Read_ShouldRefuse_OptionsThatAreNotAnObject()
    {
        //Act
        var (options, errors) = ExportOptionsReader.Read(ExportFormats.Csv, Json("[1]"), null);

        //Assert
        Assert.Null(options);
        Assert.Equal([new ExportOptionError("options", "As opções do formato vêm num objeto.")], errors);
    }

    private static JsonElement Json(string json)
        => JsonDocument.Parse(json).RootElement;
}
