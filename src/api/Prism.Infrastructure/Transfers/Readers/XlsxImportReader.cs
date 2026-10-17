using Prism.Infrastructure.Transfers.Imports;
using System.Globalization;
using System.Text;
using System.Xml;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Transfers.Readers;

/// <summary>
/// RN-IMPORT-006 e 008: o XLSX, lido pelo <see cref="XlsxPackage"/> (o .zip com a proteção contra a bomba de zip) e pelo <see cref="XmlReader"/>, sem DTD,
/// sem resolver nada de fora e sem descompactar nada para o disco. Abre só as partes que usa (`[Content_Types].xml`, a pasta de trabalho, as relações
/// dela, os estilos, os textos compartilhados e a planilha escolhida). Os textos compartilhados ficam na memória, até 256 MiB; a planilha é lida linha a
/// linha. A fórmula nunca é lida nem calculada: a célula vale o resultado que o Excel guardou com ela.
/// </summary>
internal sealed class XlsxImportReader(Stream stream, XlsxImportOptions options, ILogger logger) : ImportReader(stream, logger)
{
    /// <summary>RN-IMPORT-008: os tetos de cada parte, descompactada.</summary>
    private const long SmallPartLimit = 16L * 1024 * 1024;
    private const long StylesLimit = 64L * 1024 * 1024;
    private const long SharedStringsLimit = 1024L * 1024 * 1024;
    private const long SheetLimit = 16L * 1024 * 1024 * 1024;

    /// <summary>RN-IMPORT-008: os textos compartilhados na memória, contados em UTF-16, como o .NET os guarda, mais <see cref="SharedStringOverhead"/> por texto.</summary>
    private const long MaxSharedStringBytes = 256L * 1024 * 1024;

    /// <summary>
    /// RN-IMPORT-008 (emenda de 2026-10-17): o que cada texto compartilhado conta além dos caracteres, para os milhões de textos minúsculos também terem
    /// teto (o objeto do `string` e a referência na lista ocupam isso mesmo com o texto vazio).
    /// </summary>
    internal const int SharedStringOverhead = 32;

    /// <summary>RN-IMPORT-006: sem cabeçalho, as colunas são as que têm valor nas linhas que a leitura da prévia percorre.</summary>
    private const int ColumnScanRows = 1000;

    /// <summary>
    /// RN-IMPORT-008: os níveis de elementos que o XML de uma parte pode ter, contando o elemento de fora como o primeiro. O `XmlReader` não tem teto, e
    /// guarda um nó por nível aberto: alguns MiB de `.zip` com milhões de níveis viram gigabytes na memória. As partes que o Excel grava não passam de uns
    /// 10 níveis; o teto é o do JSON (RN-IMPORT-005).
    /// </summary>
    private const int MaxDepth = 64;

    /// <summary>RN-IMPORT-008 (emenda de 2026-10-17): a frase própria do XML que passa de <see cref="MaxDepth"/> níveis.</summary>
    internal const string TooDeepMessage = "A planilha tem elementos aninhados demais (mais de 64 níveis).";

    private const string ContentTypesPart = "[Content_Types].xml";
    private const string DefaultWorkbookPart = "xl/workbook.xml";
    private const string StrictNamespace = "http://purl.oclc.org/ooxml/spreadsheetml/main";
    private const string RelationshipsNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

    private static readonly string[] WorkbookContentTypes =
    [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
        "application/vnd.ms-excel.template.macroEnabled.main+xml"
    ];

    private static readonly XmlReaderSettings Settings = new()
    {
        DtdProcessing = DtdProcessing.Prohibit,
        XmlResolver = null,
        IgnoreComments = true,
        IgnoreProcessingInstructions = true,
        CloseInput = true
    };

    /// <summary>O pedaço do texto de um elemento, lido pelo `ReadValueChunk`.</summary>
    private readonly char[] _chunk = new char[16 * 1024];

    private XlsxPackage _package = null!;
    private string _sheetPart = string.Empty;
    private string _sheetName = string.Empty;
    private bool _date1904;
    private List<string> _sharedStrings = [];
    private EXlsxNumberKind[] _styles = [];
    private CountingStream? _sheetStream;
    private XmlReader? _sheet;
    private int _firstColumn;
    private int _width;
    private int _dataStart;
    private int _previousRow;
    private int _nextLine;
    private bool _header;
    private SheetRow? _pendingRow;

