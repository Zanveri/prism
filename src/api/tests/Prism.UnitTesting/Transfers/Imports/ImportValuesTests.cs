using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Imports;
using System.Data;
using System.Diagnostics;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// RN-IMPORT-009 e 010: as classes das colunas pelo tipo de cada banco, o que impede uma coluna de receber valores, e o que a conversão entrega à carga:
/// no PostgreSQL o texto canônico (e os bytes do binário); no Db2 e no Informix o valor já convertido, com o tipo quando ele não basta. Os textos de cada
/// regra estão nas fixtures (`ImportFixturesTests`).
/// </summary>
public sealed class ImportValuesTests
{
    private static ImportTargetColumn Column(EDatabaseEngine engine, string type, string? generated = null, string? defaultValue = null)
        => ImportColumns.Of(engine, new ColumnInfo("coluna", type, true, false, 1, defaultValue, generated));

    [Trait("ImportColumns", "Of")]
    [Theory(DisplayName = "OK a classe de cada tipo, nos três bancos")]
    [InlineData(EDatabaseEngine.PostgreSql, "character varying(80)", EImportClass.Text)]
    [InlineData(EDatabaseEngine.PostgreSql, "\"char\"", EImportClass.Text)]
    [InlineData(EDatabaseEngine.PostgreSql, "public.citext", EImportClass.Text)]
    [InlineData(EDatabaseEngine.PostgreSql, "numeric(10,2)", EImportClass.Number)]
    [InlineData(EDatabaseEngine.PostgreSql, "timestamp(3) with time zone", EImportClass.DateTime)]
    [InlineData(EDatabaseEngine.PostgreSql, "time without time zone", EImportClass.Time)]
    [InlineData(EDatabaseEngine.PostgreSql, "bytea", EImportClass.Binary)]
    [InlineData(EDatabaseEngine.PostgreSql, "money", EImportClass.Other)]
    [InlineData(EDatabaseEngine.PostgreSql, "integer[]", EImportClass.Other)]
    [InlineData(EDatabaseEngine.PostgreSql, "jsonb", EImportClass.Other)]
    [InlineData(EDatabaseEngine.Db2, "LONG VARCHAR", EImportClass.Text)]
    [InlineData(EDatabaseEngine.Db2, "DBCLOB(1048576)", EImportClass.Text)]
    [InlineData(EDatabaseEngine.Db2, "DECFLOAT(16)", EImportClass.Number)]
    [InlineData(EDatabaseEngine.Db2, "TIMESTAMP(12)", EImportClass.DateTime)]
    [InlineData(EDatabaseEngine.Db2, "VARBINARY(32)", EImportClass.Binary)]
    [InlineData(EDatabaseEngine.Db2, "XML", EImportClass.Other)]
    [InlineData(EDatabaseEngine.Informix, "LVARCHAR(2048)", EImportClass.Text)]
    [InlineData(EDatabaseEngine.Informix, "TEXT", EImportClass.Text)]
    [InlineData(EDatabaseEngine.Informix, "SERIAL8", EImportClass.Number)]
    [InlineData(EDatabaseEngine.Informix, "DATETIME YEAR TO FRACTION(3)", EImportClass.DateTime)]
    [InlineData(EDatabaseEngine.Informix, "DATETIME YEAR TO DAY", EImportClass.DateTime)]
    [InlineData(EDatabaseEngine.Informix, "DATETIME HOUR TO SECOND", EImportClass.Time)]
    [InlineData(EDatabaseEngine.Informix, "DATETIME HOUR TO MINUTE", EImportClass.Other)]
    [InlineData(EDatabaseEngine.Informix, "BYTE", EImportClass.Binary)]
    [InlineData(EDatabaseEngine.Informix, "INTERVAL DAY TO SECOND", EImportClass.Other)]
    public void Of_ShouldClassifyTheType(EDatabaseEngine engine, string type, EImportClass expected)
        => Assert.Equal(expected, Column(engine, type).Class);

