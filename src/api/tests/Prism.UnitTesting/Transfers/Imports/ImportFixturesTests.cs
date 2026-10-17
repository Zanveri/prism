using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Readers;
using Serilog.Core;
using System.Text;
using System.Text.Json;
using System.Xml;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// RN-IMPORT-028: as fixtures de ouro da importação, em `src/test-fixtures/export/` (a pasta da RN-EXPORT-024), escritas à mão e nunca regeradas a partir
/// do código. A da volta da proteção contra fórmula (`import-unguard.json`) é compartilhada com a tela, que confere o `csvFieldOf` dos mesmos casos; a do
/// texto do XLSX da exportação (`xlsx-text.json`, compartilhada) é lida aqui no outro sentido. As outras (`import-csv-field`, `import-xlsx-text`,
/// `import-value-order`, `import-numbers` e `import-dates`) são só da API, prontas para quando a tela as tiver.
/// </summary>
public sealed class ImportFixturesTests
{
    [Trait("ImportText", "Unguard")]
    [Fact(DisplayName = "OK o campo que a proteção escreveu, lido do CSV, volta ao valor sem o apóstrofo (menos o apóstrofo de verdade, marcado)")]
    public void Unguard_ShouldMatchTheFixture()
        => AssertAll("import-unguard.json", test =>
        {
            var read = ReadCsv($"{test.GetProperty("field").GetString()}\r\n", ";", quotes: true);
            var back = ImportText.Unguard(read[0].Values[0].Text!, out _);
            var lossy = test.TryGetProperty("lossy", out var flag) && flag.GetBoolean();
            var value = test.GetProperty("value").GetString();

            // O caso marcado é o único em que a volta não devolve o valor.
            return ($"{back}|{back == value}", $"{test.GetProperty("back").GetString()}|{!lossy}");
        });

    [Trait("CsvImportReader", "ReadNext")]
    [Fact(DisplayName = "OK a leitura do campo do CSV é a da fixture")]
    public void CsvField_ShouldMatchTheFixture()
        => AssertAll("import-csv-field.json", test =>
        {
            var delimiter = test.TryGetProperty("delimiter", out var chosen) ? chosen.GetString()! : ";";
            var quotes = !test.TryGetProperty("quote", out var quote) || quote.GetString() == "double";
            var records = ReadCsv(test.GetProperty("text").GetString()!, delimiter, quotes);
            var actual = string.Join(" / ", records.Select(record => $"{record.Line}: {string.Join(" | ", record.Values.Select(value => $"{Show(value.Text)}{(value.Source == EImportValueSource.Quoted ? "*" : string.Empty)}"))}"));
            var expected = string.Join(" / ", test.GetProperty("records").EnumerateArray().Select(record => $"{record.GetProperty("line").GetInt64()}: {string.Join(" | ", record.GetProperty("values").EnumerateArray().Zip(record.GetProperty("quoted").EnumerateArray()).Select(pair => $"{Show(pair.First.GetString())}{(pair.Second.GetBoolean() ? "*" : string.Empty)}"))}"));

            return (actual, expected);
        });

    [Trait("ImportText", "XlsxText")]
    [Fact(DisplayName = "OK o _xHHHH_ do texto do XLSX é desfeito como na fixture")]
    public void XlsxText_ShouldMatchTheFixture()
        => AssertAll("import-xlsx-text.json", test => (Show(ImportText.XlsxText(test.GetProperty("value").GetString()!)), Show(Text(test.GetProperty("expected")))));

    [Trait("XlsxTextDecoder", "Append")]
    [Fact(DisplayName = "OK o texto da fixture montado em pedaços, cortado em qualquer ponto ou de um caractere por vez, é o mesmo de um pedaço só")]
    public void XlsxTextDecoder_ShouldMatchTheFixtureInAnyChunks()
        => AssertAll("import-xlsx-text.json", test =>
        {
            var value = test.GetProperty("value").GetString()!;
            var failures = new List<string>();
            for (var cut = 0; cut <= value.Length; cut++)
            {
                var decoder = new XlsxTextDecoder(long.MaxValue);
                decoder.Append(value.AsSpan(0, cut));
                decoder.Append(value.AsSpan(cut));
                if (decoder.Finish() is var split && split != ImportText.XlsxText(value))
                    failures.Add($"corte {cut}: {Show(split)}");
            }

            var single = new XlsxTextDecoder(long.MaxValue);
            foreach (var character in value)
                single.Append([character]);

            if (single.Finish() is var one && one != ImportText.XlsxText(value))
                failures.Add($"um por vez: {Show(one)}");

            return (string.Join("; ", failures), string.Empty);
        });

    [Trait("XlsxTextDecoder", "Append")]
    [Fact(DisplayName = "ERRO o texto que passa do teto, contado já desfeito, recusa o pedaço; o que fica nele passa")]
    public void XlsxTextDecoder_AboveTheLimit_ShouldRefuse()
    {
        //Arrange
        var fits = new XlsxTextDecoder(4);
        var above = new XlsxTextDecoder(4);
        var raw = new XlsxTextDecoder(4, decode: false);

        //Act
        var escaped = fits.Append("ab_x000D_c");
        var tooLong = above.Append("abcde");
        var notDecoded = raw.Append("_x000D_");

        //Assert
        Assert.True(escaped);
        Assert.Equal("ab\rc", fits.Finish());
        Assert.False(tooLong);
        Assert.False(notDecoded);
    }

