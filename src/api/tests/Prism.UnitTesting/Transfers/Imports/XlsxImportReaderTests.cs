using CSharpFunctionalExtensions;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Readers;
using Serilog.Core;
using System.IO.Compression;
using System.Text;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// RN-IMPORT-006 e 008: o leitor do XLSX, sobre pastas de trabalho montadas na memória como o Excel as grava: a planilha escolhida, o cabeçalho na primeira
/// linha preenchida, os textos (compartilhados, em linha, formatados, com o `_xHHHH_`), o número no texto mais curto, a data pelo estilo, o lógico, o erro
/// do Excel, a fórmula sem resultado, o formato Strict, o `.xls` antigo e a proteção contra a bomba de zip.
/// </summary>
public sealed class XlsxImportReaderTests
{
    private const string Main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private const string Relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

    private const string Styles = $"""
        <styleSheet xmlns="{Main}">
          <numFmts count="3">
            <numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/>
            <numFmt numFmtId="165" formatCode="[h]:mm"/>
            <numFmt numFmtId="166" formatCode="&quot;dia&quot; d &quot;de&quot; mmmm"/>
          </numFmts>
          <cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs>
          <cellXfs count="7">
            <xf numFmtId="0"/>
            <xf numFmtId="14"/>
            <xf numFmtId="164"/>
            <xf numFmtId="21"/>
            <xf numFmtId="165"/>
            <xf numFmtId="46"/>
            <xf numFmtId="166"/>
          </cellXfs>
        </styleSheet>
        """;

    private static byte[] Workbook(string sheetData, string? sharedStrings = null, string? workbookPr = null, IReadOnlyList<(string Name, string? State, string Data)>? sheets = null, string? namespaceUri = null, string? styles = Styles)
    {
        var all = sheets ?? [("Pedidos", null, sheetData)];
        using var buffer = new MemoryStream();
        using (var archive = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            void Add(string name, string content)
            {
                using var writer = new StreamWriter(archive.CreateEntry(name).Open(), new UTF8Encoding(false));
                writer.Write(content);
            }

            Add("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>""");
            Add("xl/workbook.xml", $"""<workbook xmlns="{namespaceUri ?? Main}" xmlns:r="{Relationships}">{workbookPr}<sheets>{string.Concat(all.Select((sheet, index) => $"""<sheet name="{sheet.Name}" sheetId="{index + 1}"{(sheet.State is null ? string.Empty : $" state=\"{sheet.State}\"")} r:id="rId{index + 1}"/>"""))}</sheets></workbook>""");
            Add("xl/_rels/workbook.xml.rels", $"""<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{string.Concat(all.Select((_, index) => $"""<Relationship Id="rId{index + 1}" Type="{Relationships}/worksheet" Target="worksheets/sheet{index + 1}.xml"/>"""))}<Relationship Id="rS" Type="{Relationships}/styles" Target="styles.xml"/><Relationship Id="rT" Type="{Relationships}/sharedStrings" Target="/xl/sharedStrings.xml"/></Relationships>""");
            if (styles is not null)
                Add("xl/styles.xml", styles);

            if (sharedStrings is not null)
                Add("xl/sharedStrings.xml", $"""<sst xmlns="{Main}">{sharedStrings}</sst>""");

            for (var index = 0; index < all.Count; index++)
                Add($"xl/worksheets/sheet{index + 1}.xml", $"""<worksheet xmlns="{Main}"><sheetData>{all[index].Data}</sheetData></worksheet>""");
        }

        return buffer.ToArray();
    }

    private static Result<ImportReader, ImportReadFailure> Open(byte[] bytes, XlsxImportOptions? options = null)
        => ImportReader.Open(ImportFormats.Xlsx, options ?? XlsxImportOptions.Default, new MemoryStream(bytes), Logger.None, CancellationToken.None);

