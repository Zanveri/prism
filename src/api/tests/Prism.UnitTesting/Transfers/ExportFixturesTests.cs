using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Writers;
using System.Text;
using System.Text.Json;
using System.Xml;

namespace Prism.UnitTesting.Transfers;

/// <summary>
/// RN-EXPORT-024: as fixtures de ouro de `src/test-fixtures/export/`, escritas à mão, com as entradas e a saída esperada de cada caso, lidas também pelo
/// teste da tela (`export-fixtures.test.ts`): os dois lados escrevem o mesmo texto. Desde a seção 37 a tela escreve os nove formatos de texto (o "Copiar
/// como", RN-GRADE-016), e as que eram só da API (TXT, PHP, data em ISO 8601, "Em todos os textos" do CSV, o literal do binário, o `INSERT` de várias
/// linhas, o nome do XML e o DbUnit) passaram a ser dos dois lados, com a do documento inteiro de cada formato (`document.json`). Cada arquivo é
/// conferido por inteiro: mudar uma regra é mudar a fixture, e nunca regerá-la a partir do código.
/// </summary>
public sealed class ExportFixturesTests
{
    [Trait("ExportText", "CsvField")]
    [Theory(DisplayName = "OK o campo do CSV é o da fixture")]
    [InlineData("csv-field.json")]
    [InlineData("csv-field-text.json")]
    public void CsvField_ShouldMatchTheFixture(string file)
        => AssertAll(file, test =>
        {
            var options = test.GetProperty("options");
            var field = new CsvFieldOptions(options.GetProperty("delimiter").GetString()!, Quoting(options.GetProperty("quoting").GetString()!), options.GetProperty("formulaGuard").GetBoolean(), options.GetProperty("nullText").GetString()!);

            return (ExportText.CsvField(Text(test.GetProperty("value")), test.GetProperty("kind").GetString()!, field), Text(test.GetProperty("expected")));
        });

    [Trait("ExportText", "HtmlText")]
    [Fact(DisplayName = "OK o texto do HTML e os caracteres tirados são os da fixture")]
    public void HtmlText_ShouldMatchTheFixture()
        => AssertAll("html-text.json", test =>
        {
            var escaped = ExportText.HtmlText(Text(test.GetProperty("value"))!, out var removed);

            return ($"{escaped}|{removed}", $"{Text(test.GetProperty("expected"))}|{test.GetProperty("removed").GetInt32()}");
        });

    [Trait("ExportText", "MarkdownCell")]
    [Fact(DisplayName = "OK a célula do Markdown é a da fixture")]
    public void MarkdownCell_ShouldMatchTheFixture()
        => AssertAll("markdown-cell.json", test => (ExportText.MarkdownCell(Text(test.GetProperty("value"))!), Text(test.GetProperty("expected"))));

    [Trait("ExportText", "JsonValue")]
    [Fact(DisplayName = "OK o valor do JSON é o da fixture")]
    public void JsonValue_ShouldMatchTheFixture()
        => AssertAll("json-value.json", test => (ExportText.JsonValue(test.GetProperty("kind").GetString()!, Text(test.GetProperty("value"))), Text(test.GetProperty("expected"))));

    [Trait("ExportText", "UniqueKeys")]
    [Fact(DisplayName = "OK as chaves do JSON são as da fixture")]
    public void UniqueKeys_ShouldMatchTheFixture()
        => AssertAll("json-keys.json", test => (string.Join('|', ExportText.UniqueKeys(Strings(test.GetProperty("names")))), string.Join('|', Strings(test.GetProperty("expected")))));

    [Trait("ExportText", "IsoDateTime")]
    [Fact(DisplayName = "OK a data em ISO 8601 é a da fixture")]
    public void IsoDateTime_ShouldMatchTheFixture()
        => AssertAll("iso-datetime.json", test => (ExportText.IsoDateTime(test.GetProperty("value").GetString()!), test.GetProperty("expected").GetString()));

    [Trait("ExportText", "PhpString")]
    [Fact(DisplayName = "OK o literal do PHP e os caracteres tirados são os da fixture")]
    public void PhpString_ShouldMatchTheFixture()
        => AssertAll("php-string.json", test =>
        {
            var literal = ExportText.PhpString(Text(test.GetProperty("value"))!, test.GetProperty("quote").GetString() == "single", out var removed);

            return ($"{literal}|{removed}", $"{Text(test.GetProperty("expected"))}|{test.GetProperty("removed").GetInt32()}");
        });

    [Trait("ExportText", "PhpVariable")]
    [Fact(DisplayName = "OK o nome da variável do PHP é o da fixture")]
    public void PhpVariable_ShouldMatchTheFixture()
        => AssertAll("php-variable.json", test =>
        {
            var variable = ExportText.PhpVariable(test.GetProperty("value").GetString()!, out var removed);

            return ($"{variable}|{removed}", $"{test.GetProperty("expected").GetString()}|{test.GetProperty("removed").GetInt32()}");
        });

