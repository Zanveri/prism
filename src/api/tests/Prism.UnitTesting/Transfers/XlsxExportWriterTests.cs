using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Writers;
using System.IO.Compression;
using System.Xml.Linq;

namespace Prism.UnitTesting.Transfers;

/// <summary>
/// RN-EXPORT-013: a pasta de trabalho inteira, aberta como o Excel a abriria (o .zip e o XML de cada parte), além do que as fixtures `xlsx-*.json`
/// conferem: as partes e a compressão, o cabeçalho em negrito e congelado, o número e o texto (nunca fórmula), o nulo ausente, o corte que conta, e as
/// planilhas que continuam depois do limite de linhas, cada uma com o cabeçalho e o nome com o sufixo.
/// </summary>
public sealed class XlsxExportWriterTests
{
    private static readonly XNamespace Sheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

    private static readonly XNamespace Relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

    private static readonly XlsxExportOptions Options = new(EExportBinary.Hex);

    private static readonly ExportColumn[] Pedido = [new("id", "int4", "number"), new("cliente", "text", "text"), new("criado", "timestamp", "datetime"), new("ativo", "bool", "boolean"), new("foto", "bytea", "binary")];

    /// <summary>Escreve a pasta de trabalho como o client do arquivo temporário: <c>Begin</c>, as linhas em lotes com <c>Flush</c>, e <c>End</c>.</summary>
    private static (byte[] Bytes, ExportCounts Counts) Write(IReadOnlyList<ExportColumn> columns, IEnumerable<IReadOnlyList<ExportCell>> rows, string sourceName = "pedido", int sheetRowLimit = XlsxExportWriter.MaxSheetRows)
    {
        using var stream = new MemoryStream();
        var writer = new XlsxExportWriter(new ExportWriterContext(columns, sourceName, EDatabaseEngine.PostgreSql, Options), stream) { SheetRowLimit = sheetRowLimit };
        writer.Begin();
        foreach (var batch in rows.Chunk(1000))
        {
            foreach (var row in batch)
                writer.Write(row);

            writer.Flush();
        }

        writer.End();

        return (stream.ToArray(), writer.Counts);
    }

    private static XDocument Part(ZipArchive archive, string name)
    {
        using var stream = archive.GetEntry(name)!.Open();

        return XDocument.Load(stream);
    }

    private static List<XElement> RowsOf(XDocument sheet)
        => [.. sheet.Root!.Element(Sheet + "sheetData")!.Elements(Sheet + "row")];

    /// <summary>O texto de uma célula de texto embutido, ou o número de uma numérica.</summary>
    private static string? ValueOf(XElement cell)
        => cell.Attribute("t")?.Value == "inlineStr" ? cell.Element(Sheet + "is")!.Element(Sheet + "t")!.Value : cell.Element(Sheet + "v")?.Value;