    private static (ImportReader Reader, List<ImportRecord> Records) ReadAll(byte[] bytes, XlsxImportOptions? options = null)
    {
        var opened = Open(bytes, options);
        Assert.True(opened.IsSuccess, opened.IsFailure ? opened.Error.Message : null);
        var records = new List<ImportRecord>();
        while (true)
        {
            var next = opened.Value.Next(CancellationToken.None);
            Assert.True(next.IsSuccess, next.IsFailure ? next.Error.Message : null);
            if (next.Value is null)
                return (opened.Value, records);

            records.Add(next.Value);
        }
    }

    private static ImportReadFailure FirstFailure(byte[] bytes, XlsxImportOptions? options = null)
    {
        var opened = Open(bytes, options);
        if (opened.IsFailure)
            return opened.Error;

        using var reader = opened.Value;
        while (true)
        {
            var next = reader.Next(CancellationToken.None);
            if (next.IsFailure)
                return next.Error;

            Assert.NotNull(next.Value);
        }
    }

    [Trait("XlsxImportReader", "Begin")]
    [Fact(DisplayName = "OK o cabeçalho na primeira linha preenchida, as colunas do cabeçalho e os textos compartilhados, em linha e formatados")]
    public void Begin_Header_ShouldStartAtTheFirstFilledRow()
    {
        //Arrange
        var bytes = Workbook(
            """
            <row r="2"><c r="B2" t="s"><v>5</v></c></row>
            <row r="3"><c r="B3" t="s"><v>0</v></c><c r="C3" t="inlineStr"><is><t xml:space="preserve"> nome </t></is></c><c r="D3" t="s"><v>1</v></c></row>
            <row r="4"><c r="B4"><v>1</v></c><c r="C4" t="s"><v>2</v></c><c r="D4" t="s"><v>3</v></c></row>
            <row r="5"><c r="B5"><v>2</v></c><c r="C5" t="inlineStr"><is><r><t>Bi</t></r><r><rPr><b/></rPr><t>a</t></r></is></c><c r="F5" t="s"><v>4</v></c></row>
            """,
            sharedStrings: """<si><t>id</t></si><si><t>obs</t></si><si><t>Ana</t><rPh sb="0" eb="1"><t>アナ</t></rPh></si><si><t>linha_x000D_quebrada</t></si><si><t>fora</t></si><si><t></t></si>""");

        //Act
        var (reader, records) = ReadAll(bytes);

        //Assert
        Assert.Equal(["id", "nome", "obs"], reader.Columns);
        Assert.Equal("Pedidos", reader.Info.Sheet);
        Assert.Equal([new ImportSheetInfo("Pedidos", false)], reader.Info.Sheets!);
        Assert.Equal(4, records[0].Line);
        Assert.Equal(new ImportValue("1", EImportValueSource.Canonical), records[0].Values[0]);
        Assert.Equal(new ImportValue("Ana", EImportValueSource.Text), records[0].Values[1]);
        Assert.Equal("linha\rquebrada", records[0].Values[2].Text);
        Assert.Equal("Bia", records[1].Values[1].Text);
        Assert.Equal("A linha 5 da planilha tem valor na coluna F, fora das colunas do cabeçalho (B a D).", records[1].Problem!.Message);
    }

    [Trait("XlsxImportReader", "ReadNext")]
    [Fact(DisplayName = "OK o número no texto mais curto, a data e a hora pelo estilo, o tempo decorrido como número e o lógico")]
    public void Next_Numbers_ShouldFollowTheStyle()
    {
        //Arrange
        var bytes = Workbook(
            """
            <row r="1"><c r="A1" t="inlineStr"><is><t>v</t></is></c></row>
            <row r="2"><c r="A2"><v>0.10000000000000001</v></c></row>
            <row r="3"><c r="A3"><v>1E+20</v></c></row>
            <row r="4"><c r="A4" s="1"><v>45306</v></c></row>
            <row r="5"><c r="A5" s="2"><v>45306.4375</v></c></row>
            <row r="6"><c r="A6" s="3"><v>0.5</v></c></row>
            <row r="7"><c r="A7" s="4"><v>1.5</v></c></row>
            <row r="8"><c r="A8" s="5"><v>2.25</v></c></row>
            <row r="9"><c r="A9" t="b"><v>1</v></c></row>
            <row r="10"><c r="A10" s="2"><v>45306.99999999999</v></c></row>
            <row r="11"><c r="A11" s="2"><v>45306.0000115740</v></c></row>
            <row r="12"><c r="A12" s="1"><v>1</v></c></row>
            <row r="13"><c r="A13" s="1"><v>61</v></c></row>
            <row r="14"><c r="A14" s="6"><v>45306</v></c></row>
            """);

        //Act
        var (_, records) = ReadAll(bytes);
        var texts = records.Select(record => record.Values[0].Text).ToList();

        //Assert
        Assert.Equal(["0.1", "1E+20", "2024-01-15", "2024-01-15 10:30:00", "12:00:00", "1.5", "2.25", "true", "2024-01-16 00:00:00", "2024-01-15 00:00:01", "1900-01-01", "1900-03-01", "2024-01-15"], texts!);
        Assert.All(records, record => Assert.Equal(EImportValueSource.Canonical, record.Values[0].Source));
    }

