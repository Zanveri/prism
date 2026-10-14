using Bogus;
using Prism.Infrastructure.Databases.Clients;
using System.Globalization;
using System.Net;
using System.Numerics;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-SQL-011: cada célula viaja como texto ou nulo, sem perder precisão, e texto longo e binário chegam
/// cortados, com a marca do corte. A classe inteira roda em `pt-BR`, onde o separador decimal é a vírgula e
/// a data é dia/mês/ano: o texto de uma célula não pode depender da cultura da máquina.
/// </summary>
public sealed class CellFormatterTests : IDisposable
{
    private readonly CultureInfo _previousCulture = CultureInfo.CurrentCulture;

    public CellFormatterTests()
        => CultureInfo.CurrentCulture = new CultureInfo("pt-BR");

    public void Dispose()
        => CultureInfo.CurrentCulture = _previousCulture;

    [Trait("CellFormatter", "Format")]
    [Fact(DisplayName = "OK o maior inteiro de 64 bits chega com todos os dígitos")]
    public void Format_ShouldKeepEveryDigit_OfLongMaxValue()
    {
        //Act
        var text = CellFormatter.Format(long.MaxValue, out var truncated);

        //Assert
        Assert.Equal("9223372036854775807", text);
        Assert.False(truncated);
    }

    /// <summary>
    /// O valor do plano (`12345678901234567890.1234567890`) tem 30 dígitos e não cabe num `decimal`, que guarda
    /// 28 a 29: o compilador o arredondaria. Este tem 29, com o zero final da escala, e é o maior que o tipo
    /// representa sem perder nada.
    /// </summary>
    [Trait("CellFormatter", "Format")]
    [Fact(DisplayName = "OK decimal de 29 dígitos sai igual, sem expoente e com o zero final da escala")]
    public void Format_ShouldKeepPrecisionAndScale_OfDecimal()
    {
        //Arrange
        var value = decimal.Parse("1234567890123456789.1234567890", CultureInfo.InvariantCulture);

        //Act
        var text = CellFormatter.Format(value, out var truncated);

        //Assert
        Assert.Equal("1234567890123456789.1234567890", text);
        Assert.False(truncated);
    }

    [Trait("CellFormatter", "Format")]
    [Fact(DisplayName = "OK ponto flutuante usa ponto, e não a vírgula da cultura")]
    public void Format_ShouldUseInvariantSeparator_ForFloatingPoint()
    {
        //Act
        var fromDouble = CellFormatter.Format(0.1d, out _);
        var fromSingle = CellFormatter.Format(1.5f, out _);
        var fromBigInteger = CellFormatter.Format(BigInteger.Parse("123456789012345678901234567890"), out _);

        //Assert
        Assert.Equal("0.1", fromDouble);
        Assert.Equal("1.5", fromSingle);
        Assert.Equal("123456789012345678901234567890", fromBigInteger);
    }

    [Trait("CellFormatter", "Format")]
    [Fact(DisplayName = "OK booleano vira true ou false, em minúsculas")]
    public void Format_ShouldWriteLowercaseBoolean()
    {
        //Act
        var whenTrue = CellFormatter.Format(true, out _);
        var whenFalse = CellFormatter.Format(false, out _);

        //Assert
        Assert.Equal("true", whenTrue);
        Assert.Equal("false", whenFalse);
    }

    [Trait("CellFormatter", "Format")]
    [Fact(DisplayName = "OK data e hora saem em ano-mês-dia com os microssegundos")]
    public void Format_ShouldWriteIsoDateTime_WithMicroseconds()
    {
        //Arrange
        var value = new DateTime(2026, 10, 9, 13, 5, 7, DateTimeKind.Unspecified).AddTicks(1234560);

        //Act
        var text = CellFormatter.Format(value, out var truncated);

        //Assert
        Assert.Equal("2026-10-09 13:05:07.123456", text);
        Assert.False(truncated);
    }

    [Trait("CellFormatter", "Format")]
    [Fact(DisplayName = "OK data sem hora, hora sem data e data com deslocamento")]
    public void Format_ShouldWriteDateOnly_TimeOnly_AndOffset()
    {
        //Act
        var date = CellFormatter.Format(new DateOnly(2026, 2, 3), out _);
        var time = CellFormatter.Format(new TimeOnly(4, 5, 6, 789), out _);
        var withOffset = CellFormatter.Format(new DateTimeOffset(2026, 10, 9, 13, 5, 7, TimeSpan.FromHours(-3)), out _);

        //Assert
        Assert.Equal("2026-02-03", date);
        Assert.Equal("04:05:06.789000", time);
        Assert.Equal("2026-10-09 13:05:07.000000-03:00", withOffset);
    }

    [Trait("CellFormatter", "Format")]
    [Fact(DisplayName = "OK nulo do banco e nulo do C# viram nulo")]
    public void Format_ShouldReturnNull_ForDBNullAndNull()
    {
        //Act
        var fromDbNull = CellFormatter.Format(DBNull.Value, out var dbNullTruncated);
        var fromNull = CellFormatter.Format(null, out var nullTruncated);

        //Assert
        Assert.Null(fromDbNull);
        Assert.Null(fromNull);
        Assert.False(dbNullTruncated);
        Assert.False(nullTruncated);
    }

    [Trait("CellFormatter", "Format")]
    [Fact(DisplayName = "OK texto de 20.000 caracteres chega com 10.000 e a marca de corte")]
    public void Format_ShouldCutLongText_AndMarkTheCell()
    {
        //Arrange
        var value = new Faker().Random.String2(length: 20000);

        //Act
        var text = CellFormatter.Format(value, out var truncated);

        //Assert
        Assert.Equal(value[..10000], text);
        Assert.True(truncated);
    }