    [Trait("ImportText", "XlsxText")]
    [Fact(DisplayName = "OK o texto que a exportação escreve no XLSX (xlsx-text.json) volta ao valor de ida pela leitura")]
    public void XlsxText_ShouldReadBackTheExportFixture()
        => AssertAll("xlsx-text.json", test =>
        {
            using var reader = XmlReader.Create(new StringReader($"<t>{test.GetProperty("expected").GetString()}</t>"), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit });
            reader.MoveToContent();

            return (Show(ImportText.XlsxText(reader.ReadElementContentAsString())), Show(Text(test.GetProperty("value"))));
        });

    [Trait("ImportValues", "Convert")]
    [Theory(DisplayName = "OK a conversão de cada valor é a da fixture")]
    [InlineData("import-value-order.json")]
    [InlineData("import-numbers.json")]
    [InlineData("import-dates.json")]
    public void Convert_ShouldMatchTheFixture(string file)
        => AssertAll(file, test =>
        {
            var engine = Engine(test.GetProperty("engine").GetString()!);
            var column = ImportColumns.Of(engine, new ColumnInfo(test.GetProperty("column").GetString()!, test.GetProperty("type").GetString()!, true, false, 1, null, null));
            var value = new ImportValue(Text(test.GetProperty("value")), Source(test.GetProperty("source").GetString()!));
            var converted = ImportValues.Convert(engine, column, value, Rules(test), Formats(test));
            var actual = converted.IsSuccess ? $"= {Show(converted.Value.Text)}" : $"! {converted.Error}";
            var expected = test.TryGetProperty("refusal", out var refusal) ? $"! {refusal.GetString()}" : $"= {Show(Text(test.GetProperty("expected")))}";

            return (actual, expected);
        });

    private static List<ImportRecord> ReadCsv(string text, string delimiter, bool quotes)
    {
        var options = new CsvImportOptions(ImportEncodings.Utf8, delimiter, Header: false, quotes, string.Empty, EmptyAsNull: false, Trim: false, SkipEmptyLines: false, UnguardFormulas: false);
        var opened = ImportReader.Open(delimiter == "\t" ? ImportFormats.Tsv : ImportFormats.Csv, options, new MemoryStream(Encoding.UTF8.GetBytes(text)), Logger.None, CancellationToken.None);
        Assert.True(opened.IsSuccess, opened.IsFailure ? opened.Error.Message : null);
        using var reader = opened.Value;
        var records = new List<ImportRecord>();
        while (reader.Next(CancellationToken.None) is { IsSuccess: true, Value: { } record })
            records.Add(record);

        return records;
    }

    private static ImportValueRules Rules(JsonElement test)
    {
        if (!test.TryGetProperty("rules", out var rules))
            return ImportValueRules.None;

        string Get(string name) => rules.TryGetProperty(name, out var value) ? value.GetString()! : string.Empty;
        bool Flag(string name) => rules.TryGetProperty(name, out var value) && value.GetBoolean();

        return ImportValueRules.Of(new CsvImportOptions(ImportEncodings.Utf8, ";", true, true, Get("nullText"), Flag("emptyAsNull"), Flag("trim"), true, Flag("unguard")), ";");
    }

    private static ImportValueFormats Formats(JsonElement test)
    {
        if (!test.TryGetProperty("formats", out var formats))
            return ImportValueFormats.Default;

        return new ImportValueFormats(formats.GetProperty("decimal").GetString() == "comma" ? EImportDecimal.Comma : EImportDecimal.Point, formats.GetProperty("thousandsDot").GetBoolean(), formats.GetProperty("dates").GetString() == "dayMonthYear" ? EImportDates.DayMonthYear : EImportDates.Iso);
    }

    private static EImportValueSource Source(string source)
        => source switch
        {
            "plain" => EImportValueSource.Plain,
            "quoted" => EImportValueSource.Quoted,
            "text" => EImportValueSource.Text,
            "canonical" => EImportValueSource.Canonical,
            "json" => EImportValueSource.Json,
            "null" => EImportValueSource.Null,
            _ => throw new InvalidOperationException($"A origem {source} não existe.")
        };

    private static EDatabaseEngine Engine(string name)
        => name switch
        {
            "postgresql" => EDatabaseEngine.PostgreSql,
            "db2" => EDatabaseEngine.Db2,
            "informix" => EDatabaseEngine.Informix,
            _ => throw new InvalidOperationException($"O banco {name} não existe.")
        };

    private static void AssertAll(string file, Func<JsonElement, (string? Actual, string? Expected)> check)
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "test-fixtures", "export", file)));
        var cases = fixture.RootElement.GetProperty("cases").EnumerateArray().ToList();
        var failures = new List<string>();

        foreach (var test in cases)
        {
            var (actual, expected) = check(test);
            if (actual != expected)
                failures.Add($"{test.GetProperty("name").GetString()}: esperado {expected}, veio {actual}");
        }

        Assert.True(cases.Count > 0, $"A fixture {file} não tem casos.");
        Assert.True(failures.Count == 0, string.Join(Environment.NewLine, failures));
    }

    /// <summary>O texto da fixture: texto, nulo ou `{ codePoints: [...] }`, montado ponto de código por ponto de código (o par substituto solto também).</summary>
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

    /// <summary>Os pontos de código fora do ASCII visível, para a diferença de um caractere invisível aparecer na falha.</summary>
    private static string Show(string? text)
        => text is null ? "null" : string.Concat(text.Select(character => character is >= ' ' and <= '~' ? character.ToString() : $"\\u{(int)character:X4}"));
}