    [Trait("XlsxImportReader", "ReadNext")]
    [Fact(DisplayName = "OK os problemas da célula: o erro do Excel em português, o 29/02/1900 que não existe, a data negativa e a data ISO que não é ISO")]
    public void Next_CellProblems_ShouldBeMarked()
    {
        //Arrange
        var bytes = Workbook(
            """
            <row r="1"><c r="A1" t="inlineStr"><is><t>v</t></is></c></row>
            <row r="2"><c r="A2" t="e"><v>#N/A</v></c></row>
            <row r="3"><c r="A3" s="1"><v>60</v></c></row>
            <row r="4"><c r="A4" s="1"><v>-1</v></c></row>
            <row r="5"><c r="A5" t="d"><v>15/01/2024</v></c></row>
            <row r="6"><c r="A6" t="d"><v>2024-01-15T10:30:00Z</v></c></row>
            """);

        //Act
        var (_, records) = ReadAll(bytes);

        //Assert
        Assert.Equal("A célula A2 tem o erro #N/D do Excel.", records[0].Problem!.Message);
        Assert.Equal(0, records[0].Problem!.Column);
        Assert.Equal("A data 29/02/1900 do Excel não existe.", records[1].Problem!.Message);
        Assert.Equal("A célula A4 tem um número que não é uma data do Excel.", records[2].Problem!.Message);
        Assert.Equal("A célula A5 tem uma data que o Prism não lê.", records[3].Problem!.Message);
        Assert.Equal(new ImportValue("2024-01-15 10:30:00Z", EImportValueSource.Canonical), records[4].Values[0]);
    }

    [Trait("XlsxImportReader", "ReadNext")]
    [Fact(DisplayName = "OK a fórmula vale o resultado guardado; sem ele, chega vazia e é contada")]
    public void Next_Formulas_ShouldUseTheCachedResult()
    {
        //Arrange
        var bytes = Workbook(
            """
            <row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="B1" t="inlineStr"><is><t>b</t></is></c></row>
            <row r="2"><c r="A2"><f>1+1</f><v>2</v></c><c r="B2" t="str"><f>"x"&amp;"y"</f><v>xy</v></c></row>
            <row r="3"><c r="A3"><v>1</v></c><c r="B3"><f>SOMA(A1:A2)</f></c></row>
            """);

        //Act
        var (reader, records) = ReadAll(bytes);

        //Assert
        Assert.Equal("2", records[0].Values[0].Text);
        Assert.Equal(new ImportValue("xy", EImportValueSource.Text), records[0].Values[1]);
        Assert.Equal(ImportValue.Null, records[1].Values[1]);
        Assert.Equal(1, reader.FormulasWithoutValue);
    }