    [Trait("CellFormatter", "Format")]
    [Fact(DisplayName = "OK texto de exatamente 10.000 caracteres chega inteiro, sem marca")]
    public void Format_ShouldKeepTextAtTheLimit()
    {
        //Arrange
        var value = new Faker().Random.String2(length: 10000);

        //Act
        var text = CellFormatter.Format(value, out var truncated);

        //Assert
        Assert.Equal(value, text);
        Assert.False(truncated);
    }

    /// <summary>Um emoji ocupa dois `char`: cortar entre eles deixaria meio caractere, que vira lixo na tela.</summary>
    [Trait("CellFormatter", "Format")]
    [Fact(DisplayName = "OK o corte não parte um caractere de dois char ao meio")]
    public void Format_ShouldNotSplitASurrogatePair_WhenCutting()
    {
        //Arrange
        var value = new string('a', 9999) + "😀" + new string('b', 50);

        //Act
        var text = CellFormatter.Format(value, out var truncated);

        //Assert
        Assert.Equal(new string('a', 9999), text);
        Assert.True(truncated);
    }

    [Trait("CellFormatter", "Format")]
    [Fact(DisplayName = "OK binário de 100 bytes chega como 0x e 64 dígitos hex, com a marca de corte")]
    public void Format_ShouldCutBinary_AndMarkTheCell()
    {
        //Arrange
        var value = new Faker().Random.Bytes(100);

        //Act
        var text = CellFormatter.Format(value, out var truncated);

        //Assert
        Assert.Equal("0x" + Convert.ToHexString(value[..32]), text);
        Assert.Equal(66, text!.Length);
        Assert.True(truncated);
    }

    [Trait("CellFormatter", "Format")]
    [Fact(DisplayName = "OK binário de 4 bytes chega inteiro, sem marca")]
    public void Format_ShouldKeepShortBinary()
    {
        //Act
        var text = CellFormatter.Format(new byte[] { 0xDE, 0xAD, 0xBE, 0xEF }, out var truncated);

        //Assert
        Assert.Equal("0xDEADBEEF", text);
        Assert.False(truncated);
    }

    /// <summary>RN-SQL-017: o corte é só da grade. O valor completo da célula cortada é o texto inteiro, sem o corte do par de `char`.</summary>
    [Trait("CellFormatter", "Full")]
    [Fact(DisplayName = "OK o valor completo do texto cortado é o texto inteiro, e conta 2 bytes por caractere")]
    public void Full_ShouldKeepTheWholeText()
    {
        //Arrange
        var value = new string('x', 9999) + "😀" + new string('y', 40000);

        //Act
        CellFormatter.Format(value, out var truncated);
        var full = CellFormatter.Full(value);

        //Assert
        Assert.True(truncated);
        Assert.Equal(value, full.Write());
        Assert.Equal(2L * value.Length, full.Bytes);
    }

    /// <summary>RN-SQL-017: o binário inteiro, em hexadecimal como a grade escreve os primeiros 32 bytes; na memória ele fica como veio, um byte por byte.</summary>
    [Trait("CellFormatter", "Full")]
    [Fact(DisplayName = "OK o valor completo do binário cortado é o binário inteiro em hexadecimal, e conta 1 byte por byte")]
    public void Full_ShouldKeepTheWholeBinary()
    {
        //Arrange
        var bytes = Enumerable.Range(0, 70000).Select(index => (byte)(index * 7)).ToArray();

        //Act
        var cut = CellFormatter.Format(bytes, out var truncated);
        var full = CellFormatter.Full(bytes);

        //Assert
        Assert.True(truncated);
        Assert.Equal("0x" + Convert.ToHexString(bytes), full.Write());
        Assert.StartsWith(cut!, full.Write(), StringComparison.Ordinal);
        Assert.Equal(bytes.Length, full.Bytes);
    }

    [Trait("CellFormatter", "Format")]
    [Fact(DisplayName = "OK tipo que o formatador não conhece sai pelo texto do próprio valor")]
    public void Format_ShouldFallBackToTheValueText()
    {
        //Arrange
        var guid = Guid.NewGuid();

        //Act
        var fromGuid = CellFormatter.Format(guid, out _);
        var fromAddress = CellFormatter.Format(IPAddress.Parse("192.0.2.1"), out _);
        var fromTimeSpan = CellFormatter.Format(new TimeSpan(1, 2, 3, 4), out _);

        //Assert
        Assert.Equal(guid.ToString(), fromGuid);
        Assert.Equal("192.0.2.1", fromAddress);
        Assert.Equal("1.02:03:04", fromTimeSpan);
    }

    [Trait("CellFormatter", "KindOf")]
    [Fact(DisplayName = "OK o tipo da coluna diz como a tela a alinha")]
    public void KindOf_ShouldClassifyTheColumnType()
    {
        //Act
        var kinds = new[] { typeof(int), typeof(long), typeof(decimal), typeof(double), typeof(BigInteger), typeof(string), typeof(Guid), typeof(DateTime), typeof(DateTimeOffset), typeof(DateOnly), typeof(TimeOnly), typeof(bool), typeof(byte[]) }.Select(CellFormatter.KindOf).ToArray();

        //Assert
        Assert.Equal(["number", "number", "number", "number", "number", "text", "text", "datetime", "datetime", "datetime", "datetime", "boolean", "binary"], kinds);
    }
}
