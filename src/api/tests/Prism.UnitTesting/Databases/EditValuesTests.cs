using Prism.Infrastructure.Databases.Clients;
using System.Data;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EDIT-006 e 008: o tipo de cada coluna para a edição, a conversão do texto digitado e o literal do "Ver SQL". No PostgreSQL quem
/// converte é o banco, e o texto vai como está; no Db2 e no Informix quem converte é o Prism, do mesmo formato em que ele escreveu a
/// célula, sem depender da cultura da máquina.
/// </summary>
public sealed class EditValuesTests
{
    [Trait("EditValues", "TypeOf")]
    [Fact(DisplayName = "OK no PostgreSQL todo tipo se edita, menos o binário")]
    public void TypeOf_ShouldEditEveryPostgresTypeButBinary()
    {
        Assert.Equal(EEditType.Text, EditValues.TypeOf(ESqlDialect.PostgreSql, "integer", "number"));
        Assert.Equal(EEditType.Text, EditValues.TypeOf(ESqlDialect.PostgreSql, "jsonb", "text"));
        Assert.Equal(EEditType.Binary, EditValues.TypeOf(ESqlDialect.PostgreSql, "bytea", "binary"));
    }

    [Trait("EditValues", "TypeOf")]
    [Theory(DisplayName = "OK no Db2 e no Informix só os tipos que o Prism converte se editam")]
    [InlineData("Db2", "VARCHAR(80)", "text", "Text")]
    [InlineData("Db2", "CHARACTER(10)", "text", "Text")]
    [InlineData("Db2", "CHARACTER(10)", "binary", "Binary")]
    [InlineData("Db2", "SMALLINT", "number", "Int16")]
    [InlineData("Db2", "INTEGER", "number", "Int32")]
    [InlineData("Db2", "BIGINT", "number", "Int64")]
    [InlineData("Db2", "DECIMAL(31,5)", "text", "Decimal")]
    [InlineData("Db2", "DECFLOAT(34)", "text", "Decimal")]
    [InlineData("Db2", "DOUBLE", "number", "Float")]
    [InlineData("Db2", "DATE", "datetime", "Date")]
    [InlineData("Db2", "TIME", "datetime", "Time")]
    [InlineData("Db2", "TIMESTAMP(12)", "datetime", "Timestamp")]
    [InlineData("Db2", "BOOLEAN", "boolean", "Boolean")]
    [InlineData("Db2", "BLOB(1048576)", "binary", "Binary")]
    [InlineData("Db2", "CLOB(1048576)", "text", "Text")]
    [InlineData("Db2", "DBCLOB(1048576)", "text", "Text")]
    [InlineData("Db2", "NCLOB(1048576)", "text", "Text")]
    [InlineData("Db2", "LONG VARCHAR", "text", "Text")]
    [InlineData("Db2", "XML", "text", "Text")]
    [InlineData("Db2", "JSON", "text", "Text")]
    [InlineData("Informix", "LVARCHAR(2048)", "text", "Text")]
    [InlineData("Informix", "SERIAL", "number", "Int32")]
    [InlineData("Informix", "INT8", "number", "Int64")]
    [InlineData("Informix", "MONEY(16,2)", "text", "Decimal")]
    [InlineData("Informix", "SMALLFLOAT", "number", "Float")]
    [InlineData("Informix", "DATETIME YEAR TO FRACTION(5)", "datetime", "Timestamp")]
    [InlineData("Informix", "DATETIME HOUR TO SECOND", "datetime", "Time")]
    [InlineData("Informix", "DATETIME MONTH TO DAY", "datetime", "Unsupported")]
    [InlineData("Informix", "INTERVAL DAY TO SECOND", "text", "Unsupported")]
    [InlineData("Informix", "BOOLEAN", "number", "Boolean")]
    [InlineData("Informix", "TEXT", "text", "Text")]
    [InlineData("Informix", "CLOB", "text", "Text")]
    [InlineData("Informix", "JSON", "text", "Text")]
    [InlineData("Informix", "BSON", "text", "Text")]
    [InlineData("Informix", "BYTE", "binary", "Binary")]
    [InlineData("Informix", "BLOB", "binary", "Binary")]
    public void TypeOf_ShouldClassifyTheIbmTypes(string dialect, string type, string kind, string expected)
        => Assert.Equal(Enum.Parse<EEditType>(expected), EditValues.TypeOf(Enum.Parse<ESqlDialect>(dialect), type, kind));