    [Trait("TxtExportWriter", "Write")]
    [Fact(DisplayName = "OK a tabela de texto de um lote é a da fixture")]
    public void TxtTable_ShouldMatchTheFixture()
        => AssertAll("txt-table.json", test =>
        {
            var options = test.GetProperty("options");
            var txt = new TxtExportOptions(options.GetProperty("header").GetBoolean(), options.GetProperty("headerLine").GetBoolean(), options.GetProperty("edgeDelimiters").GetBoolean(), options.GetProperty("minWidth").GetInt32(), options.GetProperty("maxWidth").GetInt32(), options.GetProperty("showNull").GetBoolean(), options.GetProperty("lineBreak").GetString() == "lf" ? "\n" : "\r\n", EExportBinary.Hex);
            var columns = Strings(test.GetProperty("columns")).Select(name => new ExportColumn(name, "text", "text")).ToList();
            var rows = test.GetProperty("rows").EnumerateArray().Select(row => row.EnumerateArray().Select(value => value.ValueKind == JsonValueKind.Null ? ExportCell.Null : ExportCell.FromText(value.GetString()!)).ToList()).ToList();
            var (text, counts) = ExportWriting.Write(ExportFormats.Txt, columns, rows, txt);

            return ($"{text}|{counts.CutValues}", $"{test.GetProperty("expected").GetString()}|{test.GetProperty("cutValues").GetInt64()}");
        });

    [Trait("ExportText", "SqlLiteral")]
    [Fact(DisplayName = "OK o literal do SQL, de uma linha e de script, é o da fixture")]
    public void SqlLiteral_ShouldMatchTheFixture()
        => AssertAll("sql-literal.json", test =>
        {
            var engine = Engine(test.GetProperty("engine").GetString()!);
            var value = Text(test.GetProperty("value"))!;
            var kind = test.GetProperty("kind").GetString()!;
            var literal = test.GetProperty("function").GetString() switch
            {
                "sqlLiteral" => ExportText.SqlLiteral(engine, value, kind),
                "scriptLiteral" => ExportText.ScriptLiteral(engine, value, kind),
                var other => throw new InvalidOperationException($"A função {other} não existe.")
            };

            return (literal, Text(test.GetProperty("expected")));
        });

    [Trait("ExportText", "BinaryLiteral")]
    [Fact(DisplayName = "OK o literal do binário é o da fixture")]
    public void BinaryLiteral_ShouldMatchTheFixture()
        => AssertAll("sql-binary.json", test => (ExportText.BinaryLiteral(Engine(test.GetProperty("engine").GetString()!), Convert.FromHexString(test.GetProperty("bytes").GetString()!), test.GetProperty("type").GetString()!), Text(test.GetProperty("expected"))));

    [Trait("SqlExportWriter", "Write")]
    [Fact(DisplayName = "OK o arquivo SQL e as linhas puladas são os da fixture")]
    public void SqlInsert_ShouldMatchTheFixture()
        => AssertAll("sql-insert.json", test =>
        {
            var options = test.GetProperty("options");
            var sql = new SqlExportOptions(options.GetProperty("schema").GetString(), options.GetProperty("table").GetString()!, options.GetProperty("omitSchema").GetBoolean(), options.GetProperty("rowsPerStatement").GetInt32(), EExportBinary.Literal);
            var columns = test.GetProperty("columns").EnumerateArray().Select(column => new ExportColumn(column.GetProperty("name").GetString()!, column.GetProperty("type").GetString()!, column.GetProperty("kind").GetString()!)).ToList();
            var (text, counts) = ExportWriting.Write(ExportFormats.Sql, columns, Rows(test.GetProperty("rows")), sql, engine: Engine(test.GetProperty("engine").GetString()!));

            return ($"{text}|{counts.SkippedRows}", $"{test.GetProperty("expected").GetString()}|{test.GetProperty("skippedRows").GetInt64()}");
        });

    [Trait("ExportText", "XmlText")]
    [Fact(DisplayName = "OK o texto e o atributo do XML e os caracteres tirados são os da fixture")]
    public void XmlText_ShouldMatchTheFixture()
        => AssertAll("xml-text.json", test =>
        {
            var value = Text(test.GetProperty("value"))!;
            int removed;
            var escaped = test.GetProperty("kind").GetString() == "attribute" ? ExportText.XmlAttribute(value, out removed) : ExportText.XmlText(value, out removed);

            return ($"{escaped}|{removed}", $"{Text(test.GetProperty("expected"))}|{test.GetProperty("removed").GetInt32()}");
        });