    [Trait("XlsxImportReader", "Begin")]
    [Fact(DisplayName = "OK a planilha: a primeira que não é oculta vem escolhida, a pedida é lida, e as ocultas vêm marcadas")]
    public void Begin_Sheets_ShouldChooseTheFirstVisible()
    {
        //Arrange
        var bytes = Workbook(string.Empty, sheets:
        [
            ("Oculta", "hidden", """<row r="1"><c r="A1" t="inlineStr"><is><t>oculta</t></is></c></row>"""),
            ("Pedidos", null, """<row r="1"><c r="A1" t="inlineStr"><is><t>pedidos</t></is></c></row>"""),
            ("Itens", "veryHidden", """<row r="1"><c r="A1" t="inlineStr"><is><t>itens</t></is></c></row>""")
        ]);

        //Act
        var (first, _) = ReadAll(bytes);
        var (chosen, _) = ReadAll(bytes, XlsxImportOptions.Default with { Sheet = "Itens" });
        var missing = FirstFailure(bytes, XlsxImportOptions.Default with { Sheet = "Clientes" });

        //Assert
        Assert.Equal("Pedidos", first.Info.Sheet);
        Assert.Equal(["pedidos"], first.Columns);
        Assert.Equal([new ImportSheetInfo("Oculta", true), new ImportSheetInfo("Pedidos", false), new ImportSheetInfo("Itens", true)], first.Info.Sheets!);
        Assert.Equal(["itens"], chosen.Columns);
        Assert.Equal(EImportReadReason.Sheet, missing.Reason);
        Assert.Equal("A planilha Clientes não existe no arquivo.", missing.Message);
    }

    [Trait("XlsxImportReader", "Begin")]
    [Fact(DisplayName = "OK sem cabeçalho, as colunas são as que têm valor nas linhas lidas, e a primeira linha preenchida é dado")]
    public void Begin_WithoutHeader_ShouldScanTheColumns()
    {
        //Arrange
        var bytes = Workbook(
            """
            <row r="2"><c r="C2"><v>1</v></c></row>
            <row r="3"><c r="B3"><v>2</v></c><c r="E3"><v>3</v></c></row>
            """);

        //Act
        var (reader, records) = ReadAll(bytes, XlsxImportOptions.Default with { Header = false });

        //Assert
        Assert.Equal(["Coluna 1", "Coluna 2", "Coluna 3", "Coluna 4"], reader.Columns);
        Assert.Equal([2L, 3L], records.Select(record => record.Line));
        Assert.Equal("1", records[0].Values[1].Text);
        Assert.Equal("3", records[1].Values[3].Text);
    }

    [Trait("XlsxImportReader", "ReadNext")]
    [Fact(DisplayName = "OK as linhas vazias: puladas e contadas; sem a opção, numa coluna só, viram um nulo, até a que falta no arquivo")]
    public void Next_EmptyRows_ShouldFollowTheCsvRules()
    {
        //Arrange
        var bytes = Workbook(
            """
            <row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row>
            <row r="2"><c r="A2"><v>1</v></c></row>
            <row r="3"><c r="A3" t="inlineStr"><is><t> </t></is></c></row>
            <row r="5"><c r="A5"><v>2</v></c></row>
            """);

        //Act
        var (skipping, skipped) = ReadAll(bytes);
        var (_, kept) = ReadAll(bytes, XlsxImportOptions.Default with { SkipEmptyLines = false });

        //Assert
        Assert.Equal([2L, 5L], skipped.Select(record => record.Line));
        Assert.Equal(1, skipping.SkippedLines);
        Assert.Equal([2L, 3L, 4L, 5L], kept.Select(record => record.Line));
        Assert.Equal(" ", kept[1].Values[0].Text);
        Assert.Equal(ImportValue.Null, kept[2].Values[0]);
    }

    [Trait("XlsxImportReader", "Begin")]
    [Fact(DisplayName = "OK o sistema de datas de 1904")]
    public void Next_Date1904_ShouldCountFrom1904()
    {
        //Arrange
        var bytes = Workbook("""<row r="1"><c r="A1" t="inlineStr"><is><t>d</t></is></c></row><row r="2"><c r="A2" s="1"><v>0</v></c></row>""", workbookPr: """<workbookPr date1904="1"/>""");

        //Act
        var (_, records) = ReadAll(bytes);

        //Assert
        Assert.Equal("1904-01-01", records[0].Values[0].Text);
    }

