using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Imports;
using System.Data;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// RN-IMPORT-024 e 026: os valores de banco para banco. O nulo é o da origem; o binário só vai para uma coluna binária, em bytes; no PostgreSQL de destino o
/// texto vai como veio, e o Prism só recusa o que o banco faria em silêncio (a hora numa coluna só de data, o fuso numa coluna sem fuso); no Db2 e no
/// Informix de destino, o Prism converte como o texto de um arquivo, sem os formatos, o texto do nulo e as pontas. O fuso da data e hora com fuso do
/// PostgreSQL de origem sai, numa coluna sem fuso.
/// </summary>
public sealed class ImportValuesCopiedTests
{
    private const EDatabaseEngine Postgres = EDatabaseEngine.PostgreSql;
    private const EDatabaseEngine Db2 = EDatabaseEngine.Db2;
    private const EDatabaseEngine Informix = EDatabaseEngine.Informix;

    private static ImportTargetColumn Column(EDatabaseEngine engine, string type)
        => ImportColumns.Of(engine, new ColumnInfo("destino", type, true, false, 1, null, null));

    private static object? Converted(EDatabaseEngine source, string sourceType, string sourceKind, EDatabaseEngine target, string targetType, string? text)
    {
        var converted = ImportValues.ConvertCopied(source, "origem", sourceType, sourceKind, target, Column(target, targetType), text is null ? ExportCell.Null : ExportCell.FromText(text));

        return converted.IsSuccess ? converted.Value.Value : converted.Error;
    }

    [Trait("ImportValues", "ConvertCopied")]
    [Fact(DisplayName = "OK o nulo da origem passa em qualquer coluna, e o texto vazio não é nulo")]
    public void ConvertCopied_Null_ShouldPass()
    {
        //Act
        var nullValue = ImportValues.ConvertCopied(Postgres, "origem", "text", "text", Db2, Column(Db2, "INTEGER"), ExportCell.Null);
        var empty = ImportValues.ConvertCopied(Postgres, "origem", "text", "text", Postgres, Column(Postgres, "text"), ExportCell.FromText(string.Empty));

        //Assert
        Assert.Null(nullValue.Value.Value);
        Assert.Equal(string.Empty, empty.Value.Value);
    }

    /// <summary>RN-IMPORT-024: o binário só vai para uma coluna binária, em bytes, e a coluna binária só recebe binário; o `0x` de um texto não vira binário.</summary>
    [Trait("ImportValues", "ConvertCopied")]
    [Fact(DisplayName = "OK o binário vai em bytes para a coluna binária, e o par que não é binário dos dois lados é recusado")]
    public void ConvertCopied_Binary_ShouldOnlyGoToABinaryColumn()
    {
        //Act
        var bytes = ImportValues.ConvertCopied(Db2, "foto", "BLOB", "binary", Postgres, Column(Postgres, "bytea"), ExportCell.FromBytes([0xCA, 0xFE]));
        var intoText = ImportValues.ConvertCopied(Postgres, "foto", "bytea", "binary", Db2, Column(Db2, "VARCHAR(10)"), ExportCell.FromBytes([1]));
        var fromText = ImportValues.ConvertCopied(Postgres, "foto", "text", "text", Informix, Column(Informix, "BYTE"), ExportCell.FromText("0xCAFE"));

        //Assert
        Assert.Equal(new byte[] { 0xCA, 0xFE }, (byte[]?)bytes.Value.Value);
        Assert.Equal(DbType.Binary, bytes.Value.Type);
        Assert.Equal("A coluna foto da origem é binária, e a coluna de destino não é.", intoText.Error);
        Assert.Equal("A coluna foto da origem não é binária, e a coluna de destino é.", fromText.Error);
    }

    /// <summary>RN-IMPORT-026: no PostgreSQL de destino o banco converte: o texto vai como veio, também o que o Prism recusaria num arquivo.</summary>
    [Trait("ImportValues", "ConvertCopied")]
    [Theory(DisplayName = "OK no PostgreSQL de destino o texto vai como veio")]
    [InlineData("numeric", "numeric(12,4)", "1234.5600")]
    [InlineData("money", "money", "R$ 1.234,56")]
    [InlineData("money", "numeric", "R$ 1.234,56")]
    [InlineData("interval", "interval", "1 day 02:00:00")]
    [InlineData("boolean", "boolean", "true")]
    [InlineData("date", "date", "2024-01-15 00:00:00")]
    [InlineData("timestamp without time zone", "timestamp(3) without time zone", "2024-01-15 10:30:00.123456")]
    public void ConvertCopied_IntoPostgres_ShouldSendTheText(string sourceType, string targetType, string text)
        => Assert.Equal(text, Converted(Postgres, sourceType, "text", Postgres, targetType, text));

    /// <summary>RN-IMPORT-026: o que o PostgreSQL faria em silêncio: a hora que não é zero numa coluna só de data e o fuso de um texto numa coluna sem fuso.</summary>
    [Trait("ImportValues", "ConvertCopied")]
    [Theory(DisplayName = "Erro no PostgreSQL de destino, a hora numa coluna só de data e o fuso de um texto numa coluna sem fuso")]
    [InlineData("timestamp without time zone", "date", "2024-01-15 10:30:00", "«2024-01-15 10:30:00» tem hora, e a coluna destino é só data.")]
    [InlineData("text", "timestamp without time zone", "2024-01-15 10:30:00-03", "«2024-01-15 10:30:00-03» tem fuso, e a coluna não guarda fuso.")]
    public void ConvertCopied_IntoPostgres_ShouldRefuseWhatTheDatabaseWouldHide(string sourceType, string targetType, string text, string refusal)
        => Assert.Equal(refusal, Converted(Postgres, sourceType, "text", Postgres, targetType, text));