    [Trait("XlsxExportWriter", "Write")]
    [Fact(DisplayName = "OK a pasta de trabalho tem as partes do Excel, compactadas, e a planilha com o nome da origem")]
    public void Workbook_HasTheParts_Compressed()
    {
        //Act
        var (bytes, counts) = Write(Pedido, Enumerable.Range(1, 2000).Select(index => (IReadOnlyList<ExportCell>)[ExportCell.FromText(index.ToString()), ExportCell.FromText("Cliente de nome repetido"), ExportCell.Null, ExportCell.Null, ExportCell.Null]));

        //Assert
        using var archive = new ZipArchive(new MemoryStream(bytes));
        Assert.Equal(["_rels/.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "[Content_Types].xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"], archive.Entries.Select(entry => entry.FullName));
        var sheet = archive.GetEntry("xl/worksheets/sheet1.xml")!;
        Assert.True(sheet.CompressedLength * 5 < sheet.Length, $"{sheet.CompressedLength} de {sheet.Length}");
        Assert.Equal(1, counts.Sheets);

        var workbook = Part(archive, "xl/workbook.xml");
        var listed = workbook.Root!.Element(Sheet + "sheets")!.Elements(Sheet + "sheet").Single();
        Assert.Equal("pedido", listed.Attribute("name")!.Value);
        Assert.Equal("rId1", listed.Attribute(Relationships + "id")!.Value);

        var types = Part(archive, "[Content_Types].xml").Root!.Elements().Select(element => element.Attribute("PartName")?.Value).OfType<string>();
        Assert.Equal(["/xl/workbook.xml", "/xl/worksheets/sheet1.xml", "/xl/styles.xml"], types);
        var relations = Part(archive, "xl/_rels/workbook.xml.rels").Root!.Elements().Select(element => $"{element.Attribute("Id")!.Value}={element.Attribute("Target")!.Value}");
        Assert.Equal(["rId1=worksheets/sheet1.xml", "rId2=styles.xml"], relations);
    }

    /// <summary>
    /// O cabeçalho em negrito (o estilo 1) e congelado; o número como número só quando cabe no Excel; a data, a hora, o lógico e o binário como texto; a
    /// fórmula como texto; o nulo é a célula ausente; o espaço das pontas fica.
    /// </summary>
    [Trait("XlsxExportWriter", "Write")]
    [Fact(DisplayName = "OK o cabeçalho em negrito e congelado, o número, o texto que nunca é fórmula e o nulo ausente")]
    public void Sheet_HasTheHeaderAndTheCells()
    {
        //Arrange
        IReadOnlyList<ExportCell>[] rows =
        [
            [ExportCell.FromText("12.50"), ExportCell.FromText("=1+1"), ExportCell.FromText("2024-01-15 10:30:00"), ExportCell.FromText("true"), ExportCell.FromBytes([0xDE, 0xAD])],
            [ExportCell.FromText("1234567890123456"), ExportCell.FromText("  com espaço  "), ExportCell.Null, ExportCell.Null, ExportCell.Null]
        ];

        //Act
        var (bytes, _) = Write(Pedido, rows);

        //Assert
        using var archive = new ZipArchive(new MemoryStream(bytes));
        var sheet = Part(archive, "xl/worksheets/sheet1.xml");
        var pane = sheet.Root!.Element(Sheet + "sheetViews")!.Element(Sheet + "sheetView")!.Element(Sheet + "pane")!;
        Assert.Equal(("1", "frozen"), (pane.Attribute("ySplit")!.Value, pane.Attribute("state")!.Value));
        Assert.Empty(sheet.Descendants(Sheet + "f"));

        var lines = RowsOf(sheet);
        Assert.Equal(["1", "2", "3"], lines.Select(line => line.Attribute("r")!.Value));
        Assert.All(lines[0].Elements(), cell => Assert.Equal("1", cell.Attribute("s")!.Value));
        Assert.Equal(["id", "cliente", "criado", "ativo", "foto"], lines[0].Elements().Select(ValueOf));
        Assert.Equal(["A1", "B1", "C1", "D1", "E1"], lines[0].Elements().Select(cell => cell.Attribute("r")!.Value));

        var first = lines[1].Elements().ToList();
        Assert.Null(first[0].Attribute("t"));
        Assert.Equal(["12.5", "=1+1", "2024-01-15 10:30:00", "true", "0xDEAD"], first.Select(ValueOf));
        Assert.All(first.Skip(1), cell => Assert.Equal("inlineStr", cell.Attribute("t")!.Value));
        Assert.All(first, cell => Assert.Null(cell.Attribute("s")));

        var second = lines[2].Elements().ToList();
        Assert.Equal(["A3", "B3"], second.Select(cell => cell.Attribute("r")!.Value));
        Assert.Equal(["1234567890123456", "  com espaço  "], second.Select(ValueOf));
        Assert.Equal("inlineStr", second[0].Attribute("t")!.Value);

        var styles = Part(archive, "xl/styles.xml");
        Assert.NotNull(styles.Root!.Element(Sheet + "fonts")!.Elements(Sheet + "font").ElementAt(1).Element(Sheet + "b"));
    }

    /// <summary>RN-EXPORT-006: sem linhas, a planilha tem só o cabeçalho.</summary>
    [Trait("XlsxExportWriter", "Write")]
    [Fact(DisplayName = "OK sem linhas, só o cabeçalho")]
    public void WithoutRows_HasOnlyTheHeader()
    {
        //Act
        var (bytes, counts) = Write(Pedido, []);

        //Assert
        using var archive = new ZipArchive(new MemoryStream(bytes));
        Assert.Single(RowsOf(Part(archive, "xl/worksheets/sheet1.xml")));
        Assert.Equal(1, counts.Sheets);
    }

    /// <summary>O texto acima de 32.767 caracteres é cortado no limite da célula, e conta um valor cortado por célula.</summary>
    [Trait("XlsxExportWriter", "Write")]
    [Fact(DisplayName = "OK o texto acima do limite da célula é cortado e conta")]
    public void LongText_IsCut_AndCounted()
    {
        //Arrange
        var text = new string('x', 40000);

        //Act
        var (bytes, counts) = Write([new ExportColumn("a", "text", "text"), new ExportColumn("b", "text", "text")], [[ExportCell.FromText(text), ExportCell.FromText(text)], [ExportCell.FromText("curto"), ExportCell.Null]]);

        //Assert
        using var archive = new ZipArchive(new MemoryStream(bytes));
        var lines = RowsOf(Part(archive, "xl/worksheets/sheet1.xml"));
        Assert.All(lines[1].Elements(), cell => Assert.Equal(ExportText.MaxCellLength, ValueOf(cell)!.Length));
        Assert.Equal(2, counts.CutValues);
    }

    /// <summary>
    /// Passando do limite de linhas de uma planilha (com o cabeçalho), as linhas continuam numa nova, com o cabeçalho e o nome com o sufixo; a primeira é a
    /// que abre à frente.
    /// </summary>
    [Trait("XlsxExportWriter", "Write")]
    [Fact(DisplayName = "OK as linhas continuam em planilhas novas, cada uma com o cabeçalho")]
    public void Rows_PastTheLimit_ContinueInNewSheets()
    {
        //Act
        var (bytes, counts) = Write([new ExportColumn("id", "int4", "number")], Enumerable.Range(1, 5).Select(index => (IReadOnlyList<ExportCell>)[ExportCell.FromText(index.ToString())]), sheetRowLimit: 3);

        //Assert
        Assert.Equal(3, counts.Sheets);
        using var archive = new ZipArchive(new MemoryStream(bytes));
        var sheets = Enumerable.Range(1, 3).Select(number => RowsOf(Part(archive, $"xl/worksheets/sheet{number}.xml"))).ToList();
        Assert.Equal([["id", "1", "2"], ["id", "3", "4"], ["id", "5"]], sheets.Select(rows => rows.Select(row => ValueOf(row.Elements().Single())).ToArray()));
        Assert.Equal(["1", "2", "3"], sheets[1].Select(row => row.Attribute("r")!.Value));

        var workbook = Part(archive, "xl/workbook.xml").Root!.Element(Sheet + "sheets")!.Elements(Sheet + "sheet").ToList();
        Assert.Equal(["pedido", "pedido (2)", "pedido (3)"], workbook.Select(sheet => sheet.Attribute("name")!.Value));
        Assert.Equal(["1", "2", "3"], workbook.Select(sheet => sheet.Attribute("sheetId")!.Value));
        Assert.Equal(["rId1", "rId2", "rId3"], workbook.Select(sheet => sheet.Attribute(Relationships + "id")!.Value));
        var tabs = Enumerable.Range(1, 3).Select(number => Part(archive, $"xl/worksheets/sheet{number}.xml").Root!.Element(Sheet + "sheetViews")!.Element(Sheet + "sheetView")!.Attribute("tabSelected")?.Value);
        Assert.Equal(["1", null, null], tabs);
        Assert.Equal(4, Part(archive, "xl/_rels/workbook.xml.rels").Root!.Elements().Count());
    }

    /// <summary>O limite de verdade: 1.048.576 linhas na primeira planilha, com o cabeçalho; a seguinte vai para a segunda.</summary>
    [Trait("XlsxExportWriter", "Write")]
    [Fact(DisplayName = "OK a primeira planilha tem 1.048.576 linhas, com o cabeçalho")]
    public void Sheet_HoldsTheExcelLimit()
    {
        //Act
        var (bytes, counts) = Write([new ExportColumn("n", "int4", "number")], Enumerable.Range(1, XlsxExportWriter.MaxSheetRows).Select(_ => (IReadOnlyList<ExportCell>)[ExportCell.FromText("1")]));

        //Assert
        Assert.Equal(2, counts.Sheets);
        using var archive = new ZipArchive(new MemoryStream(bytes));
        var first = TailOf(archive.GetEntry("xl/worksheets/sheet1.xml")!, 200);
        Assert.EndsWith($"<row r=\"{XlsxExportWriter.MaxSheetRows}\"><c r=\"A{XlsxExportWriter.MaxSheetRows}\"><v>1</v></c></row></sheetData></worksheet>", first);
        Assert.Equal(2, RowsOf(Part(archive, "xl/worksheets/sheet2.xml")).Count);
    }

    /// <summary>O fim do texto de uma parte, lido em pedaços: a planilha de um milhão de linhas não precisa caber inteira na memória do teste.</summary>
    private static string TailOf(ZipArchiveEntry entry, int length)
    {
        using var reader = new StreamReader(entry.Open());
        var buffer = new char[64 * 1024];
        var tail = string.Empty;
        int read;
        while ((read = reader.Read(buffer, 0, buffer.Length)) > 0)
        {
            tail += new string(buffer, 0, read);
            if (tail.Length > length)
                tail = tail[^length..];
        }

        return tail;
    }

    /// <summary>O nome da planilha seguinte cabe nos 31 caracteres com o sufixo, sem espaço no fim do corte, e nunca repete o de outra.</summary>
    [Trait("ExportText", "NextSheetName")]
    [Theory(DisplayName = "OK o nome da planilha seguinte")]
    [InlineData("pedido", 2, "pedido (2)")]
    [InlineData("abcdefghijklmnopqrstuvwxyz01234", 2, "abcdefghijklmnopqrstuvwxyz0 (2)")]
    [InlineData("abcdefghijklmnopqrstuvwxyz01234", 10, "abcdefghijklmnopqrstuvwxyz (10)")]
    [InlineData("abcdefghijklmnopqrstuvwxyz 1234", 2, "abcdefghijklmnopqrstuvwxyz (2)")]
    [InlineData("abcdefghijklmnopqrstuvwxyz0 (2)", 2, "abcdefghijklmnopqrstuvwxyz (2)")]
    public void NextSheetName_FitsAndNeverRepeats(string first, int number, string expected)
        => Assert.Equal(expected, ExportText.NextSheetName(first, number, [first]));

    /// <summary>A letra da coluna: A a Z, depois AA; a última do Excel é XFD.</summary>
    [Trait("ExportText", "ColumnLetters")]
    [Theory(DisplayName = "OK a letra da coluna")]
    [InlineData(0, "A")]
    [InlineData(25, "Z")]
    [InlineData(26, "AA")]
    [InlineData(701, "ZZ")]
    [InlineData(702, "AAA")]
    [InlineData(16383, "XFD")]
    public void ColumnLetters_AreTheExcelOnes(int index, string expected)
        => Assert.Equal(expected, ExportText.ColumnLetters(index));

    /// <summary>O <c>Flush</c> de cada lote leva ao fluxo o que a planilha já tem, compactado: é o tamanho que o progresso mostra.</summary>
    [Trait("XlsxExportWriter", "Flush")]
    [Fact(DisplayName = "OK o Flush leva a planilha ao arquivo durante a escrita")]
    public void Flush_GrowsTheFile()
    {
        //Arrange
        using var stream = new MemoryStream();
        var writer = new XlsxExportWriter(new ExportWriterContext([new ExportColumn("t", "text", "text")], "pedido", EDatabaseEngine.PostgreSql, Options), stream);
        writer.Begin();
        writer.Flush();
        var before = stream.Length;

        //Act
        var random = new Random(7);
        for (var index = 0; index < 2000; index++)
            writer.Write([ExportCell.FromText(new string([.. Enumerable.Range(0, 40).Select(_ => (char)random.Next('a', 'z'))]))]);

        writer.Flush();

        //Assert
        Assert.True(stream.Length > before + 10000, $"{before} e depois {stream.Length}");
    }
}