    /// <summary>RN-IMPORT-010 (emenda de 2026-10-17): o `DATETIME` do Informix que para no dia, na hora ou nos minutos diz o último campo; os outros, não.</summary>
    [Trait("ImportColumns", "Of")]
    [Theory(DisplayName = "OK o último campo do DATETIME do Informix que para antes dos segundos")]
    [InlineData("DATETIME YEAR TO DAY", EImportDateTimeEnd.Day)]
    [InlineData("DATETIME YEAR TO HOUR", EImportDateTimeEnd.Hour)]
    [InlineData("DATETIME YEAR TO MINUTE", EImportDateTimeEnd.Minute)]
    [InlineData("DATETIME YEAR TO SECOND", null)]
    [InlineData("DATETIME YEAR TO FRACTION(5)", null)]
    [InlineData("DATETIME HOUR TO SECOND", null)]
    public void Of_InformixDateTime_ShouldSayTheLastField(string type, EImportDateTimeEnd? expected)
        => Assert.Equal(expected, Column(EDatabaseEngine.Informix, type).EndsAt);

    [Trait("ImportColumns", "Of")]
    [Fact(DisplayName = "OK a calculada pelo banco e, no Db2 e no Informix, a outra não recebem valores; a outra do PostgreSQL recebe")]
    public void Of_ShouldSayWhatDoesNotReceiveValues()
    {
        //Act
        var generated = Column(EDatabaseEngine.PostgreSql, "integer", ColumnGeneration.Always);
        var db2Xml = Column(EDatabaseEngine.Db2, "XML");
        var json = Column(EDatabaseEngine.PostgreSql, "json");

        //Assert
        Assert.False(generated.Importable);
        Assert.Equal("O banco calcula esta coluna e não aceita valor.", generated.Reason);
        Assert.False(db2Xml.Importable);
        Assert.Equal("O Prism ainda não importa este tipo neste banco.", db2Xml.Reason);
        Assert.True(json.Importable);
        Assert.Null(json.Reason);
    }

    [Trait("ImportColumns", "Of")]
    [Fact(DisplayName = "OK no PostgreSQL, o padrão nextval é preenchido pelo banco, e o domínio vale pela classe do tipo-base")]
    public void Of_PostgresDefaultsAndDomains_ShouldBeRead()
    {
        //Act
        var serial = Column(EDatabaseEngine.PostgreSql, "integer", defaultValue: "nextval('loja.pedido_id_seq'::regclass)");
        var domain = ImportColumns.Of(EDatabaseEngine.PostgreSql, new ColumnInfo("valor", "loja.positivo", false, false, 2, null, null), "numeric");

        //Assert
        Assert.Equal(ColumnGeneration.ByDefault, serial.Generated);
        Assert.Equal(EImportClass.Number, domain.Class);
        Assert.Equal("loja.positivo", domain.Type);
    }

    [Trait("ImportValues", "Convert")]
    [Fact(DisplayName = "OK no PostgreSQL vai o texto canônico, sem tipo, e o binário em bytes")]
    public void Convert_Postgres_ShouldSendTheCanonicalText()
    {
        //Act
        var number = ImportValues.Convert(EDatabaseEngine.PostgreSql, Column(EDatabaseEngine.PostgreSql, "numeric"), new ImportValue("1,5", EImportValueSource.Plain), ImportValueRules.None, ImportValueFormats.Default with { Decimal = EImportDecimal.Comma });
        var binary = ImportValues.Convert(EDatabaseEngine.PostgreSql, Column(EDatabaseEngine.PostgreSql, "bytea"), new ImportValue("0x0102", EImportValueSource.Plain), ImportValueRules.None, ImportValueFormats.Default);

        //Assert
        Assert.Equal(new EditParameter("1.5"), number.Value.Parameter);
        Assert.Equal([1, 2], (byte[])binary.Value.Parameter.Value!);
        Assert.Equal(DbType.Binary, binary.Value.Parameter.Type);
    }

