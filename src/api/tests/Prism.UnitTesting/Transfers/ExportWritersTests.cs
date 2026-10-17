using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Writers;
using System.Text;

namespace Prism.UnitTesting.Transfers;

/// <summary>
/// RN-EXPORT-006 a 010: o arquivo inteiro de cada formato que a API já escreve (CSV, TXT, HTML, Markdown, JSON e Código fonte), com as opções e os
/// padrões, o resultado sem linhas e o que conta para o aviso do fim. O valor e o escape de cada célula estão nas fixtures de ouro
/// (<see cref="ExportFixturesTests"/>); aqui é a estrutura do documento.
/// </summary>
public sealed class ExportWritersTests
{
    private static readonly ExportColumn[] Pedido = [new("id", "int4", "number"), new("cliente", "text", "text"), new("criado", "timestamp", "datetime")];

    private static readonly IReadOnlyList<ExportCell>[] PedidoRows =
    [
        [ExportCell.FromText("1"), ExportCell.FromText("Ana"), ExportCell.FromText("2024-01-15 10:30:00")],
        [ExportCell.FromText("2"), ExportCell.Null, ExportCell.FromText("2024-02-20 08:00:00+00")]
    ];

    private static readonly CsvExportOptions Csv = new(";", true, ECsvQuoting.Auto, true, "\r\n", string.Empty, EExportBinary.Hex);

    /// <summary>
    /// RN-EXPORT-007 e RN-TABELA-006: com os padrões, o arquivo é o do "Exportar CSV" da tela para as mesmas linhas (`toCsv`, sem o BOM, que é do arquivo):
    /// `;`, aspas só quando precisa, a proteção contra fórmula também no nome da coluna e CRLF no fim de cada linha, também da última.
    /// </summary>
    [Trait("CsvExportWriter", "Write")]
    [Fact(DisplayName = "OK o CSV com os padrões é o do Exportar CSV")]
    public void Csv_WithTheDefaults_IsTheExportCsvOfTheScreen()
    {
        //Arrange
        ExportColumn[] columns = [new("=id", "int4", "number"), new("nome; completo", "text", "text")];
        IReadOnlyList<ExportCell>[] rows = [[ExportCell.FromText("-1"), ExportCell.FromText("diz \"oi\"\r\n")], [ExportCell.Null, ExportCell.FromText("@x")]];

        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Csv, columns, rows, Csv);

