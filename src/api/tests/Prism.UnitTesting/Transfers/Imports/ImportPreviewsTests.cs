using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Imports;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// RN-IMPORT-007, 008 e 011: as linhas das prévias: o nulo que o arquivo e as opções do leitor dizem, sem a conversão, na prévia do arquivo; as células
/// convertidas de cada coluna mapeada, com a recusa do Prism e, depois, a do banco; e o teto das respostas (1.000 caracteres por célula, 8 MiB de células).
/// </summary>
public sealed class ImportPreviewsTests
{
    private static readonly ImportReadInfo TwoColumns = new(new ImportEncodingInfo(ImportEncodings.Utf8, false), ";", null, null, null, ["a", "b"]);

    private static ImportValueRules Rules(string nullText = "", bool emptyAsNull = false, bool trim = false)
        => ImportValueRules.Of(CsvImportOptions.Default with { NullText = nullText, EmptyAsNull = emptyAsNull, Trim = trim }, ";");

    private static ImportRecord Record(long line, params ImportValue[] values)
        => new(line, values, null, false);

    private static ImportValue Plain(string text)
        => new(text, EImportValueSource.Plain);

    private static ImportValue Quoted(string text)
        => new(text, EImportValueSource.Quoted);

    [Trait("ImportPreviews", "FileRows")]
    [Fact(DisplayName = "OK a prévia do arquivo: o texto do nulo só sem aspas, o vazio com a opção, as pontas só com a opção, e o resto como veio")]
    public void FileRows_ShouldShowTheValuesAsRead()
    {
        //Arrange
        var records = new[]
        {
            Record(2, Plain("NULL"), Quoted("NULL")),
            Record(3, Plain(" NULL "), Plain(string.Empty)),
            Record(4, ImportValue.Null, Plain(" 'x ")),
            new ImportRecord(5, [Plain("1"), ImportValue.Null], null, true)
        };

        //Act
        var plain = ImportPreviews.FileRows(TwoColumns, records, Rules("NULL"));
        var trimmed = ImportPreviews.FileRows(TwoColumns, records, Rules("NULL", emptyAsNull: true, trim: true));

        //Assert
        Assert.Equal(2, plain.ShownColumns);
        Assert.Equal([null, "NULL"], plain.Rows[0].Values);
        Assert.Equal([" NULL ", string.Empty], plain.Rows[1].Values);
        Assert.Equal([null, " 'x "], plain.Rows[2].Values);
        Assert.Equal(3, plain.Rows[1].Line);
        Assert.True(plain.Rows[3].Short);
        Assert.Equal([null, null], trimmed.Rows[1].Values);
        Assert.Equal(" 'x ", trimmed.Rows[2].Values[1]);
    }

    [Trait("ImportPreviews", "FileRows")]
    [Fact(DisplayName = "OK o texto do nulo com o separador ou a aspa é nulo também entre aspas, como o Exportar o escreve")]
    public void FileRows_NullTextWithTheDelimiter_ShouldBeNullAlsoQuoted()
    {
        //Arrange
        var records = new[] { Record(2, Quoted("a;b"), Quoted("x")) };

        //Act
        var preview = ImportPreviews.FileRows(TwoColumns, records, Rules("a;b"));

        //Assert
        Assert.Equal([null, "x"], preview.Rows[0].Values);
    }

    [Trait("ImportPreviews", "FileRows")]
    [Fact(DisplayName = "OK a célula cortada nos 1.000 caracteres e só as primeiras colunas que cabem em 8 MiB de células, com os nomes todos")]
    public void FileRows_ShouldCutTheCellsAndTheColumns()
    {
        //Arrange
        var wide = new ImportValue(new string('x', 1500), EImportValueSource.Text);
        var info = TwoColumns with { Columns = [.. Enumerable.Range(0, 500).Select(index => $"c{index}")] };
        var records = Enumerable.Range(2, ImportPreviews.Rows).Select(line => new ImportRecord(line, [.. Enumerable.Repeat(wide, 500)], null, false)).ToList();

        //Act
        var preview = ImportPreviews.FileRows(info, records, ImportValueRules.None);

        //Assert
        // Cada célula cortada tem 1.000 "x" e o "…" (3 bytes): 20.060 bytes por coluna nas 20 linhas, e 418 colunas cabem em 8 MiB.
        Assert.Equal($"{new string('x', 1000)}…", preview.Rows[0].Values[0]);
        Assert.Equal(418, preview.ShownColumns);
        Assert.All(preview.Rows, row => Assert.Equal(418, row.Values.Count));
        Assert.Equal(500, preview.Info.Columns.Count);
    }

