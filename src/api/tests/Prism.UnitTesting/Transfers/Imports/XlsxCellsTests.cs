using Prism.Infrastructure.Transfers.Readers;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// RN-IMPORT-006: as regras puras de uma célula do XLSX: o número de data pelo sistema de datas da pasta (o de 1900, com o 29/02/1900 que o Excel inventa,
/// e o de 1904), a hora arredondada ao milissegundo, a célula de data ISO 8601, o número no texto mais curto, a referência e o erro do Excel.
/// </summary>
public sealed class XlsxCellsTests
{
    [Trait("XlsxCells", "DateText")]
    [Theory(DisplayName = "OK o número com formato de data vira a data, a data e hora ou a hora")]
    [InlineData(1d, false, "Date", "1900-01-01")]
    [InlineData(59d, false, "Date", "1900-02-28")]
    [InlineData(61d, false, "Date", "1900-03-01")]
    [InlineData(45306d, false, "Date", "2024-01-15")]
    [InlineData(45306.4375d, false, "Date", "2024-01-15")]
    [InlineData(45306.4375d, false, "DateTime", "2024-01-15 10:30:00")]
    [InlineData(45306.0000005d, false, "DateTime", "2024-01-15 00:00:00.043")]
    [InlineData(45306.9999999999d, false, "DateTime", "2024-01-16 00:00:00")]
    [InlineData(0.5d, false, "Time", "12:00:00")]
    [InlineData(0.75d, true, "Time", "18:00:00")]
    [InlineData(1.5d, false, "Time", "1900-01-01 12:00:00")]
    [InlineData(0d, true, "Date", "1904-01-01")]
    [InlineData(1d, true, "Date", "1904-01-02")]
    public void DateText_ShouldFollowTheDateSystem(double serial, bool date1904, string kind, string expected)
    {
        //Act
        var text = XlsxCells.DateText(serial, date1904, Enum.Parse<EXlsxNumberKind>(kind), out var refusal);

        //Assert
        Assert.Equal(EXlsxDateRefusal.None, refusal);
        Assert.Equal(expected, text);
    }

    [Trait("XlsxCells", "DateText")]
    [Theory(DisplayName = "ERRO o 29/02/1900 do Excel, o negativo e a parte inteira menor que 1 numa data do sistema de 1900")]
    [InlineData(60d, false, "Date", "Leap1900")]
    [InlineData(-1d, false, "Date", "NotADate")]
    [InlineData(-0.5d, true, "Time", "NotADate")]
    [InlineData(0.5d, false, "Date", "NotADate")]
    [InlineData(0.5d, false, "DateTime", "NotADate")]
    [InlineData(1e10d, false, "Date", "NotADate")]
    public void DateText_ShouldRefuseWhatIsNotADate(double serial, bool date1904, string kind, string expected)
    {
        //Act
        var text = XlsxCells.DateText(serial, date1904, Enum.Parse<EXlsxNumberKind>(kind), out var refusal);

        //Assert
        Assert.Null(text);
        Assert.Equal(Enum.Parse<EXlsxDateRefusal>(expected), refusal);
    }

    [Trait("XlsxCells", "IsoDateText")]
    [Theory(DisplayName = "OK a célula de data (t=\"d\") vale a data ISO 8601 dela, com o fuso quando tem; a que não é ISO é nula")]
    [InlineData("2024-01-15", "2024-01-15")]
    [InlineData("2024-01-15T10:30", "2024-01-15 10:30:00")]
    [InlineData("2024-01-15T10:30:00.123", "2024-01-15 10:30:00.123")]
    [InlineData("2024-01-15T10:30:00Z", "2024-01-15 10:30:00Z")]
    [InlineData("2024-01-15T10:30:00-03:00", "2024-01-15 10:30:00-03:00")]
    [InlineData("10:30:00", "10:30:00")]
    [InlineData("2024-02-30", null)]
    [InlineData("15/01/2024", null)]
    [InlineData("2024-01-15 10:30", null)]
    public void IsoDateText_ShouldReadIso8601(string text, string? expected)
        => Assert.Equal(expected, XlsxCells.IsoDateText(text));

    [Trait("XlsxCells", "NumberText")]
    [Theory(DisplayName = "OK o número no texto mais curto que volta ao mesmo número, com ponto")]
    [InlineData("0.1", "0.1")]
    [InlineData("12", "12")]
    [InlineData("12.0", "12")]
    [InlineData("1E20", "1E+20")]
    [InlineData("0.30000000000000004", "0.30000000000000004")]
    [InlineData("-2.5e-3", "-0.0025")]
    [InlineData("abc", null)]
    public void NumberText_ShouldBeTheShortest(string value, string? expected)
        => Assert.Equal(expected, XlsxCells.NumberText(value));

    [Trait("XlsxCells", "TryParseReference")]
    [Theory(DisplayName = "OK a referência da célula dentro de A1:XFD1048576; fora dela, ou mal escrita, não serve")]
    [InlineData("A1", true, 0, 1)]
    [InlineData("C12", true, 2, 12)]
    [InlineData("XFD1048576", true, 16383, 1048576)]
    [InlineData("XFE1", false, 0, 0)]
    [InlineData("A1048577", false, 0, 0)]
    [InlineData("a1", false, 0, 0)]
    [InlineData("12", false, 0, 0)]
    [InlineData("A", false, 0, 0)]
    public void TryParseReference_ShouldStayWithinExcel(string reference, bool valid, int column, int row)
    {
        //Act
        var parsed = XlsxCells.TryParseReference(reference, out var parsedColumn, out var parsedRow);

        //Assert
        Assert.Equal(valid, parsed);
        if (valid)
        {
            Assert.Equal(column, parsedColumn);
            Assert.Equal(row, parsedRow);
        }
    }

    [Trait("XlsxCells", "ErrorText")]
    [Theory(DisplayName = "OK o erro do Excel como ele o mostra em português; o desconhecido, como veio")]
    [InlineData("#N/A", "#N/D")]
    [InlineData("#VALUE!", "#VALOR!")]
    [InlineData("#DIV/0!", "#DIV/0!")]
    [InlineData("#REF!", "#REF!")]
    public void ErrorText_ShouldBeThePortugueseOne(string code, string expected)
        => Assert.Equal(expected, XlsxCells.ErrorText(code));
}
