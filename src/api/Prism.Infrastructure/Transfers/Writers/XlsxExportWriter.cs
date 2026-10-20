using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;
using System.Globalization;
using System.IO.Compression;
using System.Text;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-013: uma pasta de trabalho do Excel, escrita em fluxo, linha a linha, num .zip compactado (deflate), sem guardar a planilha na memória: a
/// planilha é uma entrada do .zip aberta do começo ao fim dela, com as células em texto embutido (`inlineStr`, sem a tabela de textos compartilhados,
/// que pediria todos os textos na memória) e sem a `dimension`, que diria o tamanho antes de ele existir. As partes que dependem do número de
/// planilhas (`[Content_Types].xml`, `xl/workbook.xml` e as relações dela) são escritas no fim; a ordem das entradas no .zip não importa ao Excel.
///
/// As regras são as da tela (`to-xlsx.ts`): a planilha tem o nome da origem (<see cref="ExportText.SheetNameOf"/>); o cabeçalho tem os nomes das
/// colunas, em negrito e congelado; o número sai como número só quando cabe no Excel (<see cref="ExportText.SpreadsheetNumber"/>); a data, a hora, o
/// lógico e o binário saem como texto; o texto é sempre texto, nunca fórmula, com o escape `_xHHHH_` (<see cref="ExportText.XlsxText"/>); o nulo é a
/// célula ausente. O texto acima de 32.767 caracteres é cortado nele, sem partir um par, e conta em <see cref="ExportCounts.CutValues"/>. Passando de
/// 1.048.576 linhas numa planilha, com o cabeçalho, as linhas continuam numa nova, "pedido (2)", "pedido (3)"…, cada uma com o cabeçalho, e
/// <see cref="ExportCounts.Sheets"/> diz quantas.
/// </summary>
internal sealed class XlsxExportWriter(ExportWriterContext context, Stream output) : ExportWriter(context)
{
    /// <summary>O teto de uma planilha do Excel, com o cabeçalho.</summary>
    public const int MaxSheetRows = 1_048_576;

    private const string Declaration = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";
    private const string SheetNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private const string RelationshipNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private const string PackageRelationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
    private const string TypePrefix = "application/vnd.openxmlformats-officedocument.spreadsheetml";

    /// <summary>Dois estilos de célula: o 0, o padrão, e o 1, o negrito do cabeçalho; o Excel exige os dois preenchimentos de sempre e o estilo `Normal`.</summary>
    private const string Styles = Declaration + "<styleSheet xmlns=\"" + SheetNamespace + "\"><fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font><font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts><fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills><borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/></cellXfs><cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles></styleSheet>";

    private const string RootRelations = Declaration + "<Relationships xmlns=\"" + PackageRelationshipNamespace + "\"><Relationship Id=\"rId1\" Type=\"" + RelationshipNamespace + "/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>";

    private readonly IReadOnlyList<string> _letters = [.. Enumerable.Range(0, context.Columns.Count).Select(ExportText.ColumnLetters)];

    private readonly List<string> _sheets = [];

    private ZipArchive? _archive;
    private TextWriter? _sheet;
    private int _sheetRows;

    /// <summary>O teto de linhas de cada planilha, com o cabeçalho; menor só nos testes, que não escrevem um milhão de linhas para ver a segunda.</summary>
    internal int SheetRowLimit { get; init; } = MaxSheetRows;