    [Trait("EditValues", "Convert")]
    [Fact(DisplayName = "OK no PostgreSQL o texto vai como está, nulo é NULL e binário vira byte[]")]
    public void Convert_ShouldKeepThePostgresText()
    {
        Assert.Equal("2026-01-02 03:04:05+00", EditValues.Convert(ESqlDialect.PostgreSql, EEditType.Text, "2026-01-02 03:04:05+00").Value.Value);
        Assert.Null(EditValues.Convert(ESqlDialect.PostgreSql, EEditType.Text, null).Value.Value);

        var hexBinary = EditValues.Convert(ESqlDialect.PostgreSql, EEditType.Binary, "0x4F69").Value;
        Assert.Equal(new byte[] { 0x4F, 0x69 }, (byte[])hexBinary.Value!);
        Assert.Equal(DbType.Binary, hexBinary.Type);

        var pgHexBinary = EditValues.Convert(ESqlDialect.PostgreSql, EEditType.Binary, @"\x4F69").Value;
        Assert.Equal(new byte[] { 0x4F, 0x69 }, (byte[])pgHexBinary.Value!);

        var utf8Binary = EditValues.Convert(ESqlDialect.PostgreSql, EEditType.Binary, "Oi").Value;
        Assert.Equal(new byte[] { 0x4F, 0x69 }, (byte[])utf8Binary.Value!);
    }

    [Trait("EditValues", "Convert")]
    [Fact(DisplayName = "OK no Db2 e no Informix o texto vira o valor do tipo, no formato em que o Prism escreveu a célula")]
    public void Convert_ShouldParseTheIbmText()
    {
        Assert.Equal((short)-12, Value(ESqlDialect.Db2, EEditType.Int16, "-12"));
        Assert.Equal(123456, Value(ESqlDialect.Db2, EEditType.Int32, "123456"));
        Assert.Equal(9007199254740993L, Value(ESqlDialect.Informix, EEditType.Int64, "9007199254740993"));
        Assert.Equal(1234.50m, Value(ESqlDialect.Db2, EEditType.Decimal, "1234.50"));
        Assert.Equal(0.1, Value(ESqlDialect.Db2, EEditType.Float, "0.1"));
        Assert.Equal(new TimeSpan(13, 5, 7), Value(ESqlDialect.Db2, EEditType.Time, "13:05:07"));
        Assert.Equal(new DateTime(2026, 10, 9, 13, 5, 7, 123).AddTicks(4560), Value(ESqlDialect.Informix, EEditType.Timestamp, "2026-10-09 13:05:07.123456"));
        Assert.Equal(new DateTime(2026, 10, 9, 13, 5, 7), Value(ESqlDialect.Db2, EEditType.Timestamp, "2026-10-09 13:05:07"));
        Assert.Equal(true, Value(ESqlDialect.Db2, EEditType.Boolean, "true"));
        Assert.Equal("t", Value(ESqlDialect.Informix, EEditType.Boolean, "1"));
        Assert.Equal("f", Value(ESqlDialect.Informix, EEditType.Boolean, "false"));
        Assert.Equal("it's", Value(ESqlDialect.Informix, EEditType.Text, "it's"));

        var date = EditValues.Convert(ESqlDialect.Db2, EEditType.Date, "2026-10-09").Value;
        Assert.Equal((new DateTime(2026, 10, 9), DbType.Date), (date.Value, date.Type));
    }

    /// <summary>O que não cabe no tipo do C# vai como texto no formato canônico, e quem termina a conversão é o banco: o decimal de 31 dígitos e o `TIMESTAMP(12)` do Db2.</summary>
    [Trait("EditValues", "Convert")]
    [Fact(DisplayName = "OK o decimal de mais de 28 dígitos e a fração de mais de 7 casas do Db2 vão como texto canônico")]
    public void Convert_ShouldSendTheCanonicalTextWhatDoesNotFitTheDotNetType()
    {
        Assert.Equal("1234567890123456789012345.123456", Value(ESqlDialect.Db2, EEditType.Decimal, "1234567890123456789012345.123456"));
        Assert.Equal("2026-10-09-13.05.07.123456789012", Value(ESqlDialect.Db2, EEditType.Timestamp, "2026-10-09 13:05:07.123456789012"));
    }