    [Trait("ExportText", "XmlName")]
    [Fact(DisplayName = "OK o nome do XML é o da fixture, e a volta é exata")]
    public void XmlName_ShouldMatchTheFixture()
        => AssertAll("xml-name.json", test =>
        {
            var value = Text(test.GetProperty("value"))!;
            var cased = test.GetProperty("upperCase").GetBoolean() ? value.ToUpperInvariant() : value;
            var name = ExportText.XmlName(cased);

            return ($"{name}|{XmlConvert.DecodeName(name) == cased}", $"{test.GetProperty("expected").GetString()}|True");
        });

    [Trait("DbUnitExportWriter", "Write")]
    [Fact(DisplayName = "OK o DbUnit e os caracteres tirados são os da fixture")]
    public void DbUnit_ShouldMatchTheFixture()
        => AssertAll("dbunit-dataset.json", test =>
        {
            var options = new DbUnitExportOptions(test.GetProperty("table").GetString()!, test.GetProperty("upperCase").GetBoolean(), test.GetProperty("nulls").GetString() == "mark", EExportBinary.Hex);
            var columns = Strings(test.GetProperty("columns")).Select(name => new ExportColumn(name, "text", "text")).ToList();
            var (text, counts) = ExportWriting.Write(ExportFormats.DbUnit, columns, Rows(test.GetProperty("rows")), options);

            return ($"{text}|{counts.RemovedCharacters}", $"{test.GetProperty("expected").GetString()}|{test.GetProperty("removed").GetInt64()}");
        });

    [Trait("ExportWriter", "Write")]
    [Fact(DisplayName = "OK o documento inteiro de cada formato de texto e o resumo são os da fixture")]
    public void Document_ShouldMatchTheFixture()
        => AssertAll("document.json", test =>
        {
            var format = test.GetProperty("format").GetString()!;
            var (options, errors) = ExportOptionsReader.Read(format, test.GetProperty("options"), defaultTable: null);
            if (options is null)
                return (string.Join('|', errors.Select(error => $"{error.Field}: {error.Message}")), "as opções da fixture valem");

            var columns = test.GetProperty("columns").EnumerateArray().Select(column => new ExportColumn(column.GetProperty("name").GetString()!, column.GetProperty("type").GetString()!, column.GetProperty("kind").GetString()!)).ToList();
            var rows = Rows(test.GetProperty("rows"));

            // RN-EXPORT-006 e 011: com o binário deixado vazio (ou NULL, no SQL), a API nem pede o valor binário ao leitor, e ele chega nulo ao escritor.
            if (options.Binary == EExportBinary.Null)
                rows = [.. rows.Select(row => (IReadOnlyList<ExportCell>)[.. row.Select((cell, index) => columns[index].Kind == "binary" ? ExportCell.Null : cell)])];

            var (text, counts) = ExportWriting.Write(format, columns, rows, options, Text(test.GetProperty("sourceName"))!, Engine(test.GetProperty("engine").GetString()!));
            var summary = test.GetProperty("summary");

            return ($"{text}|{counts.CutValues}|{counts.RemovedCharacters}|{counts.SkippedRows}", $"{Text(test.GetProperty("expected"))}|{summary.GetProperty("cutValues").GetInt64()}|{summary.GetProperty("removedCharacters").GetInt64()}|{summary.GetProperty("skippedRows").GetInt64()}");
        });

    [Trait("ExportText", "XlsxText")]
    [Fact(DisplayName = "OK o texto da planilha é o da fixture")]
    public void XlsxText_ShouldMatchTheFixture()
        => AssertAll("xlsx-text.json", test => (ExportText.XlsxText(Text(test.GetProperty("value"))!), Text(test.GetProperty("expected"))));

    [Trait("ExportText", "SpreadsheetNumber")]
    [Fact(DisplayName = "OK o número da planilha é o da fixture")]
    public void SpreadsheetNumber_ShouldMatchTheFixture()
        => AssertAll("xlsx-number.json", test => (ExportText.SpreadsheetNumber(test.GetProperty("value").GetString()!), Text(test.GetProperty("expected"))));

    [Trait("ExportText", "SheetNameOf")]
    [Fact(DisplayName = "OK o nome da planilha é o da fixture")]
    public void SheetNameOf_ShouldMatchTheFixture()
        => AssertAll("xlsx-sheet-name.json", test => (ExportText.SheetNameOf(Text(test.GetProperty("value"))!), Text(test.GetProperty("expected"))));