    public override void Begin()
    {
        _archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true);
        WriteEntry("_rels/.rels", RootRelations);
        WriteEntry("xl/styles.xml", Styles);
        OpenSheet();
    }

    public override void Write(IReadOnlyList<ExportCell> row)
    {
        if (_sheetRows == SheetRowLimit)
        {
            CloseSheet();
            OpenSheet();
        }

        var number = (++_sheetRows).ToString(CultureInfo.InvariantCulture);
        var line = new StringBuilder("<row r=\"").Append(number).Append("\">");
        for (var index = 0; index < row.Count; index++)
        {
            if (ExportText.Of(row[index]) is not { } text)
                continue;

            var reference = _letters[index] + number;
            if (Columns[index].Kind == "number" && ExportText.SpreadsheetNumber(text) is { } value)
                line.Append("<c r=\"").Append(reference).Append("\"><v>").Append(value).Append("</v></c>");
            else
                AppendText(line, reference, text, header: false);
        }

        _sheet!.Write(line.Append("</row>").ToString());
    }

    public override void End()
    {
        CloseSheet();

        var overrides = string.Concat(_sheets.Select((_, index) => $"<Override PartName=\"/xl/worksheets/sheet{index + 1}.xml\" ContentType=\"{TypePrefix}.worksheet+xml\"/>"));
        WriteEntry("[Content_Types].xml", $"{Declaration}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"{TypePrefix}.sheet.main+xml\"/>{overrides}<Override PartName=\"/xl/styles.xml\" ContentType=\"{TypePrefix}.styles+xml\"/></Types>");

        var sheets = string.Concat(_sheets.Select((name, index) => $"<sheet name=\"{ExportText.EscapeXmlAttribute(name)}\" sheetId=\"{index + 1}\" r:id=\"rId{index + 1}\"/>"));
        WriteEntry("xl/workbook.xml", $"{Declaration}<workbook xmlns=\"{SheetNamespace}\" xmlns:r=\"{RelationshipNamespace}\"><bookViews><workbookView/></bookViews><sheets>{sheets}</sheets></workbook>");

        var relations = string.Concat(_sheets.Select((_, index) => $"<Relationship Id=\"rId{index + 1}\" Type=\"{RelationshipNamespace}/worksheet\" Target=\"worksheets/sheet{index + 1}.xml\"/>"));
        WriteEntry("xl/_rels/workbook.xml.rels", $"{Declaration}<Relationships xmlns=\"{PackageRelationshipNamespace}\">{relations}<Relationship Id=\"rId{_sheets.Count + 1}\" Type=\"{RelationshipNamespace}/styles\" Target=\"styles.xml\"/></Relationships>");

        _archive!.Dispose();
        _archive = null;
        Counts.Sheets = _sheets.Count;
    }

    /// <summary>Manda ao arquivo o que a planilha tem no buffer, compactado até ali, para o tamanho acompanhar o progresso.</summary>
    public override void Flush()
        => _sheet?.Flush();

    /// <summary>Abre a planilha seguinte: a entrada dela no .zip, o começo do XML (a primeira à frente, com o cabeçalho congelado) e o cabeçalho, em negrito.</summary>
    private void OpenSheet()
    {
        var first = _sheets.Count == 0;
        var name = first ? ExportText.SheetNameOf(Context.SourceName) : ExportText.NextSheetName(_sheets[0], _sheets.Count + 1, _sheets);
        _sheets.Add(name);

        var entry = _archive!.CreateEntry($"xl/worksheets/sheet{_sheets.Count}.xml", CompressionLevel.Optimal);
        _sheet = new StreamWriter(entry.Open(), ExportEncoding.Utf8, bufferSize: 64 * 1024);
        _sheet.Write($"{Declaration}<worksheet xmlns=\"{SheetNamespace}\"><sheetViews><sheetView{(first ? " tabSelected=\"1\"" : string.Empty)} workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/><selection pane=\"bottomLeft\" activeCell=\"A2\" sqref=\"A2\"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight=\"15\"/><sheetData>");

        _sheetRows = 1;
        var header = new StringBuilder("<row r=\"1\">");
        for (var index = 0; index < Columns.Count; index++)
            AppendText(header, $"{_letters[index]}1", Columns[index].Name, header: true);

        _sheet.Write(header.Append("</row>").ToString());
    }

    private void CloseSheet()
    {
        _sheet!.Write("</sheetData></worksheet>");
        _sheet.Dispose();
        _sheet = null;
    }

    /// <summary>Uma célula de texto embutido, com os espaços das pontas preservados; o texto acima do limite da célula é cortado, e conta.</summary>
    private void AppendText(StringBuilder line, string reference, string text, bool header)
    {
        var kept = ExportText.WithinCell(text);
        if (kept.Length < text.Length)
            Counts.CutValues++;

        line.Append("<c r=\"").Append(reference).Append(header ? "\" s=\"1\"" : "\"").Append(" t=\"inlineStr\"><is><t xml:space=\"preserve\">").Append(ExportText.XlsxText(kept)).Append("</t></is></c>");
    }

    private void WriteEntry(string name, string content)
    {
        using var writer = new StreamWriter(_archive!.CreateEntry(name, CompressionLevel.Optimal).Open(), ExportEncoding.Utf8);
        writer.Write(content);
    }
}