    [Trait("ImportValues", "Convert")]
    [Fact(DisplayName = "OK no Db2 e no Informix vai o valor convertido: o inteiro na faixa, o decimal, a data e hora, o lógico de cada banco")]
    public void Convert_IbmDatabases_ShouldSendTheConvertedValue()
    {
        //Act
        var smallint = ImportValues.Convert(EDatabaseEngine.Db2, Column(EDatabaseEngine.Db2, "SMALLINT"), new ImportValue("1.2E2", EImportValueSource.Plain), ImportValueRules.None, ImportValueFormats.Default);
        var decimalValue = ImportValues.Convert(EDatabaseEngine.Db2, Column(EDatabaseEngine.Db2, "DECIMAL(10,2)"), new ImportValue("1.500", EImportValueSource.Plain), ImportValueRules.None, ImportValueFormats.Default);
        var timestamp = ImportValues.Convert(EDatabaseEngine.Informix, Column(EDatabaseEngine.Informix, "DATETIME YEAR TO FRACTION(5)"), new ImportValue("15/01/2024 10:30", EImportValueSource.Plain), ImportValueRules.None, ImportValueFormats.Default with { Dates = EImportDates.DayMonthYear });
        var db2Boolean = ImportValues.Convert(EDatabaseEngine.Db2, Column(EDatabaseEngine.Db2, "BOOLEAN"), new ImportValue("falso", EImportValueSource.Plain), ImportValueRules.None, ImportValueFormats.Default);
        var informixBoolean = ImportValues.Convert(EDatabaseEngine.Informix, Column(EDatabaseEngine.Informix, "BOOLEAN"), new ImportValue("true", EImportValueSource.Canonical), ImportValueRules.None, ImportValueFormats.Default);
        var date = ImportValues.Convert(EDatabaseEngine.Db2, Column(EDatabaseEngine.Db2, "DATE"), new ImportValue("2024-01-15", EImportValueSource.Plain), ImportValueRules.None, ImportValueFormats.Default);

        //Assert
        Assert.Equal((short)120, smallint.Value.Parameter.Value);
        Assert.Equal(1.50m, decimalValue.Value.Parameter.Value);
        Assert.Equal(new DateTime(2024, 1, 15, 10, 30, 0), timestamp.Value.Parameter.Value);
        Assert.Equal("2024-01-15 10:30:00", timestamp.Value.Text);
        Assert.Equal(false, db2Boolean.Value.Parameter.Value);
        Assert.Equal("t", informixBoolean.Value.Parameter.Value);
        Assert.Equal(DbType.Date, date.Value.Parameter.Type);
    }

    /// <summary>
    /// RN-IMPORT-010 (emenda de 2026-10-17): no `DATETIME` do Informix que para no dia, na hora ou nos minutos, os campos a mais que são zero saem: vai a
    /// data e hora até o último campo, e a prévia o mostra só até ele. Os textos das recusas estão na fixture `import-dates`.
    /// </summary>
    [Trait("ImportValues", "Convert")]
    [Theory(DisplayName = "OK no DATETIME do Informix que para antes dos segundos, os campos a mais que são zero saem")]
    [InlineData("DATETIME YEAR TO DAY", "2024-01-15 00:00:00.000", "2024-01-15", 0, 0)]
    [InlineData("DATETIME YEAR TO HOUR", "2024-01-15 10:00", "2024-01-15 10", 10, 0)]
    [InlineData("DATETIME YEAR TO MINUTE", "2024-01-15 10:30:00", "2024-01-15 10:30", 10, 30)]
    public void Convert_InformixDateTimeUpToAField_ShouldDropTheZeroFields(string type, string text, string shown, int hour, int minute)
    {
        //Act
        var converted = ImportValues.Convert(EDatabaseEngine.Informix, Column(EDatabaseEngine.Informix, type), new ImportValue(text, EImportValueSource.Plain), ImportValueRules.None, ImportValueFormats.Default);

        //Assert
        Assert.True(converted.IsSuccess, converted.IsFailure ? converted.Error : null);
        Assert.Equal(shown, converted.Value.Text);
        Assert.Equal(new DateTime(2024, 1, 15, hour, minute, 0), converted.Value.Parameter.Value);
    }

    /// <summary>
    /// RN-IMPORT-010: o expoente que a expressão do número aceita com quantos dígitos vierem, até o que nem cabe num `long` (e o `long.MinValue`, cujo valor
    /// absoluto não existe), é recusado como fora da faixa, nas colunas de inteiro e de decimal com escala do Db2 e do Informix, sem lançar.
    /// </summary>
    [Trait("ImportValues", "Convert")]
    [Theory(DisplayName = "ERRO o expoente enorme é fora da faixa da coluna, sem lançar")]
    [InlineData(EDatabaseEngine.Db2, "INTEGER", "1E99999999999999999999")]
    [InlineData(EDatabaseEngine.Db2, "INTEGER", "2e-99999999999999999999")]
    [InlineData(EDatabaseEngine.Db2, "DECIMAL(10,2)", "1E+9223372036854775807")]
    [InlineData(EDatabaseEngine.Informix, "DECIMAL(10,2)", "1E-9223372036854775808")]
    [InlineData(EDatabaseEngine.Informix, "INT8", "1.5E1001")]
    public void Convert_HugeExponent_ShouldBeOutOfRange(EDatabaseEngine engine, string type, string text)
    {
        //Act
        var refused = ImportValues.Convert(engine, Column(engine, type), new ImportValue(text, EImportValueSource.Plain), ImportValueRules.None, ImportValueFormats.Default);

        //Assert
        Assert.Equal($"«{text}» está fora da faixa da coluna.", refused.Error);
    }