    public override long Position => _sheetStream?.Count ?? 0;

    public override long Size => _package?.Declared.GetValueOrDefault(_sheetPart) ?? 0;

    public override void Dispose()
    {
        _sheet?.Dispose();
        _package?.Dispose();
        base.Dispose();
    }

    protected override void Begin(CancellationToken cancellationToken)
    {
        _package = XlsxPackage.Open(Stream);
        var workbookPart = WorkbookPart();
        var folder = workbookPart.Contains('/') ? workbookPart[..(workbookPart.LastIndexOf('/') + 1)] : string.Empty;
        var (sheets, ids) = ReadWorkbook(workbookPart);
        var relationships = ReadRelationships($"{folder}_rels/{workbookPart[folder.Length..]}.rels", folder);

        if (sheets.Count == 0)
            throw SheetRefusal("A pasta de trabalho não tem planilhas.");

        var chosen = options.Sheet is { } name ? sheets.FindIndex(sheet => sheet.Name == name) : sheets.FindIndex(sheet => !sheet.Hidden);
        if (chosen < 0 && options.Sheet is not null)
            throw SheetRefusal($"A planilha {options.Sheet} não existe no arquivo.");

        chosen = Math.Max(chosen, 0);
        _sheetName = sheets[chosen].Name;
        _sheetPart = relationships.Targets.GetValueOrDefault(ids[chosen]) ?? throw XlsxPackage.Format($"Este arquivo não é um .xlsx que o Prism lê: a planilha {_sheetName} não tem a parte dela.");

        _styles = relationships.Styles is { } styles && _package.Has(styles) ? ReadStyles(styles) : [];
        _sharedStrings = relationships.SharedStrings is { } shared && _package.Has(shared) ? ReadSharedStrings(shared, cancellationToken) : [];
        _header = options.Header;

        IReadOnlyList<string> columns = [];
        OpenSheet();
        if (FirstFilledRow(cancellationToken) is { } first)
        {
            var filled = first.Cells.Where(cell => IsFilled(cell.Value)).Select(cell => cell.Column).ToList();
            if (_header)
            {
                _firstColumn = filled.Min();
                _width = filled.Max() - _firstColumn + 1;
                _dataStart = first.Number + 1;
                var texts = new string?[_width];
                foreach (var cell in first.Cells.Where(cell => cell.Column >= _firstColumn && cell.Column < _firstColumn + _width))
                    texts[cell.Column - _firstColumn] = cell.Problem is null ? cell.Value.Text : cell.ErrorCode;

                columns = ImportText.ColumnNames(texts);
                if (columns.Select((column, position) => (column, position)).FirstOrDefault(column => column.column.Length > MaxColumnNameLength) is { column: not null } tooLong)
                    throw ColumnNameTooLong(tooLong.position);
            }
            else
            {
                (_firstColumn, var last) = ScanColumns(first, cancellationToken);
                _width = last - _firstColumn + 1;
                _dataStart = first.Number;
                columns = [.. Enumerable.Range(0, _width).Select(ImportText.DefaultColumnName)];
                OpenSheet();
            }
        }

        _previousRow = 0;
        _nextLine = _dataStart;
        Info = new ImportReadInfo(null, null, null, [.. sheets.Select(sheet => new ImportSheetInfo(sheet.Name, sheet.Hidden))], _sheetName, columns);
    }

