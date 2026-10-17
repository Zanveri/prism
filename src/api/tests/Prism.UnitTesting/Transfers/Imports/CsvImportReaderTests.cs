using CSharpFunctionalExtensions;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Readers;
using Serilog.Core;
using System.Text;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// RN-IMPORT-004 e 008: o leitor do CSV e do TSV, sobre o arquivo em bytes: a codificação (a automática pelo arquivo inteiro e a escolhida, com a linha da
/// sequência inválida), o separador automático, o cabeçalho, as aspas, as linhas vazias, a linha com menos e com mais valores e os limites.
/// </summary>
public sealed class CsvImportReaderTests
{
    private static CsvImportOptions Options(string encoding = ImportEncodings.Auto, string? delimiter = null, bool header = true, bool quotes = true, bool skipEmptyLines = true, bool unguard = true)
        => new(encoding, delimiter, header, quotes, string.Empty, false, false, skipEmptyLines, unguard);

    private static Result<ImportReader, ImportReadFailure> Open(byte[] bytes, CsvImportOptions options, bool tsv = false)
        => ImportReader.Open(tsv ? ImportFormats.Tsv : ImportFormats.Csv, options, new MemoryStream(bytes), Logger.None, CancellationToken.None);

    private static (ImportReader Reader, List<ImportRecord> Records) ReadAll(byte[] bytes, CsvImportOptions options, bool tsv = false)
    {
        var opened = Open(bytes, options, tsv);
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

    private static ImportReadFailure FirstFailure(byte[] bytes, CsvImportOptions options)
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

    /// <summary>O texto de cada valor, com o nulo escrito como `null`.</summary>
    private static string[] Texts(ImportRecord record)
        => [.. record.Values.Select(value => value.Text ?? "null")];

    [Trait("CsvImportReader", "Encoding")]
    [Fact(DisplayName = "OK a codificação automática: o BOM, o UTF-8 do arquivo inteiro e o Windows-1252 do Excel em português")]
    public void Begin_AutomaticEncoding_ShouldFollowTheBomAndTheWholeFile()
    {
        //Arrange
        byte[] utf8Bom = [0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes("nome\nSão Paulo\n")];
        var utf8 = Encoding.UTF8.GetBytes("nome\nSão Paulo\n");
        byte[] windows1252 = [.. Encoding.ASCII.GetBytes("nome\nS"), 0xE3, .. Encoding.ASCII.GetBytes("o Paulo "), 0x80, (byte)'\n'];
        byte[] utf16 = [0xFF, 0xFE, .. Encoding.Unicode.GetBytes("nome\nSão\n")];

        // O UTF-8 inválido só no fim do arquivo também decide: a conferência é do arquivo inteiro.
        byte[] lateInvalid = [.. Encoding.UTF8.GetBytes($"nome\n{new string('a', 200_000)}\n"), 0xC3, (byte)'\n'];

        //Act
        var (bom, bomRows) = ReadAll(utf8Bom, Options());
        var (plain, plainRows) = ReadAll(utf8, Options());
        var (excel, excelRows) = ReadAll(windows1252, Options());
        var (wide, wideRows) = ReadAll(utf16, Options());
        var (late, _) = ReadAll(lateInvalid, Options());

        //Assert
        Assert.Equal(new ImportEncodingInfo(ImportEncodings.Utf8, true), bom.Info.Encoding);
        Assert.Equal("São Paulo", bomRows[0].Values[0].Text);
        Assert.Equal(new ImportEncodingInfo(ImportEncodings.Utf8, false), plain.Info.Encoding);
        Assert.Equal("São Paulo", plainRows[0].Values[0].Text);
        Assert.Equal(new ImportEncodingInfo(ImportEncodings.Windows1252, false), excel.Info.Encoding);
        Assert.Equal("São Paulo €", excelRows[0].Values[0].Text);
        Assert.Equal(new ImportEncodingInfo(ImportEncodings.Utf16Le, true), wide.Info.Encoding);
        Assert.Equal("São", wideRows[0].Values[0].Text);
        Assert.Equal(ImportEncodings.Windows1252, late.Info.Encoding!.Name);
    }

    [Trait("CsvImportReader", "Encoding")]
    [Fact(DisplayName = "OK o byte zero não é UTF-8 para a automática, e o ISO-8859-1 lê qualquer byte")]
    public void Begin_ZeroByteAndLatin1_ShouldBeRead()
    {
        //Arrange
        byte[] zero = [.. Encoding.ASCII.GetBytes("a\n"), 0x00, (byte)'b', (byte)'\n'];
        byte[] latin = [.. Encoding.ASCII.GetBytes("a\n"), 0x80, 0xE9, (byte)'\n'];

        //Act
        var (automatic, _) = ReadAll(zero, Options());
        var (_, latinRows) = ReadAll(latin, Options(ImportEncodings.Latin1));

        //Assert
        Assert.Equal(ImportEncodings.Windows1252, automatic.Info.Encoding!.Name);
        Assert.Equal("\u0080é", latinRows[0].Values[0].Text);
    }

    [Trait("CsvImportReader", "Encoding")]
    [Fact(DisplayName = "ERRO a sequência inválida na codificação escolhida é recusada na linha em que aparece")]
    public void Next_InvalidSequence_ShouldBeRefusedWithTheLine()
    {
        //Arrange
        byte[] utf8 = [.. Encoding.UTF8.GetBytes("a\nb\n\"c\nd"), 0xFF, (byte)'"', (byte)'\n'];
        byte[] utf16 = [.. Encoding.Unicode.GetBytes("a\nb\n"), 0x3D, 0xD8, (byte)'x', 0x00];

        //Act
        var refusal = FirstFailure(utf8, Options(ImportEncodings.Utf8));
        var wide = FirstFailure(utf16, Options(ImportEncodings.Utf16Le));

        //Assert
        Assert.Equal(EImportReadReason.Encoding, refusal.Reason);
        Assert.Equal("O arquivo não é UTF-8 válido na linha 4. Escolha a codificação dele.", refusal.Message);
        Assert.Equal(4, refusal.Line);
        Assert.Equal("O arquivo não é UTF-16 válido na linha 3. Escolha a codificação dele.", wide.Message);
    }

    [Trait("CsvImportReader", "Delimiter")]
    [Theory(DisplayName = "OK o separador automático conta os quatro fora das aspas e escolhe o mais constante")]
    [InlineData("a;b;c\n1;2;3\n4;5;6\n", ";")]
    [InlineData("a,b,c\n\"1;2\",2,3\n4,5,6\n", ",")]
    [InlineData("a\tb\n1\t2\n", "\t")]
    [InlineData("a|b\n1|2\n", "|")]
    [InlineData("a;b,c\n1;2,3\n", ";")]
    [InlineData("a,b,c;d\n1,2,3;4\n5,6;7\n", ";")]
    public void Begin_AutomaticDelimiter_ShouldPickTheSteadiestOne(string text, string expected)
    {
        //Act
        var (reader, _) = ReadAll(Encoding.UTF8.GetBytes(text), Options());

        //Assert
        Assert.Equal(expected, reader.Info.Delimiter);
    }

    [Trait("CsvImportReader", "Delimiter")]
    [Fact(DisplayName = "OK sem nenhum dos quatro, o arquivo tem uma coluna só")]
    public void Begin_NoDelimiter_ShouldHaveOneColumn()
    {
        //Act
        var (reader, records) = ReadAll(Encoding.UTF8.GetBytes("nome\nAna Lima\nBia\n"), Options());

        //Assert
        Assert.Null(reader.Info.Delimiter);
        Assert.Equal(["nome"], reader.Columns);
        Assert.Equal(["Ana Lima", "Bia"], records.Select(record => record.Values[0].Text!));
    }

    [Trait("CsvImportReader", "Header")]
    [Fact(DisplayName = "OK o cabeçalho: sem as pontas, o vazio vira Coluna N, o repetido ganha (2), e a proteção sai do nome")]
    public void Begin_Header_ShouldNameTheColumns()
    {
        //Act
        var (reader, _) = ReadAll(Encoding.UTF8.GetBytes(" id ;;id;'=total;id (2)\n1;2;3;4;5\n"), Options(delimiter: ";"));

        //Assert
        Assert.Equal(["id", "Coluna 2", "id (2)", "=total", "id (2) (2)"], reader.Columns);
    }

    [Trait("CsvImportReader", "Header")]
    [Fact(DisplayName = "OK sem cabeçalho, as colunas se chamam Coluna 1, Coluna 2…, e a primeira linha é dado")]
    public void Begin_WithoutHeader_ShouldReadTheFirstLineAsData()
    {
        //Act
        var (reader, records) = ReadAll(Encoding.UTF8.GetBytes("\n1;2\n3;4\n"), Options(delimiter: ";", header: false));

        //Assert
        Assert.Equal(["Coluna 1", "Coluna 2"], reader.Columns);
        Assert.Equal([2L, 3L], records.Select(record => record.Line));
        Assert.Equal(["1", "2"], Texts(records[0]));
    }

    [Trait("CsvImportReader", "ReadNext")]
    [Fact(DisplayName = "OK a linha com menos valores é completada com nulo e marcada; a com mais só passa com os que sobram vazios")]
    public void Next_ShortAndLongLines_ShouldBePaddedOrMarked()
    {
        //Act
        var (_, records) = ReadAll(Encoding.UTF8.GetBytes("a;b;c\n1;2\n1;2;3;;\n1;2;3;4\n"), Options(delimiter: ";"));

        //Assert
        Assert.True(records[0].Short);
        Assert.Equal(EImportValueSource.Null, records[0].Values[2].Source);
        Assert.False(records[1].Short);
        Assert.Null(records[1].Problem);
        Assert.Equal(["1", "2", "3"], Texts(records[1]));
        Assert.Equal("A linha 4 tem 4 valores, e o cabeçalho tem 3.", records[2].Problem!.Message);
    }

    [Trait("CsvImportReader", "ReadNext")]
    [Fact(DisplayName = "OK Pular linhas vazias pula a sem caractere e a só de separadores, e conta")]
    public void Next_SkipEmptyLines_ShouldSkipAndCount()
    {
        //Act
        var (reader, records) = ReadAll(Encoding.UTF8.GetBytes("a;b\n1;2\n\n ; \t\n3;4\n"), Options(delimiter: ";"));

        //Assert
        Assert.Equal([2L, 5L], records.Select(record => record.Line));
        Assert.Equal(2, reader.SkippedLines);
    }

    [Trait("CsvImportReader", "ReadNext")]
    [Fact(DisplayName = "OK sem Pular linhas vazias: a sem caractere é pulada com mais de uma coluna e é um campo vazio com uma só")]
    public void Next_WithoutSkipEmptyLines_ShouldFollowTheColumnCount()
    {
        //Act
        var (twoReader, two) = ReadAll(Encoding.UTF8.GetBytes("a;b\n1;2\n\n;\n"), Options(delimiter: ";", skipEmptyLines: false));
        var (_, one) = ReadAll(Encoding.UTF8.GetBytes("nome\nAna\n\nBia\n"), Options(skipEmptyLines: false));

        //Assert
        Assert.Equal([2L, 4L], two.Select(record => record.Line));
        Assert.Equal(["", ""], Texts(two[1]));
        Assert.Equal(1, twoReader.SkippedLines);
        Assert.Equal(["Ana", "", "Bia"], one.Select(record => record.Values[0].Text!));
    }

    [Trait("CsvImportReader", "ReadNext")]
    [Fact(DisplayName = "ERRO a aspa que abre e não fecha até o fim do arquivo, com a linha dela")]
    public void Next_UnclosedQuote_ShouldBeRefused()
    {
        //Act
        var refusal = FirstFailure(Encoding.UTF8.GetBytes("a;b\n1;2\n3;\"aberta\n4;5\n"), Options(delimiter: ";"));

        //Assert
        Assert.Equal(EImportReadReason.Format, refusal.Reason);
        Assert.Equal("A aspa aberta na linha 3 não fecha até o fim do arquivo.", refusal.Message);
        Assert.Equal(3, refusal.Line);
    }

    [Trait("CsvImportReader", "Tsv")]
    [Fact(DisplayName = "OK o TSV é o CSV com a tabulação")]
    public void Begin_Tsv_ShouldUseTheTab()
    {
        //Act
        var (reader, records) = ReadAll(Encoding.UTF8.GetBytes("a\tb;c\n1\t2;3\n"), Options(), tsv: true);

        //Assert
        Assert.Equal("\t", reader.Info.Delimiter);
        Assert.Equal(["a", "b;c"], reader.Columns);
        Assert.Equal(["1", "2;3"], Texts(records[0]));
    }

    [Trait("CsvImportReader", "Limits")]
    [Fact(DisplayName = "ERRO mais de 16.384 colunas e o nome de coluna acima de 256 caracteres")]
    public void Begin_Limits_ShouldBeRefused()
    {
        //Arrange
        var wide = Encoding.UTF8.GetBytes(string.Join(';', Enumerable.Range(0, 16385).Select(index => $"c{index}")) + "\n");
        var longName = Encoding.UTF8.GetBytes($"a;{new string('n', 257)}\n1;2\n");

        //Act
        var columns = FirstFailure(wide, Options(delimiter: ";"));
        var name = FirstFailure(longName, Options(delimiter: ";"));

        //Assert
        Assert.Equal("O arquivo tem mais de 16.384 colunas.", columns.Message);
        Assert.Equal(EImportReadReason.Limits, columns.Reason);
        Assert.Equal("O nome da coluna 2 do arquivo passa de 256 caracteres.", name.Message);
    }

    [Trait("CsvImportReader", "Limits")]
    [Fact(DisplayName = "ERRO o valor acima de 64 MiB para a leitura ali, com a linha e a coluna")]
    public void Next_ValueAbove64MiB_ShouldBeRefused()
    {
        //Arrange
        var bytes = new byte[ImportReader.MaxValueBytes + 16];
        Array.Fill(bytes, (byte)'x');
        Encoding.ASCII.GetBytes("id;obs\n1;").CopyTo(bytes, 0);

        //Act
        var refusal = FirstFailure(bytes, Options(ImportEncodings.Utf8, ";"));

        //Assert
        Assert.True(refusal.ValueTooLarge);
        Assert.Equal("obs", refusal.Column);
        Assert.Equal(2, refusal.Line);
        Assert.Equal("Um valor da linha 2 do arquivo, coluna obs, passa de 64 MiB, e o Prism não o importa.", refusal.Message);
    }

    [Trait("CsvImportReader", "Position")]
    [Fact(DisplayName = "OK o progresso é dos bytes lidos sobre o tamanho do arquivo")]
    public void Position_ShouldFollowTheBytesRead()
    {
        //Arrange
        var bytes = Encoding.UTF8.GetBytes("a;b\n1;2\n");

        //Act
        var (reader, _) = ReadAll(bytes, Options(ImportEncodings.Utf8, ";"));

        //Assert
        Assert.Equal(bytes.Length, reader.Size);
        Assert.Equal(bytes.Length, reader.Position);
    }
}