    /// <summary>
    /// RN-IMPORT-010: a recusa do número diz quando o texto seria um número com o outro separador; e a conferência disso não volta em tempo quadrático no
    /// valor longo que não casa (um milhão de dígitos entre a vírgula e o fim levaria horas na expressão de antes).
    /// </summary>
    [Trait("ImportValues", "CanonicalNumber")]
    [Theory(DisplayName = "OK a recusa do número sugere o outro separador, e o valor longo que não casa é recusado na hora")]
    [InlineData(EImportDecimal.Point, false, "1,", "não é um número com ponto decimal")]
    [InlineData(EImportDecimal.Comma, false, "1.", "tem ponto, e o separador decimal escolhido é a vírgula")]
    [InlineData(EImportDecimal.Comma, true, "1.", "não é um número com vírgula decimal e ponto de milhar")]
    public void CanonicalNumber_LongRefusal_ShouldBeLinear(EImportDecimal separator, bool thousandsDot, string start, string hint)
    {
        //Arrange
        var formats = new ImportValueFormats(separator, thousandsDot, EImportDates.Iso);
        var number = $"{start}5";
        var text = $"{start}{new string('9', 1_000_000)}x";
        var stopwatch = Stopwatch.StartNew();

        //Act
        var refused = ImportValues.CanonicalNumber(text, formats, false, false);
        stopwatch.Stop();
        var suggested = ImportValues.CanonicalNumber(number, formats, false, false);

        //Assert
        Assert.True(refused.IsFailure);
        Assert.DoesNotContain(hint, refused.Error, StringComparison.Ordinal);
        Assert.Contains(hint, suggested.Error, StringComparison.Ordinal);
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(2), $"A recusa levou {stopwatch.ElapsedMilliseconds} ms.");
    }

    [Trait("ImportValues", "Convert")]
    [Fact(DisplayName = "OK o valor que perdeu o apóstrofo da proteção é marcado, para o aviso do fim contar")]
    public void Convert_Unguarded_ShouldBeMarked()
    {
        //Arrange
        var rules = ImportValueRules.Of(CsvImportOptions.Default, ";");

        //Act
        var unguarded = ImportValues.Convert(EDatabaseEngine.PostgreSql, Column(EDatabaseEngine.PostgreSql, "text"), new ImportValue("'@ana", EImportValueSource.Plain), rules, ImportValueFormats.Default);
        var kept = ImportValues.Convert(EDatabaseEngine.PostgreSql, Column(EDatabaseEngine.PostgreSql, "text"), new ImportValue("'ana", EImportValueSource.Plain), rules, ImportValueFormats.Default);

        //Assert
        Assert.True(unguarded.Value.Unguarded);
        Assert.Equal("@ana", unguarded.Value.Text);
        Assert.False(kept.Value.Unguarded);
    }

    [Trait("ImportValues", "Convert")]
    [Fact(DisplayName = "ERRO a coluna que não recebe valores recusa com o motivo dela")]
    public void Convert_NotImportable_ShouldBeRefused()
    {
        //Act
        var refused = ImportValues.Convert(EDatabaseEngine.Db2, Column(EDatabaseEngine.Db2, "XML"), new ImportValue("<a/>", EImportValueSource.Plain), ImportValueRules.None, ImportValueFormats.Default);

        //Assert
        Assert.Equal("O Prism ainda não importa este tipo neste banco.", refused.Error);
    }

    [Trait("ImportValues", "PreviewBinary")]
    [Fact(DisplayName = "OK o binário da prévia mostra 0x e os primeiros 32 bytes")]
    public void PreviewBinary_ShouldCutAt32Bytes()
    {
        //Act
        var preview = ImportValues.PreviewBinary([.. Enumerable.Range(0, 40).Select(index => (byte)index)]);

        //Assert
        Assert.Equal($"0x{string.Concat(Enumerable.Range(0, 32).Select(index => index.ToString("X2")))}…", preview);
    }
}