    /// <summary>RN-IMPORT-026: a data e hora com fuso do PostgreSQL vai a uma coluna sem fuso com a hora que ele escreveu, sem o fuso; com fuso, como veio.</summary>
    [Trait("ImportValues", "ConvertCopied")]
    [Theory(DisplayName = "OK o fuso da data e hora com fuso do PostgreSQL sai numa coluna sem fuso")]
    [InlineData(Postgres, "timestamp without time zone", "2024-01-15 10:30:00-03", "2024-01-15 10:30:00")]
    [InlineData(Postgres, "timestamp with time zone", "2024-01-15 10:30:00-03", "2024-01-15 10:30:00-03")]
    [InlineData(Postgres, "time without time zone", "10:30:00+05:30", "10:30:00")]
    [InlineData(Postgres, "timestamp without time zone", "1890-01-15 10:30:00-03:06:28", "1890-01-15 10:30:00")]
    public void ConvertCopied_ZonedSource_ShouldDropTheZone(EDatabaseEngine target, string targetType, string text, string expected)
        => Assert.Equal(expected, Converted(Postgres, text.Length > 15 ? "timestamp with time zone" : "time with time zone", "datetime", target, targetType, text));

    /// <summary>RN-IMPORT-026: no Db2 e no Informix de destino, o Prism converte o texto da origem, com os formatos canônicos e as casas da coluna.</summary>
    [Trait("ImportValues", "ConvertCopied")]
    [Theory(DisplayName = "OK no Db2 e no Informix de destino, o texto vira o valor do tipo da coluna")]
    [InlineData(Db2, "INTEGER", "42", 42)]
    [InlineData(Db2, "DECIMAL(10,2)", "12.500", "12.50")]
    [InlineData(Informix, "BOOLEAN", "1", "t")]
    [InlineData(Informix, "BOOLEAN", "true", "t")]
    public void ConvertCopied_IntoIbm_ShouldConvert(EDatabaseEngine target, string targetType, string text, object expected)
    {
        //Act
        var value = Converted(Postgres, "text", "text", target, targetType, text);

        //Assert
        Assert.Equal(expected is string decimalText && targetType.StartsWith("DECIMAL", StringComparison.Ordinal) ? decimal.Parse(decimalText, System.Globalization.CultureInfo.InvariantCulture) : expected, value);
    }

    /// <summary>
    /// RN-IMPORT-026: as recusas do Prism no Db2 e no Informix de destino: o `money` do PostgreSQL, que não é um número; as casas a mais que não são zero; a
    /// hora numa coluna só de data (e, no Informix, os campos depois do último do `DATETIME YEAR TO DAY`, `HOUR` ou `MINUTE`); e as pontas, que não saem na
    /// cópia.
    /// </summary>
    [Trait("ImportValues", "ConvertCopied")]
    [Theory(DisplayName = "Erro no Db2 e no Informix de destino, o que não converte é recusado na linha")]
    [InlineData(Db2, "DECIMAL(10,2)", "R$ 1.234,56", "«R$ 1.234,56» não é um número.")]
    [InlineData(Db2, "DECIMAL(10,2)", "1.999", "«1.999» tem mais casas decimais que as 2 da coluna destino.")]
    [InlineData(Informix, "DATE", "2024-01-15 10:30:00.000000", "«2024-01-15 10:30:00.000000» tem hora, e a coluna destino é só data.")]
    [InlineData(Informix, "DATETIME YEAR TO DAY", "2024-01-15 10:30:00.000000", "«2024-01-15 10:30:00.000000» tem hora, e a coluna destino é só data.")]
    [InlineData(Informix, "DATETIME YEAR TO MINUTE", "2024-01-15 10:30:45.000000", "«2024-01-15 10:30:45.000000» tem segundos, e a coluna destino guarda só até os minutos.")]
    [InlineData(Db2, "INTEGER", " 12", "« 12» não é um número inteiro.")]
    public void ConvertCopied_IntoIbm_ShouldRefuse(EDatabaseEngine target, string targetType, string text, string refusal)
        => Assert.Equal(refusal, Converted(Postgres, "text", "text", target, targetType, text));

    /// <summary>RN-IMPORT-026: a data e hora do Informix (o texto que o Prism escreve do valor do driver, com 6 casas) volta numa coluna sem fração: as casas a mais são zero.</summary>
    [Trait("ImportValues", "ConvertCopied")]
    [Fact(DisplayName = "OK a data e hora com casas a mais que são zero vai para a coluna que não as guarda")]
    public void ConvertCopied_ZeroFraction_ShouldFit()
    {
        //Act
        var value = Converted(Informix, "DATETIME", "datetime", Informix, "DATETIME YEAR TO SECOND", "2024-01-15 10:30:00.000000");

        //Assert
        Assert.Equal(new DateTime(2024, 1, 15, 10, 30, 0), value);
    }

    /// <summary>RN-IMPORT-026 (emenda de 2026-10-17 da RN-IMPORT-010): a data e hora do Informix com a hora zero vai para o `DATETIME YEAR TO DAY`, sem ela.</summary>
    [Trait("ImportValues", "ConvertCopied")]
    [Fact(DisplayName = "OK a data e hora com a hora zero vai para o DATETIME YEAR TO DAY do Informix")]
    public void ConvertCopied_ZeroTimeIntoYearToDay_ShouldFit()
    {
        //Act
        var value = Converted(Informix, "DATETIME", "datetime", Informix, "DATETIME YEAR TO DAY", "2024-01-15 00:00:00.000000");

        //Assert
        Assert.Equal(new DateTime(2024, 1, 15), value);
    }
}