        //Assert
        Assert.Equal("'=id;\"nome; completo\"\r\n-1;\"diz \"\"oi\"\"\r\n\"\r\n;'@x\r\n", text);
    }

    [Trait("CsvExportWriter", "Write")]
    [Fact(DisplayName = "OK o CSV sem linhas tem só o cabeçalho, e sem cabeçalho fica vazio")]
    public void Csv_WithoutRows_HasOnlyTheHeader()
    {
        //Act
        var (withHeader, _) = ExportWriting.Write(ExportFormats.Csv, Pedido, [], Csv);
        var (withoutHeader, _) = ExportWriting.Write(ExportFormats.Csv, Pedido, [], Csv with { Header = false });

        //Assert
        Assert.Equal("id;cliente;criado\r\n", withHeader);
        Assert.Equal(string.Empty, withoutHeader);
    }

    [Trait("CsvExportWriter", "Write")]
    [Fact(DisplayName = "OK o CSV com tabulação, LF, nulo como texto e todos os valores entre aspas")]
    public void Csv_WithTheOptions()
    {
        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Csv, Pedido, PedidoRows, Csv with { Delimiter = "\t", LineBreak = "\n", NullText = "NULL", Quoting = ECsvQuoting.All });

        //Assert
        Assert.Equal("\"id\"\t\"cliente\"\t\"criado\"\n\"1\"\t\"Ana\"\t\"2024-01-15 10:30:00\"\n\"2\"\tNULL\t\"2024-02-20 08:00:00+00\"\n", text);
    }

    /// <summary>
    /// RN-EXPORT-007 e 017: o campo vai ao arquivo em pedaços (o apóstrofo, as aspas e cada trecho entre duas aspas), sem montar o valor de novo; o
    /// valor grande, com aspas espalhadas e a proteção contra fórmula, sai igual ao campo do <see cref="ExportText.CsvField"/>, nos três modos de aspas.
    /// </summary>
    [Trait("CsvExportWriter", "Write")]
    [Theory(DisplayName = "OK o valor grande sai inteiro, com as aspas dobradas e a proteção, campo a campo")]
    [InlineData(ECsvQuoting.Auto)]
    [InlineData(ECsvQuoting.Text)]
    [InlineData(ECsvQuoting.All)]
    public void Csv_LargeValue_IsWrittenFieldByField(ECsvQuoting quoting)
    {
        //Arrange
        var large = "=" + string.Concat(Enumerable.Repeat("ab\"c;\r\n", 200_000)) + "\"";
        var options = Csv with { Header = false, Quoting = quoting };
        ExportColumn[] columns = [new("id", "int4", "number"), new("texto", "text", "text")];
        var field = new CsvFieldOptions(options.Delimiter, options.Quoting, options.FormulaGuard, options.NullText);

        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Csv, columns, [[ExportCell.FromText("1"), ExportCell.FromText(large)]], options);

        //Assert
        Assert.Equal($"{ExportText.CsvField("1", "number", field)};\"'{large.Replace("\"", "\"\"", StringComparison.Ordinal)}\"\r\n", text);
    }

    /// <summary>RN-EXPORT-002 e 006: o binário sai como a grade o escreve, `0x` e os dígitos em maiúsculas, inteiro (o "Deixar vazio" nem chega ao escritor: a célula vem nula).</summary>
    [Trait("CsvExportWriter", "Write")]
    [Fact(DisplayName = "OK o binário sai em hexadecimal inteiro")]
    public void Csv_Binary_IsWholeHex()
    {
        //Arrange
        var bytes = Enumerable.Range(0, 40).Select(value => (byte)value).ToArray();

        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Csv, [new ExportColumn("foto", "bytea", "binary")], [[ExportCell.FromBytes(bytes)]], Csv with { Header = false });

        //Assert
        Assert.Equal($"0x{Convert.ToHexString(bytes)}\r\n", text);
    }

    /// <summary>RN-EXPORT-006: o par substituto solto, que o UTF-8 não escreve, sai como U+FFFD (e não como `?`) nos formatos que não o tiram nem o escapam.</summary>
    [Trait("TextExportWriter", "Write")]
    [Theory(DisplayName = "OK o par substituto solto sai como U+FFFD")]
    [InlineData(ExportFormats.Csv)]
    [InlineData(ExportFormats.Txt)]
    [InlineData(ExportFormats.Markdown)]
    [InlineData(ExportFormats.SourceCode)]
    public void LoneSurrogate_IsWrittenAsTheReplacementCharacter(string format)
    {
        //Arrange
        ExportFormatOptions options = format switch
        {
            ExportFormats.Csv => Csv,
            ExportFormats.Txt => Txt,
            ExportFormats.Markdown => new MarkdownExportOptions(true, string.Empty, EExportBinary.Hex),
            _ => new SourceCodeExportOptions(false, false, true, EExportBinary.Hex)
        };

        //Act
        var (bytes, _) = ExportWriting.WriteBytes(format, [new ExportColumn("c", "text", "text")], [[ExportCell.FromText("a\uD83Db")]], options);

        //Assert
        var text = Encoding.UTF8.GetString(bytes);
        Assert.Contains("a\uFFFDb", text);
        Assert.DoesNotContain("a?b", text);
    }

    private static readonly TxtExportOptions Txt = new(true, true, true, 3, 0, false, "\n", EExportBinary.Hex);

    /// <summary>
    /// RN-EXPORT-008: as larguras são de cada lote de 200 linhas, e o cabeçalho sai uma vez, no alto, com as do primeiro. O lote seguinte, com um valor
    /// maior, alarga a coluna dele sem mudar as linhas já escritas.
    /// </summary>
    [Trait("TxtExportWriter", "Write")]
    [Fact(DisplayName = "OK as larguras do TXT são de cada lote de 200 linhas")]
    public void Txt_WidthsArePerBatchOf200Rows()
    {
        //Arrange
        var rows = Enumerable.Range(1, 200).Select(_ => (IReadOnlyList<ExportCell>)[ExportCell.FromText("a")]).Append([ExportCell.FromText("abcdef")]);

        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Txt, [new ExportColumn("c", "text", "text")], rows, Txt);

        //Assert
        var lines = text.Split('\n');
        Assert.Equal(["|c  |", "|---|", "|a  |"], lines[..3]);
        Assert.Equal("|a  |", lines[201]);
        Assert.Equal("|abcdef|", lines[202]);
        Assert.Equal(204, lines.Length);
    }

    /// <summary>RN-EXPORT-008: o lote fecha antes das 200 linhas quando os valores dele passam de 16 MiB.</summary>
    [Trait("TxtExportWriter", "Write")]
    [Fact(DisplayName = "OK o lote do TXT fecha quando os valores passam de 16 MiB")]
    public void Txt_BatchClosesPast16MiB()
    {
        //Arrange
        var large = new string('x', 6 * 1024 * 1024);
        IReadOnlyList<ExportCell>[] rows = [[ExportCell.FromText(large)], [ExportCell.FromText(large)], [ExportCell.FromText(large)], [ExportCell.FromText("y")]];

        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Txt, [new ExportColumn("c", "text", "text")], rows, Txt);

        //Assert
        Assert.EndsWith("\n|y  |\n", text);
    }

    [Trait("HtmlExportWriter", "Write")]
    [Fact(DisplayName = "OK o HTML com o título, os nomes, o número à direita e o nulo vazio")]
    public void Html_WithTheDefaults()
    {
        //Act
        var (text, counts) = ExportWriting.Write(ExportFormats.Html, Pedido, PedidoRows, new HtmlExportOptions(true, true, EExportBinary.Hex), sourceName: "pedido<\u0000>");

        //Assert
        Assert.StartsWith("<!DOCTYPE html>\n<html lang=\"pt-BR\">\n<head>\n<meta charset=\"utf-8\">\n<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">\n<title>pedido&lt;&gt;</title>\n", text);
        Assert.Contains("<table>\n<caption>pedido&lt;&gt;</caption>\n<thead>\n<tr><th scope=\"col\" class=\"num\">id</th><th scope=\"col\">cliente</th><th scope=\"col\">criado</th></tr>\n</thead>\n<tbody>\n", text);
        Assert.Contains("<tr><td class=\"num\">2</td><td class=\"null\"></td><td>2024-02-20 08:00:00+00</td></tr>\n", text);
        Assert.EndsWith("</tbody>\n</table>\n</body>\n</html>\n", text);
        Assert.DoesNotContain("<script", text);
        Assert.Equal(1, counts.RemovedCharacters);
    }

    [Trait("HtmlExportWriter", "Write")]
    [Fact(DisplayName = "OK o HTML sem título e sem nomes, e sem linhas")]
    public void Html_WithoutTitleNorNames()
    {
        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Html, Pedido, [], new HtmlExportOptions(false, false, EExportBinary.Hex));

        //Assert
        Assert.Contains("<title>Resultado</title>", text);
        Assert.DoesNotContain("<caption>", text);
        Assert.Contains("<table>\n<thead>\n</thead>\n<tbody>\n</tbody>\n</table>", text);
    }

    [Trait("MarkdownExportWriter", "Write")]
    [Fact(DisplayName = "OK o Markdown com a linha de alinhamento e o nulo como texto")]
    public void Markdown_WithTheAlignmentLine()
    {
        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Markdown, Pedido, PedidoRows, new MarkdownExportOptions(true, "*nulo*", EExportBinary.Hex));
        var (withoutAlignment, _) = ExportWriting.Write(ExportFormats.Markdown, Pedido, [], new MarkdownExportOptions(false, string.Empty, EExportBinary.Hex));

        //Assert
        Assert.Equal("| id | cliente | criado |\n| ---: | --- | --- |\n| 1 | Ana | 2024-01-15 10:30:00 |\n| 2 | \\*nulo\\* | 2024-02-20 08:00:00+00 |\n", text);
        Assert.Equal("| id | cliente | criado |\n", withoutAlignment);
    }

    /// <summary>RN-EXPORT-010: com o nome da origem, a lista vai um nível para dentro; o número sem aspas, o nulo `null`, a data em ISO 8601.</summary>
    [Trait("JsonExportWriter", "Write")]
    [Fact(DisplayName = "OK o JSON com o nome da origem e as datas em ISO 8601")]
    public void Json_Wrapped_WithIsoDates()
    {
        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Json, Pedido, PedidoRows, new JsonExportOptions(true, true, EExportBinary.Hex));

        //Assert
        Assert.Equal("{\n  \"pedido\": [\n    {\n      \"id\": 1,\n      \"cliente\": \"Ana\",\n      \"criado\": \"2024-01-15T10:30:00\"\n    },\n    {\n      \"id\": 2,\n      \"cliente\": null,\n      \"criado\": \"2024-02-20T08:00:00+00:00\"\n    }\n  ]\n}\n", text);
    }

    [Trait("JsonExportWriter", "Write")]
    [Fact(DisplayName = "OK o JSON só com a lista, as datas como na grade e as chaves repetidas com sufixo")]
    public void Json_Bare_WithGridDates()
    {
        //Arrange
        ExportColumn[] columns = [new("id", "int4", "number"), new("id", "int4", "number"), new("criado", "timestamp", "datetime")];

        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Json, columns, [[ExportCell.FromText("1"), ExportCell.FromText("2"), ExportCell.FromText("2024-01-15 10:30:00")]], new JsonExportOptions(false, false, EExportBinary.Hex));

        //Assert
        Assert.Equal("[\n  {\n    \"id\": 1,\n    \"id_2\": 2,\n    \"criado\": \"2024-01-15 10:30:00\"\n  }\n]\n", text);
    }

    [Trait("JsonExportWriter", "Write")]
    [Fact(DisplayName = "OK o JSON sem linhas é a lista vazia")]
    public void Json_WithoutRows_IsAnEmptyList()
    {
        //Act
        var (wrapped, _) = ExportWriting.Write(ExportFormats.Json, Pedido, [], new JsonExportOptions(true, true, EExportBinary.Hex));
        var (bare, _) = ExportWriting.Write(ExportFormats.Json, Pedido, [], new JsonExportOptions(false, true, EExportBinary.Hex));

        //Assert
        Assert.Equal("{\n  \"pedido\": []\n}\n", wrapped);
        Assert.Equal("[]\n", bare);
    }

    /// <summary>RN-EXPORT-010: o array do PHP como o DBeaver, com tabulação de recuo, uma vírgula depois de cada item e o `?&gt;` no fim.</summary>
    [Trait("SourceCodeExportWriter", "Write")]
    [Fact(DisplayName = "OK o Código fonte anterior ao PHP 5.4, com aspas duplas")]
    public void SourceCode_Legacy()
    {
        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.SourceCode, Pedido, PedidoRows, new SourceCodeExportOptions(false, false, true, EExportBinary.Hex), sourceName: "nota fiscal");

        //Assert
        Assert.Equal("<?php\n$nota_fiscal = array(\n\tarray(\n\t\t\"id\" => 1,\n\t\t\"cliente\" => \"Ana\",\n\t\t\"criado\" => \"2024-01-15T10:30:00\",\n\t),\n\tarray(\n\t\t\"id\" => 2,\n\t\t\"cliente\" => null,\n\t\t\"criado\" => \"2024-02-20T08:00:00+00:00\",\n\t),\n);\n?>\n", text);
    }

    [Trait("SourceCodeExportWriter", "Write")]
    [Fact(DisplayName = "OK o Código fonte do PHP 5.4, com aspas simples, e o caractere de direção tirado e contado")]
    public void SourceCode_Short_WithSingleQuotes()
    {
        //Arrange
        ExportColumn[] columns = [new("nome\u202E", "text", "text")];

        //Act
        var (text, counts) = ExportWriting.Write(ExportFormats.SourceCode, columns, [[ExportCell.FromText("d'água\u202E")], [ExportCell.FromText("x")]], new SourceCodeExportOptions(true, true, false, EExportBinary.Hex), sourceName: "1pedido\u202E");

        //Assert
        Assert.Equal("<?php\n$_1pedido = [\n\t[\n\t\t'nome' => 'd\\'água',\n\t],\n\t[\n\t\t'nome' => 'x',\n\t],\n];\n?>\n", text);
        Assert.Equal(3, counts.RemovedCharacters);
    }

    [Trait("SourceCodeExportWriter", "Write")]
    [Theory(DisplayName = "OK o Código fonte sem linhas é o array vazio")]
    [InlineData(false, "<?php\n$pedido = array();\n?>\n")]
    [InlineData(true, "<?php\n$pedido = [];\n?>\n")]
    public void SourceCode_WithoutRows_IsAnEmptyArray(bool shortArrays, string expected)
    {
        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.SourceCode, Pedido, [], new SourceCodeExportOptions(shortArrays, false, true, EExportBinary.Hex));

        //Assert
        Assert.Equal(expected, text);
    }
}