    [Trait("EditValues", "Convert")]
    [Theory(DisplayName = "OK o texto que não converte é recusado com o motivo, antes de ir ao banco")]
    [InlineData("Db2", "Int16", "40000", "«40000» está fora da faixa da coluna.")]
    [InlineData("Db2", "Int32", "12.5", "«12.5» não é um número inteiro.")]
    [InlineData("Db2", "Decimal", "1,5", "«1,5» não é um número: use ponto para as casas decimais.")]
    [InlineData("Informix", "Float", "abc", "«abc» não é um número: use ponto para as casas decimais.")]
    [InlineData("Db2", "Date", "09/10/2026", "«09/10/2026» não é uma data no formato aaaa-mm-dd.")]
    [InlineData("Db2", "Date", "2026-02-30", "«2026-02-30» não é uma data no formato aaaa-mm-dd.")]
    [InlineData("Db2", "Time", "25:00:00", "«25:00:00» não é uma hora no formato hh:mm:ss.")]
    [InlineData("Informix", "Timestamp", "2026-10-09 13:05:07.12345678", "«2026-10-09 13:05:07.12345678» não é uma data e hora no formato aaaa-mm-dd hh:mm:ss, com até 7 casas de fração.")]
    [InlineData("Db2", "Boolean", "sim", "«sim» não é um valor lógico: use true ou false.")]
    [InlineData("Informix", "Boolean", "sim", "«sim» não é um valor lógico: use 1 ou 0.")]
    [InlineData("Db2", "Binary", "0xZZ", "«0xZZ» não é um binário em hexadecimal (0x…).")]
    [InlineData("PostgreSql", "Binary", "0x123", "«0x123» não é um binário em hexadecimal (0x…).")]
    public void Convert_ShouldRefuseTextThatDoesNotConvert(string dialect, string type, string text, string message)
    {
        //Act
        var converted = EditValues.Convert(Enum.Parse<ESqlDialect>(dialect), Enum.Parse<EEditType>(type), text);

        //Assert
        Assert.True(converted.IsFailure);
        Assert.Equal(message, converted.Error);
    }

    [Trait("EditValues", "Literal")]
    [Fact(DisplayName = "OK o literal do Ver SQL é o do banco, e o valor com caractere de controle não tem literal")]
    public void Literal_ShouldWriteTheDatabaseLiteral()
    {
        Assert.Equal("NULL", EditValues.Literal(ESqlDialect.PostgreSql, EEditType.Text, "text", null));
        Assert.Equal("42", EditValues.Literal(ESqlDialect.PostgreSql, EEditType.Text, "number", "42"));
        Assert.Equal("'42'", EditValues.Literal(ESqlDialect.PostgreSql, EEditType.Text, "text", "42"));
        Assert.Equal("'it''s'", EditValues.Literal(ESqlDialect.PostgreSql, EEditType.Text, "text", "it's"));
        Assert.Equal(@"E'a\\b'", EditValues.Literal(ESqlDialect.PostgreSql, EEditType.Text, "text", @"a\b"));
        Assert.Equal(@"'a\b'", EditValues.Literal(ESqlDialect.Db2, EEditType.Text, "text", @"a\b"));
        Assert.Equal("DATE '2026-10-09'", EditValues.Literal(ESqlDialect.Db2, EEditType.Date, "datetime", "2026-10-09"));
        Assert.Equal("TIMESTAMP '2026-10-09 13:05:07.123'", EditValues.Literal(ESqlDialect.Db2, EEditType.Timestamp, "datetime", "2026-10-09 13:05:07.123"));
        Assert.Equal("TRUE", EditValues.Literal(ESqlDialect.Db2, EEditType.Boolean, "boolean", "true"));
        Assert.Equal("DATETIME (2026-10-09 13:05:07.12345) YEAR TO FRACTION(5)", EditValues.Literal(ESqlDialect.Informix, EEditType.Timestamp, "datetime", "2026-10-09 13:05:07.123456"));
        Assert.Equal("'t'", EditValues.Literal(ESqlDialect.Informix, EEditType.Boolean, "number", "1"));
        Assert.Equal("1.5", EditValues.Literal(ESqlDialect.Informix, EEditType.Decimal, "text", "1.5"));
        Assert.Equal("decode('4F69', 'hex')", EditValues.Literal(ESqlDialect.PostgreSql, EEditType.Binary, "binary", "0x4F69"));
        Assert.Equal("X'4F69'", EditValues.Literal(ESqlDialect.Db2, EEditType.Binary, "binary", "0x4F69"));
        Assert.Null(EditValues.Literal(ESqlDialect.Informix, EEditType.Binary, "binary", "0x4F69"));
        Assert.Null(EditValues.Literal(ESqlDialect.PostgreSql, EEditType.Text, "text", "linha 1\nlinha 2"));
    }

    private static object? Value(ESqlDialect dialect, EEditType type, string text)
    {
        var converted = EditValues.Convert(dialect, type, text);
        Assert.True(converted.IsSuccess, converted.IsFailure ? converted.Error : null);

        return converted.Value.Value;
    }
}