    [Trait("ImportPreviews", "ConvertedRows")]
    [Fact(DisplayName = "OK as células convertidas na ordem do mapeamento, com a recusa do Prism, o binário em 0x e o problema da linha")]
    public void ConvertedRows_ShouldConvertEachMappedColumn()
    {
        //Arrange
        var table = new[]
        {
            ImportColumns.Of(EDatabaseEngine.Db2, new ColumnInfo("ID", "INTEGER", false, true, 1, null, null)),
            ImportColumns.Of(EDatabaseEngine.Db2, new ColumnInfo("FOTO", "BLOB", true, false, 2, null, null))
        };
        var mapping = new[] { new ImportMappingEntry(1, "FOTO"), new ImportMappingEntry(0, "ID") };
        var records = new[]
        {
            Record(2, Plain(" 12 "), Plain("0x0aff")),
            new ImportRecord(3, [Plain("12a"), Plain("zz")], new ImportProblem("A linha 3 tem 3 valores, e o cabeçalho tem 2."), false)
        };

        //Act
        var (rows, converted) = ImportPreviews.ConvertedRows(EDatabaseEngine.Db2, records, mapping, table, Rules(), ImportValueFormats.Default);

        //Assert
        Assert.Equal(new ImportPreviewCell("0x0AFF", null), rows[0].Cells[0]);
        Assert.Equal(new ImportPreviewCell("12", null), rows[0].Cells[1]);
        Assert.Equal(12, converted[0][1]!.Parameter.Value);
        Assert.Equal(new byte[] { 0x0a, 0xff }, (byte[])converted[0][0]!.Parameter.Value!);
        Assert.Equal(new ImportPreviewCell(null, "Um binário vem como 0x seguido dos dígitos hexadecimais."), rows[1].Cells[0]);
        Assert.Equal(new ImportPreviewCell(null, "«12a» não é um número inteiro."), rows[1].Cells[1]);
        Assert.Null(converted[1][1]);
        Assert.Equal("A linha 3 tem 3 valores, e o cabeçalho tem 2.", rows[1].Problem);
    }

    [Trait("ImportPreviews", "WithDatabaseProblems")]
    [Fact(DisplayName = "OK a recusa do banco toma o lugar do valor na célula, e as outras ficam")]
    public void WithDatabaseProblems_ShouldMarkTheRefusedCells()
    {
        //Arrange
        IReadOnlyList<ImportPreviewRow> rows = [new ImportPreviewRow(2, null, false, [new ImportPreviewCell("12a", null), new ImportPreviewCell("Ana", null)])];

        //Act
        var marked = ImportPreviews.WithDatabaseProblems(rows, [["invalid input syntax for type integer: \"12a\"", null]]);

        //Assert
        Assert.Equal(new ImportPreviewCell(null, "invalid input syntax for type integer: \"12a\""), marked[0].Cells[0]);
        Assert.Equal(new ImportPreviewCell("Ana", null), marked[0].Cells[1]);
    }

    [Trait("ImportPreviews", "Fit")]
    [Fact(DisplayName = "OK a prévia convertida leva só as primeiras colunas que cabem em 8 MiB, contando o valor e o motivo")]
    public void Fit_ShouldKeepTheColumnsThatFit()
    {
        //Arrange
        var four = new string('x', 4 * 1024 * 1024);
        IReadOnlyList<ImportPreviewRow> rows =
        [
            new ImportPreviewRow(2, null, false, [new ImportPreviewCell(four, null), new ImportPreviewCell(null, four), new ImportPreviewCell("1", null)]),
            new ImportPreviewRow(3, null, false, [new ImportPreviewCell("1", null), new ImportPreviewCell("1", null), new ImportPreviewCell("1", null)])
        ];

        //Act
        var (shown, fitted) = ImportPreviews.Fit(rows, 3);

        //Assert
        Assert.Equal(1, shown);
        Assert.All(fitted, row => Assert.Single(row.Cells));
    }
}