    protected override ImportRecord? ReadNext(CancellationToken cancellationToken)
    {
        if (_width == 0)
            return null;

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var row = _pendingRow ?? NextRow();
            _pendingRow = null;
            if (row is null)
                return null;

            if (row.Number < _dataStart)
                continue;

            // RN-IMPORT-006, nas regras do CSV: sem "Pular linhas vazias", a linha que não está no arquivo é, no arquivo de uma coluna só, um campo vazio.
            if (row.Number > _nextLine && _width == 1 && !options.SkipEmptyLines)
            {
                _pendingRow = row;

                return new ImportRecord(_nextLine++, [ImportValue.Null], null, false);
            }

            _nextLine = row.Number + 1;
            var record = ToRecord(row, out var empty, out var blank);
            if ((empty && (options.SkipEmptyLines || _width > 1)) || (blank && options.SkipEmptyLines))
            {
                SkippedLines++;
                continue;
            }

            return record;
        }
    }

    private ImportRecord ToRecord(SheetRow row, out bool empty, out bool blank)
    {
        var values = Enumerable.Repeat(ImportValue.Null, _width).ToArray();
        ImportProblem? problem = null;
        empty = true;
        blank = true;

        foreach (var cell in row.Cells)
        {
            var inside = cell.Column >= _firstColumn && cell.Column < _firstColumn + _width;
            if (cell.FormulaWithoutValue)
                FormulasWithoutValue++;

            if (!inside)
            {
                if (IsFilled(cell.Value) || cell.Problem is not null)
                {
                    empty = blank = false;
                    var range = $"{ImportText.ColumnLetters(_firstColumn)} a {ImportText.ColumnLetters(_firstColumn + _width - 1)}";
                    problem ??= new ImportProblem($"A linha {ImportText.Thousands(row.Number)} da planilha tem valor na coluna {ImportText.ColumnLetters(cell.Column)}, fora das colunas {(_header ? "do cabeçalho" : "lidas no começo da planilha")} ({range}).");
                }

                continue;
            }

            var position = cell.Column - _firstColumn;
            values[position] = cell.Value;
            if (cell.Problem is not null)
            {
                empty = blank = false;
                problem ??= new ImportProblem(cell.Problem, position);
                continue;
            }

            if (cell.Value.Text is { Length: > 0 } text)
            {
                empty = false;
                if (!(cell.Value.Source == EImportValueSource.Text && ImportText.TrimEnds(text).Length == 0))
                    blank = false;
            }
        }

        blank &= !empty;

        return new ImportRecord(row.Number, values, problem, false);
    }

    /// <summary>RN-IMPORT-006: a primeira linha da planilha com alguma célula preenchida (a planilha que começa na linha 3 tem o cabeçalho na 3).</summary>
    private SheetRow? FirstFilledRow(CancellationToken cancellationToken)
    {
        while (NextRow() is { } row)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (row.Cells.Any(cell => IsFilled(cell.Value)))
                return row;
        }

        return null;
    }

    /// <summary>RN-IMPORT-006: sem cabeçalho, as colunas vão da primeira à última com valor nas linhas que a leitura da prévia percorre (até 1.000).</summary>
    private (int First, int Last) ScanColumns(SheetRow first, CancellationToken cancellationToken)
    {
        var filled = first.Cells.Where(cell => IsFilled(cell.Value)).Select(cell => cell.Column).ToList();
        var low = filled.Min();
        var high = filled.Max();
        var rows = 1;
        while (rows < ColumnScanRows && NextRow() is { } row)
        {
            cancellationToken.ThrowIfCancellationRequested();
            foreach (var cell in row.Cells.Where(cell => IsFilled(cell.Value)))
            {
                low = Math.Min(low, cell.Column);
                high = Math.Max(high, cell.Column);
            }

            rows++;
        }

        return (low, high);
    }

    private static bool IsFilled(ImportValue value)
        => value.Text is { Length: > 0 };

    private void OpenSheet()
    {
        _sheet?.Dispose();
        _sheetStream = _package.OpenEntry(_sheetPart, SheetLimit);
        _sheet = XmlReader.Create(_sheetStream, Settings);
        _previousRow = 0;
    }

    /// <summary>A linha seguinte de `sheetData`, com as células dela já lidas; nula no fim da planilha.</summary>
    private SheetRow? NextRow()
    {
        var reader = _sheet!;
        while (Next(reader))
        {
            if (reader.NodeType != XmlNodeType.Element || reader.LocalName != "row")
                continue;

            var number = reader.GetAttribute("r") is { } r ? int.TryParse(r, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) ? parsed : -1 : _previousRow + 1;
            if (number is < 1 or > XlsxCells.MaxRow)
                throw OutOfBounds();

            _previousRow = number;
            var cells = new List<SheetCell>();
            if (reader.IsEmptyElement)
                return new SheetRow(number, cells);

            var depth = reader.Depth;
            var previousColumn = -1;
            long rowBytes = 0;
            while (Next(reader) && !(reader.NodeType == XmlNodeType.EndElement && reader.Depth == depth))
            {
                if (reader.NodeType != XmlNodeType.Element || reader.LocalName != "c")
                    continue;

                var cell = ReadCell(reader, number, previousColumn);
                previousColumn = cell.Column;
                rowBytes += cell.Value.Text is null ? 0 : ImportText.Utf8Length(cell.Value.Text);
                if (rowBytes > MaxRowBytes)
                    throw RowTooLarge($"A linha {ImportText.Thousands(number)} da planilha {_sheetName}", feminine: true, number);

                cells.Add(cell);
            }

            return new SheetRow(number, cells);
        }

        return null;
    }

    /// <summary>
    /// RN-IMPORT-006: o valor de uma célula pelo tipo dela no arquivo: o texto (compartilhado, em linha, o resultado de texto de uma fórmula), com o
    /// `_xHHHH_` desfeito; o número, no texto mais curto, ou a data e hora pelo formato; a célula de data; o lógico; o erro do Excel (um problema da
    /// linha); a fórmula sem resultado guardado, vazia.
    /// </summary>
    private SheetCell ReadCell(XmlReader reader, int row, int previousColumn)
    {
        var reference = reader.GetAttribute("r");
        int column;
        if (reference is null)
            column = previousColumn + 1;
        else if (!XlsxCells.TryParseReference(reference, out column, out _))
            throw OutOfBounds();

        if (column >= XlsxCells.MaxColumn)
            throw OutOfBounds();

        var type = reader.GetAttribute("t") ?? "n";
        var style = reader.GetAttribute("s") is { } s && int.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out var index) ? index : 0;
        var name = $"{ImportText.ColumnLetters(column)}{row}";
        string? value = null;
        string? inline = null;
        var formula = false;
        ImportReadException TooLarge() => ValueTooLarge($"da linha {ImportText.Thousands(row)} da planilha {_sheetName}", row, ColumnName(column));

        if (!reader.IsEmptyElement)
        {
            var depth = reader.Depth;
            Next(reader);
            while (!(reader.NodeType == XmlNodeType.EndElement && reader.Depth == depth))
            {
                if (reader.NodeType == XmlNodeType.Element)
                {
                    switch (reader.LocalName)
                    {
                        case "v":
                            var text = new XlsxTextDecoder(MaxValueBytes, decode: type == "str");
                            ReadContent(reader, text, TooLarge);
                            value = text.Finish();
                            continue;
                        case "f":
                            formula = true;
                            Skip(reader);
                            continue;
                        case "is":
                            inline = RichText(reader, MaxValueBytes, TooLarge);
                            continue;
                        default:
                            Skip(reader);
                            continue;
                    }
                }

                Next(reader);
            }
        }

        var cellValue = ImportValue.Null;
        string? problem = null;
        string? errorCode = null;
        switch (type)
        {
            case "inlineStr":
                cellValue = inline is null ? ImportValue.Null : new ImportValue(inline, EImportValueSource.Text);
                break;
            case "s" when value is not null:
                if (int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var shared) && shared < _sharedStrings.Count)
                    cellValue = new ImportValue(_sharedStrings[shared], EImportValueSource.Text);
                else
                    problem = $"A célula {name} aponta para um texto que a planilha não tem.";

                break;
            case "str" when value is not null:
                cellValue = new ImportValue(value, EImportValueSource.Text);
                break;
            case "b" when value is not null:
                if (value is "1" or "0")
                    cellValue = new ImportValue(value == "1" ? "true" : "false", EImportValueSource.Canonical);
                else
                    problem = $"A célula {name} tem um valor lógico que o Prism não lê.";

                break;
            case "e" when value is not null:
                errorCode = XlsxCells.ErrorText(value);
                problem = $"A célula {name} tem o erro {errorCode} do Excel.";
                break;
            case "d" when value is not null:
                if (XlsxCells.IsoDateText(value) is { } iso)
                    cellValue = new ImportValue(iso, EImportValueSource.Canonical);
                else
                    problem = $"A célula {name} tem uma data que o Prism não lê.";

                break;
            case "n" when value is not null:
                (cellValue, problem) = Number(value, style, name);
                break;
            case not ("inlineStr" or "s" or "str" or "b" or "e" or "d" or "n"):
                problem = $"A célula {name} tem um tipo que o Prism não lê.";
                break;
        }

        if (cellValue.Text is { } read && ImportText.Utf8Length(read) > MaxValueBytes)
            throw TooLarge();

        return new SheetCell(column, cellValue, problem, errorCode, formula && value is null && inline is null);
    }

    /// <summary>RN-IMPORT-008: a coluna do arquivo de uma célula, pelo nome (fora das colunas lidas, ou antes de elas existirem, a letra da planilha).</summary>
    private string ColumnName(int column)
        => column >= _firstColumn && column - _firstColumn < Info.Columns.Count ? Info.Columns[column - _firstColumn] : ImportText.ColumnLetters(column);

    /// <summary>RN-IMPORT-006: o número, ou a data e hora quando o formato da célula é de data ou hora.</summary>
    private (ImportValue Value, string? Problem) Number(string value, int style, string name)
    {
        if (!double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) || !double.IsFinite(number))
            return (ImportValue.Null, $"A célula {name} tem um número que o Prism não lê.");

        var kind = style < _styles.Length ? _styles[style] : EXlsxNumberKind.Number;
        if (kind == EXlsxNumberKind.Number)
            return (new ImportValue(XlsxCells.NumberText(value), EImportValueSource.Canonical), null);

        var text = XlsxCells.DateText(number, _date1904, kind, out var refusal);

        return refusal switch
        {
            EXlsxDateRefusal.Leap1900 => (ImportValue.Null, "A data 29/02/1900 do Excel não existe."),
            EXlsxDateRefusal.NotADate => (ImportValue.Null, $"A célula {name} tem um número que não é uma data do Excel."),
            _ => (new ImportValue(text, EImportValueSource.Canonical), null)
        };
    }

    /// <summary>
    /// O texto de um `si` ou de um `is`: as partes do texto formatado juntadas, sem a leitura fonética (`rPh`), com o `_xHHHH_` desfeito. Para ao passar de
    /// `maxChars` caracteres, sem montar o resto (RN-IMPORT-008), com a recusa de quem lê.
    /// </summary>
    private string RichText(XmlReader reader, long maxChars, Func<ImportReadException> tooLarge)
    {
        if (reader.IsEmptyElement)
        {
            Next(reader);

            return string.Empty;
        }

        var text = new XlsxTextDecoder(maxChars, decode: false);
        var depth = reader.Depth;
        Next(reader);
        while (!(reader.NodeType == XmlNodeType.EndElement && reader.Depth == depth))
        {
            if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "t")
            {
                // Cada parte é um texto à parte: o escape não atravessa de uma para a outra.
                var part = new XlsxTextDecoder(maxChars - text.Length);
                ReadContent(reader, part, tooLarge);
                text.Append(part.Finish());
                continue;
            }

            if (reader.NodeType == XmlNodeType.Element && reader.LocalName is "rPh" or "phoneticPr")
            {
                Skip(reader);
                continue;
            }

            Next(reader);
        }

        Next(reader);

        return text.Finish();
    }

    /// <summary>
    /// RN-IMPORT-008: o conteúdo do elemento em que o leitor está (`v` ou `t`), em pedaços (`ReadValueChunk`), sem o texto inteiro passar por um `string`
    /// do XML: o leitor para quando o texto montado passa do teto dele. Termina depois do fim do elemento, como o `ReadElementContentAsString`.
    /// </summary>
    private void ReadContent(XmlReader reader, XlsxTextDecoder text, Func<ImportReadException> tooLarge)
    {
        if (reader.IsEmptyElement)
        {
            Next(reader);

            return;
        }

        var depth = reader.Depth;
        Next(reader);
        while (!(reader.NodeType == XmlNodeType.EndElement && reader.Depth == depth))
        {
            if (reader.NodeType is XmlNodeType.Text or XmlNodeType.CDATA or XmlNodeType.Whitespace or XmlNodeType.SignificantWhitespace)
            {
                if (reader.CanReadValueChunk)
                {
                    int read;
                    while ((read = reader.ReadValueChunk(_chunk, 0, _chunk.Length)) > 0)
                    {
                        if (!text.Append(_chunk.AsSpan(0, read)))
                            throw tooLarge();
                    }
                }
                else if (!text.Append(reader.Value))
                    throw tooLarge();

                Next(reader);
                continue;
            }

            if (reader.NodeType == XmlNodeType.Element)
            {
                Skip(reader);
                continue;
            }

            Next(reader);
        }

        Next(reader);
    }

    /// <summary>A parte da pasta de trabalho, pelo tipo de conteúdo; sem ela no `[Content_Types].xml`, a de sempre.</summary>
    private string WorkbookPart()
    {
        if (!_package.Has(ContentTypesPart))
            throw XlsxPackage.Format("Este arquivo não é um .xlsx que o Prism lê: falta a lista das partes do arquivo ([Content_Types].xml).");

        using var reader = XmlReader.Create(_package.OpenEntry(ContentTypesPart, SmallPartLimit), Settings);
        while (Next(reader))
        {
            if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "Override" && WorkbookContentTypes.Contains(reader.GetAttribute("ContentType")) && reader.GetAttribute("PartName") is { Length: > 1 } part)
                return part.TrimStart('/');
        }

        return DefaultWorkbookPart;
    }

    /// <summary>RN-IMPORT-006: as planilhas, na ordem da pasta de trabalho, o sistema de datas e a recusa do formato Strict.</summary>
    private (List<(string Name, bool Hidden)> Sheets, List<string> Ids) ReadWorkbook(string part)
    {
        var sheets = new List<(string, bool)>();
        var ids = new List<string>();
        using var reader = XmlReader.Create(_package.OpenEntry(part, SmallPartLimit), Settings);
        while (Next(reader))
        {
            if (reader.NodeType != XmlNodeType.Element)
                continue;

            if (reader.Depth == 0 && reader.NamespaceURI == StrictNamespace)
                throw XlsxPackage.Format("A planilha está no formato Strict do Office Open XML, que o Prism não lê. No Excel, salve-a como Pasta de Trabalho do Excel (.xlsx).");

            if (reader.LocalName == "workbookPr")
                _date1904 = reader.GetAttribute("date1904") is "1" or "true";
            else if (reader.LocalName == "sheet" && reader.GetAttribute("name") is { } name)
            {
                sheets.Add((name, reader.GetAttribute("state") is "hidden" or "veryHidden"));
                ids.Add(reader.GetAttribute("id", RelationshipsNamespace) ?? string.Empty);
            }
        }

        return (sheets, ids);
    }

    /// <summary>As relações da pasta de trabalho: a parte de cada planilha, pelo identificador, e as dos estilos e dos textos compartilhados.</summary>
    private Relationships ReadRelationships(string part, string folder)
    {
        var targets = new Dictionary<string, string>(StringComparer.Ordinal);
        string? styles = null;
        string? sharedStrings = null;
        if (!_package.Has(part))
            return new Relationships(targets, $"{folder}styles.xml", $"{folder}sharedStrings.xml");

        using var reader = XmlReader.Create(_package.OpenEntry(part, SmallPartLimit), Settings);
        while (Next(reader))
        {
            if (reader.NodeType != XmlNodeType.Element || reader.LocalName != "Relationship" || reader.GetAttribute("TargetMode") == "External" || reader.GetAttribute("Target") is not { } target)
                continue;

            var path = ResolvePart(folder, target);
            var type = reader.GetAttribute("Type") ?? string.Empty;
            if (type.EndsWith("/styles", StringComparison.Ordinal))
                styles = path;
            else if (type.EndsWith("/sharedStrings", StringComparison.Ordinal))
                sharedStrings = path;
            else if (reader.GetAttribute("Id") is { } id)
                targets[id] = path;
        }

        return new Relationships(targets, styles, sharedStrings);
    }

    /// <summary>O alvo de uma relação, relativo à pasta da pasta de trabalho ou absoluto (`/xl/...`), como o nome da entrada no .zip.</summary>
    private static string ResolvePart(string folder, string target)
    {
        var parts = new List<string>();
        foreach (var segment in (target.StartsWith('/') ? target[1..] : folder + target).Split('/'))
        {
            if (segment == "..")
            {
                if (parts.Count > 0)
                    parts.RemoveAt(parts.Count - 1);
            }
            else if (segment is not ("." or ""))
                parts.Add(segment);
        }

        return string.Join('/', parts);
    }

    /// <summary>RN-IMPORT-006: o que o formato de número de cada estilo de célula (`cellXfs`) diz: número, data, data e hora ou hora.</summary>
    private EXlsxNumberKind[] ReadStyles(string part)
    {
        var codes = new Dictionary<int, string>();
        var styles = new List<EXlsxNumberKind>();
        using var reader = XmlReader.Create(_package.OpenEntry(part, StylesLimit), Settings);
        var inCellFormats = false;
        while (Next(reader))
        {
            if (reader.NodeType == XmlNodeType.EndElement && reader.LocalName == "cellXfs")
                inCellFormats = false;

            if (reader.NodeType != XmlNodeType.Element)
                continue;

            if (reader.LocalName == "numFmt" && int.TryParse(reader.GetAttribute("numFmtId"), NumberStyles.None, CultureInfo.InvariantCulture, out var id))
                codes[id] = reader.GetAttribute("formatCode") ?? string.Empty;
            else if (reader.LocalName == "cellXfs")
                inCellFormats = !reader.IsEmptyElement;
            else if (inCellFormats && reader.LocalName == "xf")
            {
                var format = int.TryParse(reader.GetAttribute("numFmtId"), NumberStyles.None, CultureInfo.InvariantCulture, out var number) ? number : 0;
                styles.Add(XlsxCells.KindOf(format, codes.GetValueOrDefault(format)));
            }
        }

        return [.. styles];
    }

    /// <summary>
    /// RN-IMPORT-006 e 008: os textos compartilhados, na memória, até 256 MiB, contados em UTF-16 e com <see cref="SharedStringOverhead"/> bytes a mais por
    /// texto: o texto que não cabe no que sobra para de ser montado ali, e o texto vazio que não cabe também recusa.
    /// </summary>
    private List<string> ReadSharedStrings(string part, CancellationToken cancellationToken)
    {
        var strings = new List<string>();
        long bytes = 0;
        using var reader = XmlReader.Create(_package.OpenEntry(part, SharedStringsLimit), Settings);
        while (!reader.EOF)
        {
            if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "si")
            {
                if (strings.Count % 4096 == 0)
                    cancellationToken.ThrowIfCancellationRequested();

                var room = MaxSharedStringBytes - bytes - SharedStringOverhead;
                if (room < 0)
                    throw SharedStringsTooLarge();

                var text = RichText(reader, room / 2, SharedStringsTooLarge);
                bytes += SharedStringOverhead + text.Length * 2L;
                if (bytes > MaxSharedStringBytes)
                    throw SharedStringsTooLarge();

                strings.Add(text);
                continue;
            }

            Next(reader);
        }

        return strings;
    }

    /// <summary>
    /// O nó seguinte do XML, como o `Read`, com o teto dos níveis (<see cref="MaxDepth"/>): o elemento que abriria o nível seguinte é recusado com a frase
    /// dele. O `Depth` do elemento de fora é 0.
    /// </summary>
    private static bool Next(XmlReader reader)
    {
        if (!reader.Read())
            return false;

        if (reader.NodeType == XmlNodeType.Element && reader.Depth >= MaxDepth)
            throw TooDeep();

        return true;
    }

    /// <summary>Pula o elemento em que o leitor está, com o que tem dentro, como o `Skip`, mas nó a nó, para o teto dos níveis valer também no que se pula.</summary>
    private static void Skip(XmlReader reader)
    {
        if (reader.NodeType != XmlNodeType.Element || reader.IsEmptyElement)
        {
            Next(reader);

            return;
        }

        var depth = reader.Depth;
        do
        {
            if (!Next(reader))
                return;
        }
        while (!(reader.NodeType == XmlNodeType.EndElement && reader.Depth == depth));

        Next(reader);
    }

    private static ImportReadException TooDeep()
        => new(new ImportReadFailure(EImportReadReason.Limits, TooDeepMessage));

    private static ImportReadException SharedStringsTooLarge()
        => new(new ImportReadFailure(EImportReadReason.Limits, "Os textos da planilha passam de 256 MiB, o que o Prism lê de uma planilha. No Excel, salve a planilha como CSV e importe o CSV."));

    private static ImportReadException SheetRefusal(string message)
        => new(new ImportReadFailure(EImportReadReason.Sheet, message));

    private static ImportReadException OutOfBounds()
        => new(new ImportReadFailure(EImportReadReason.Limits, "A planilha tem uma célula fora dos limites do Excel."));

    private sealed record Relationships(IReadOnlyDictionary<string, string> Targets, string? Styles, string? SharedStrings);

    private sealed record SheetRow(int Number, IReadOnlyList<SheetCell> Cells)
    {
        public override string ToString()
            => nameof(SheetRow);
    }

    /// <param name="ErrorCode">O erro do Excel, como ele o mostra, na célula que tem um.</param>
    /// <param name="FormulaWithoutValue">A fórmula sem resultado guardado (RN-IMPORT-020).</param>
    private sealed record SheetCell(int Column, ImportValue Value, string? Problem, string? ErrorCode, bool FormulaWithoutValue)
    {
        public override string ToString()
            => nameof(SheetCell);
    }
}