    [Trait("ExportText", "WithinCell")]
    [Fact(DisplayName = "OK o corte no limite da célula é o da fixture")]
    public void WithinCell_ShouldMatchTheFixture()
        => AssertAll("xlsx-cell.json", test =>
        {
            var fill = new string('a', test.GetProperty("fill").GetInt32());
            var value = fill + Text(test.GetProperty("tail"));
            var kept = ExportText.WithinCell(value);

            // Os 32 mil "a" iguais não dizem nada na falha: ela mostra só o que vem depois deles.
            return ($"{(kept.StartsWith(fill, StringComparison.Ordinal) ? kept[fill.Length..] : kept)}|{kept.Length < value.Length}", $"{Text(test.GetProperty("expectedTail"))}|{test.GetProperty("cut").GetBoolean()}");
        });

    /// <summary>Confere cada caso e junta as diferenças numa falha só, com o nome de cada caso: a fixture inteira é a regra.</summary>
    private static void AssertAll(string file, Func<JsonElement, (string? Actual, string? Expected)> check)
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "test-fixtures", "export", file)));
        var cases = fixture.RootElement.GetProperty("cases").EnumerateArray().ToList();
        var failures = new List<string>();

        foreach (var test in cases)
        {
            var (actual, expected) = check(test);
            if (actual != expected)
                failures.Add($"{test.GetProperty("name").GetString()}: esperado {Show(expected)}, veio {Show(actual)}");
        }

        Assert.NotEmpty(cases);
        Assert.True(failures.Count == 0, string.Join('\n', failures));
    }

    /// <summary>Texto, nulo ou `{ codePoints: [...] }`, montado ponto de código por ponto de código (o par substituto solto também).</summary>
    private static string? Text(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Null)
            return null;

        if (value.ValueKind == JsonValueKind.String)
            return value.GetString();

        var text = new StringBuilder();
        foreach (var codePoint in value.GetProperty("codePoints").EnumerateArray().Select(point => point.GetInt32()))
        {
            if (codePoint is >= 0xD800 and <= 0xDFFF)
                text.Append((char)codePoint);
            else
                text.Append(char.ConvertFromUtf32(codePoint));
        }

        return text.ToString();
    }

    /// <summary>As linhas de um documento: cada valor é texto, nulo, `{ codePoints: [...] }` ou `{ bytes: "HEX" }`, o binário.</summary>
    private static List<IReadOnlyList<ExportCell>> Rows(JsonElement rows)
        => [.. rows.EnumerateArray().Select(row => (IReadOnlyList<ExportCell>)[.. row.EnumerateArray().Select(Cell)])];

    private static ExportCell Cell(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object && value.TryGetProperty("bytes", out var bytes))
            return ExportCell.FromBytes(Convert.FromHexString(bytes.GetString()!));

        return Text(value) is { } text ? ExportCell.FromText(text) : ExportCell.Null;
    }

    private static EDatabaseEngine Engine(string name)
        => name switch
        {
            "postgresql" => EDatabaseEngine.PostgreSql,
            "db2" => EDatabaseEngine.Db2,
            "informix" => EDatabaseEngine.Informix,
            _ => throw new InvalidOperationException($"O banco {name} não existe.")
        };

    private static List<string> Strings(JsonElement array)
        => [.. array.EnumerateArray().Select(item => item.GetString()!)];

    private static ECsvQuoting Quoting(string quoting)
        => quoting switch
        {
            "text" => ECsvQuoting.Text,
            "all" => ECsvQuoting.All,
            _ => ECsvQuoting.Auto
        };

    /// <summary>Os pontos de código, para a diferença de um caractere invisível aparecer na falha.</summary>
    private static string Show(string? text)
        => text is null ? "null" : $"\"{text}\" [{string.Join(' ', ExportText.CodePoints(text).Select(point => point.CodePoint.ToString("X4")))}]";
}

/// <summary>Escreve um arquivo inteiro de um formato num fluxo da memória, como o client do arquivo temporário escreve, e devolve o texto e as contagens.</summary>
internal static class ExportWriting
{
    public static (string Text, ExportCounts Counts) Write(string format, IReadOnlyList<ExportColumn> columns, IEnumerable<IReadOnlyList<ExportCell>> rows, ExportFormatOptions options, string sourceName = "pedido", EDatabaseEngine engine = EDatabaseEngine.PostgreSql)
    {
        var (bytes, counts) = WriteBytes(format, columns, rows, options, sourceName, engine);

        return (Encoding.UTF8.GetString(bytes), counts);
    }

    public static (byte[] Bytes, ExportCounts Counts) WriteBytes(string format, IReadOnlyList<ExportColumn> columns, IEnumerable<IReadOnlyList<ExportCell>> rows, ExportFormatOptions options, string sourceName = "pedido", EDatabaseEngine engine = EDatabaseEngine.PostgreSql)
    {
        using var stream = new MemoryStream();
        var writer = ExportFormats.Create(format, new ExportWriterContext(columns, sourceName, engine, options), stream);
        writer.Begin();
        foreach (var row in rows)
            writer.Write(row);

        writer.End();

        return (stream.ToArray(), writer.Counts);
    }
}