    [Trait("XlsxImportReader", "Begin")]
    [Fact(DisplayName = "ERRO o formato Strict, o .xls antigo (ou com senha), o arquivo que não é .zip e o XML com DTD")]
    public void Begin_UnsupportedFiles_ShouldBeRefused()
    {
        //Arrange
        var strict = Workbook("", namespaceUri: "http://purl.oclc.org/ooxml/spreadsheetml/main");
        byte[] legacy = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, .. new byte[100]];
        var text = Encoding.UTF8.GetBytes("id;nome\n1;Ana\n");
        var doctype = Workbook("<row r=\"1\"/>", styles: "<!DOCTYPE x [<!ENTITY a \"b\">]><styleSheet xmlns=\"" + Main + "\"/>");

        //Act
        var strictRefusal = FirstFailure(strict);
        var legacyRefusal = FirstFailure(legacy);
        var textRefusal = FirstFailure(text);
        var doctypeRefusal = FirstFailure(doctype);

        //Assert
        Assert.Equal("A planilha está no formato Strict do Office Open XML, que o Prism não lê. No Excel, salve-a como Pasta de Trabalho do Excel (.xlsx).", strictRefusal.Message);
        Assert.Equal("Este arquivo não é um .xlsx que o Prism lê: é uma planilha do Excel antigo (.xls) ou uma planilha com senha. No Excel, salve-a como .xlsx, sem senha.", legacyRefusal.Message);
        Assert.Equal(EImportReadReason.Format, textRefusal.Reason);
        Assert.Equal(EImportReadReason.Format, doctypeRefusal.Reason);
    }

    [Trait("XlsxImportReader", "Limits")]
    [Fact(DisplayName = "ERRO mais de 10.000 entradas no .zip e o nome de entrada repetido, antes do ZipArchive")]
    public void Begin_ZipLimits_ShouldBeRefused()
    {
        //Arrange
        var many = new MemoryStream();
        using (var archive = new ZipArchive(many, ZipArchiveMode.Create, leaveOpen: true))
        {
            for (var index = 0; index <= XlsxPackage.MaxEntries; index++)
                archive.CreateEntry($"x/{index}.xml", CompressionLevel.NoCompression);
        }

        var repeated = new MemoryStream();
        using (var archive = new ZipArchive(repeated, ZipArchiveMode.Create, leaveOpen: true))
        {
            archive.CreateEntry("[Content_Types].xml");
            archive.CreateEntry("[Content_Types].xml");
        }

        //Act
        var manyRefusal = FirstFailure(many.ToArray());
        var repeatedRefusal = FirstFailure(repeated.ToArray());

        //Assert
        Assert.Equal(EImportReadReason.Limits, manyRefusal.Reason);
        Assert.Equal("A planilha passa dos limites que o Prism lê de um .xlsx.", manyRefusal.Message);
        Assert.Equal("A planilha passa dos limites que o Prism lê de um .xlsx.", repeatedRefusal.Message);
    }

    [Trait("XlsxImportReader", "Limits")]
    [Fact(DisplayName = "ERRO a célula fora de A1:XFD1048576")]
    public void Next_CellOutOfBounds_ShouldBeRefused()
    {
        //Arrange
        var bytes = Workbook("""<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row><row r="2"><c r="XFE2"><v>1</v></c></row>""");

        //Act
        var refusal = FirstFailure(bytes);

        //Assert
        Assert.Equal(EImportReadReason.Limits, refusal.Reason);
        Assert.Equal("A planilha tem uma célula fora dos limites do Excel.", refusal.Message);
    }

    [Trait("XlsxImportReader", "Limits")]
    [Fact(DisplayName = "ERRO o texto em linha acima de 64 MiB para a leitura em pedaços, com a linha e a coluna")]
    public void Next_ValueAbove64MiB_ShouldBeRefused()
    {
        //Arrange
        var bytes = Workbook($"""<row r="1"><c r="A1" t="inlineStr"><is><t>id</t></is></c><c r="B1" t="inlineStr"><is><t>obs</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2" t="inlineStr"><is><t>{new string('x', (int)ImportReader.MaxValueBytes + 1)}</t></is></c></row>""");

        //Act
        var refusal = FirstFailure(bytes);

        //Assert
        Assert.True(refusal.ValueTooLarge);
        Assert.Equal(2, refusal.Line);
        Assert.Equal("obs", refusal.Column);
        Assert.Equal("Um valor da linha 2 da planilha Pedidos, coluna obs, passa de 64 MiB, e o Prism não o importa.", refusal.Message);
    }

    [Trait("XlsxImportReader", "ReadNext")]
    [Fact(DisplayName = "OK o _xHHHH_ que cai na divisa entre dois pedaços do texto é desfeito, nos textos compartilhados, em linha e de fórmula")]
    public void Next_EscapeAcrossChunks_ShouldBeDecoded()
    {
        //Arrange
        var before = new string('a', 16 * 1024 - 3);
        var bytes = Workbook(
            $"""
            <row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="B1" t="inlineStr"><is><t>b</t></is></c><c r="C1" t="inlineStr"><is><t>c</t></is></c></row>
            <row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="inlineStr"><is><t>{before}_x005F_x0041_</t></is></c><c r="C2" t="str"><f>A2</f><v>{before}_x000D_b</v></c></row>
            """,
            sharedStrings: $"""<si><t>{before}_x000D_b</t></si>""");

        //Act
        var (_, records) = ReadAll(bytes);

        //Assert
        Assert.Equal($"{before}\rb", records[0].Values[0].Text);
        Assert.Equal($"{before}_x0041_", records[0].Values[1].Text);
        Assert.Equal($"{before}\rb", records[0].Values[2].Text);
    }

    /// <summary>
    /// RN-IMPORT-008: o XML de milhões de níveis (a fórmula que o leitor pula, um texto compartilhado) é recusado ao passar de 64 níveis, sem o `XmlReader`
    /// guardar um nó por nível, com a frase própria da emenda de 2026-10-17; os níveis do que o Excel grava, e algum a mais, passam, até os 64.
    /// </summary>
    [Trait("XlsxImportReader", "Limits")]
    [Fact(DisplayName = "ERRO o XML fundo demais na planilha e nos textos compartilhados é recusado com a frase dos níveis, e o fundo até 64 passa")]
    public void Next_TooDeep_ShouldBeRefused()
    {
        //Arrange
        static string Nested(int levels, string inner)
            => $"{string.Concat(Enumerable.Repeat("<x>", levels))}{inner}{string.Concat(Enumerable.Repeat("</x>", levels))}";

        const string Header = """<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row>""";
        var deepFormula = Workbook($"""{Header}<row r="2"><c r="A2"><f>{Nested(200_000, "A1")}</f><v>1</v></c></row>""");
        var deepShared = Workbook($"""{Header}<row r="2"><c r="A2" t="s"><v>0</v></c></row>""", sharedStrings: $"<si>{Nested(200_000, "<t>b</t>")}</si>");
        var fine = Workbook($"""{Header}<row r="2"><c r="A2"><f>{Nested(40, "A1")}</f><v>1</v></c></row>""");

        // O `f` é o quinto nível (`worksheet`, `sheetData`, `row`, `c`, `f`): com 59 níveis dentro dele, a planilha tem 64, e passa; com 60, tem 65.
        var atTheLimit = Workbook($"""{Header}<row r="2"><c r="A2"><f>{Nested(59, "A1")}</f><v>1</v></c></row>""");
        var pastTheLimit = Workbook($"""{Header}<row r="2"><c r="A2"><f>{Nested(60, "A1")}</f><v>1</v></c></row>""");

        //Act
        var formulaRefusal = FirstFailure(deepFormula);
        var sharedRefusal = FirstFailure(deepShared);
        var pastRefusal = FirstFailure(pastTheLimit);
        var (_, records) = ReadAll(fine);
        var (_, limitRecords) = ReadAll(atTheLimit);

        //Assert
        Assert.Equal((EImportReadReason.Limits, "A planilha tem elementos aninhados demais (mais de 64 níveis)."), (formulaRefusal.Reason, formulaRefusal.Message));
        Assert.Equal((EImportReadReason.Limits, "A planilha tem elementos aninhados demais (mais de 64 níveis)."), (sharedRefusal.Reason, sharedRefusal.Message));
        Assert.Equal((EImportReadReason.Limits, "A planilha tem elementos aninhados demais (mais de 64 níveis)."), (pastRefusal.Reason, pastRefusal.Message));
        Assert.Equal("1", Assert.Single(records).Values[0].Text);
        Assert.Equal("1", Assert.Single(limitRecords).Values[0].Text);
    }

    /// <summary>
    /// RN-IMPORT-008 (emenda de 2026-10-17): os textos compartilhados contam, além dos caracteres em UTF-16, 32 bytes cada, e assim os milhões de textos
    /// vazios, que antes contavam zero, também param nos 256 MiB: um texto de um caractere e 8.388.606 vazios ficam 30 bytes abaixo deles, e com um vazio a
    /// mais a planilha passa 2 bytes e é recusada com a frase dos textos da planilha.
    /// </summary>
    [Trait("XlsxImportReader", "Limits")]
    [Fact(DisplayName = "ERRO os textos compartilhados minúsculos contam 32 bytes cada e param nos 256 MiB")]
    public void Begin_ManyTinySharedStrings_ShouldCountTheOverhead()
    {
        //Arrange
        const int Fit = 256 * 1024 * 1024 / XlsxImportReader.SharedStringOverhead;
        const string Sheet = """<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>b</t></is></c></row>""";
        var fits = Workbook(Sheet, sharedStrings: $"<si><t>a</t></si>{string.Concat(Enumerable.Repeat("<si/>", Fit - 2))}");
        var tooMany = Workbook(Sheet, sharedStrings: $"<si><t>a</t></si>{string.Concat(Enumerable.Repeat("<si/>", Fit - 1))}");

        //Act
        var opened = Open(fits);
        var refusal = FirstFailure(tooMany);

        //Assert
        Assert.True(opened.IsSuccess, opened.IsFailure ? opened.Error.Message : null);
        opened.Value.Dispose();
        Assert.Equal((EImportReadReason.Limits, "Os textos da planilha passam de 256 MiB, o que o Prism lê de uma planilha. No Excel, salve a planilha como CSV e importe o CSV."), (refusal.Reason, refusal.Message));
    }

    [Trait("XlsxImportReader", "Limits")]
    [Fact(DisplayName = "ERRO a entrada que descompacta além do teto para enquanto é lida, sem confiar no tamanho declarado")]
    public void CountingStream_AboveTheLimit_ShouldStop()
    {
        //Arrange
        using var stream = new CountingStream(new MemoryStream(new byte[100]), 64);
        var buffer = new byte[40];

        //Act
        var first = stream.Read(buffer, 0, buffer.Length);
        var refusal = Assert.Throws<ImportReadException>(() => stream.Read(buffer, 0, buffer.Length));

        //Assert
        Assert.Equal(40, first);
        Assert.Equal(EImportReadReason.Limits, refusal.Failure.Reason);
    }

    [Trait("XlsxCells", "KindOf")]
    [Theory(DisplayName = "OK o formato de número diz data, data e hora, hora ou número")]
    [InlineData(14, null, "Date")]
    [InlineData(22, null, "DateTime")]
    [InlineData(21, null, "Time")]
    [InlineData(46, null, "Number")]
    [InlineData(2, null, "Number")]
    [InlineData(164, "YYYY-MM-DD", "Date")]
    [InlineData(164, "dd/mm/yyyy hh:mm", "DateTime")]
    [InlineData(164, "hh:mm:ss", "Time")]
    [InlineData(164, "mm:ss", "Time")]
    [InlineData(164, "[h]:mm:ss", "Number")]
    [InlineData(164, "[Red][$-416]#,##0.00", "Number")]
    [InlineData(164, "\"dias\" 0", "Number")]
    [InlineData(164, "0\\d", "Number")]
    [InlineData(164, "h:mm AM/PM", "Time")]
    [InlineData(164, "mmm-yy", "Date")]
    [InlineData(164, "General", "Number")]
    public void KindOf_ShouldReadTheFormat(int id, string? code, string expected)
        => Assert.Equal(expected, XlsxCells.KindOf(id, code).ToString());
}
