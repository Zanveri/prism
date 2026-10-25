using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using System.Data;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-VAR-017: a conversão de cada valor para o parâmetro de cada banco, como a sonda S-VAR-1 provou. O `DB2Type` é dito pelo nome (`EIbmParameterType`), porque o
/// assembly da IBM não existe nos testes de unidade; quem o traduz é a conexão da IBM, provada nos testes de integração.
/// </summary>
public sealed class QueryParameterBindingTests
{
    private static QueryParameter Number(string? value) => new(EQueryParameterType.Number, value);
    private static QueryParameter Text(string? value) => new(EQueryParameterType.Text, value);
    private static QueryParameter Boolean(string? value) => new(EQueryParameterType.Boolean, value);
    private static QueryParameter Date(string? value) => new(EQueryParameterType.Date, value);
    private static QueryParameter Timestamp(string? value) => new(EQueryParameterType.Timestamp, value);

    [Trait("QueryParameterBinding", "Convert")]
    [Fact(DisplayName = "OK no PostgreSQL todo valor vai como o texto de tipo desconhecido, e o nulo como DBNull")]
    public void Convert_PostgreSql_ShouldSendTheTextAsUnknown()
    {
        //Act
        var converted = new[] { Number("12.5000"), Text("it's"), Boolean("true"), Date("2026-10-20"), Timestamp("2026-10-20 10:30:00-03"), Number(null), Text(null) }
            .Select(parameter => QueryParameterBinding.Convert(ESqlDialect.PostgreSql, parameter)).ToList();

        //Assert
        Assert.All(converted, bound => Assert.True(bound.Unknown));
        Assert.Equal(["12.5000", "it's", "true", "2026-10-20", "2026-10-20 10:30:00-03", DBNull.Value, DBNull.Value], converted.Select(bound => bound.Value));
    }

    [Trait("QueryParameterBinding", "Convert")]
    [Fact(DisplayName = "OK no Db2 e no Informix o inteiro vai em BIGINT, o decimal pelo texto exato, e o número com expoente em DOUBLE")]
    public void Convert_Numbers_ShouldFollowTheTable()
    {
        foreach (var dialect in new[] { ESqlDialect.Db2, ESqlDialect.Informix })
        {
            //Act
            var integer = QueryParameterBinding.Convert(dialect, Number("9007199254740993"));
            var negative = QueryParameterBinding.Convert(dialect, Number("-42"));
            var decimals = QueryParameterBinding.Convert(dialect, Number("12.5000"));
            var big = QueryParameterBinding.Convert(dialect, Number("9223372036854775808"));
            var wide = QueryParameterBinding.Convert(dialect, Number("1234567890123456789012345678901"));
            var exponent = QueryParameterBinding.Convert(dialect, Number("1.5e300"));

            //Assert
            Assert.Equal(new BoundQueryParameter(9007199254740993L, Ibm: EIbmParameterType.BigInt), integer);
            Assert.Equal(new BoundQueryParameter(-42L, Ibm: EIbmParameterType.BigInt), negative);
            Assert.Equal(new BoundQueryParameter("12.5000", Ibm: EIbmParameterType.Decimal), decimals);
            Assert.Equal(new BoundQueryParameter("9223372036854775808", Ibm: EIbmParameterType.Decimal), big);
            Assert.Equal(new BoundQueryParameter("1234567890123456789012345678901", Ibm: EIbmParameterType.Decimal), wide);
            Assert.Equal(new BoundQueryParameter(1.5e300, Ibm: EIbmParameterType.Double), exponent);
        }
    }

    [Trait("QueryParameterBinding", "Convert")]
    [Fact(DisplayName = "OK o -2^63 vai como BIGINT no Db2 e como decimal no Informix, cujo INT8 não o tem")]
    public void Convert_MinimumInteger_ShouldGoAsADecimalInInformix()
    {
        //Act
        var db2 = QueryParameterBinding.Convert(ESqlDialect.Db2, Number("-9223372036854775808"));
        var informix = QueryParameterBinding.Convert(ESqlDialect.Informix, Number("-9223372036854775808"));
        var informixNext = QueryParameterBinding.Convert(ESqlDialect.Informix, Number("-9223372036854775807"));

        //Assert
        Assert.Equal(new BoundQueryParameter(long.MinValue, Ibm: EIbmParameterType.BigInt), db2);
        Assert.Equal(new BoundQueryParameter("-9223372036854775808", Ibm: EIbmParameterType.Decimal), informix);
        Assert.Equal(new BoundQueryParameter(-9223372036854775807L, Ibm: EIbmParameterType.BigInt), informixNext);
    }

    [Trait("QueryParameterBinding", "Convert")]
    [Fact(DisplayName = "OK o texto vai em VARCHAR, e em CLOB no Db2 acima de 32.672 bytes")]
    public void Convert_Db2Text_ShouldGoAsClobOverTheLimit()
    {
        //Arrange
        var atLimit = new string('x', 32_672);
        var accents = new string('é', 16_337);

        //Act
        var small = QueryParameterBinding.Convert(ESqlDialect.Db2, Text("it's"));
        var limit = QueryParameterBinding.Convert(ESqlDialect.Db2, Text(atLimit));
        var over = QueryParameterBinding.Convert(ESqlDialect.Db2, Text(atLimit + "x"));
        var bytes = QueryParameterBinding.Convert(ESqlDialect.Db2, Text(accents));

        //Assert
        Assert.Equal(EIbmParameterType.VarChar, small.Ibm);
        Assert.Equal(EIbmParameterType.VarChar, limit.Ibm);
        Assert.Equal(EIbmParameterType.Clob, over.Ibm);
        Assert.Equal(EIbmParameterType.Clob, bytes.Ibm);
    }

    [Trait("QueryParameterBinding", "Convert")]
    [Fact(DisplayName = "OK no Informix o texto vai em VARCHAR, em LONG VARCHAR de 16.351 caracteres até 32.767 bytes, e em CLOB acima, como a edição")]
    public void Convert_InformixText_ShouldGoByTheSizeLikeTheEdit()
    {
        //Act
        var small = QueryParameterBinding.Convert(ESqlDialect.Informix, Text(new string('x', 16_350)));
        var long1 = QueryParameterBinding.Convert(ESqlDialect.Informix, Text(new string('x', 16_351)));
        var long2 = QueryParameterBinding.Convert(ESqlDialect.Informix, Text(new string('x', 32_767)));
        var clob = QueryParameterBinding.Convert(ESqlDialect.Informix, Text(new string('x', 32_768)));

        //Assert
        Assert.Equal([EIbmParameterType.VarChar, EIbmParameterType.LongVarChar, EIbmParameterType.LongVarChar, EIbmParameterType.Clob], [small.Ibm, long1.Ibm, long2.Ibm, clob.Ibm]);
    }

    [Trait("QueryParameterBinding", "Convert")]
    [Fact(DisplayName = "OK o booleano vai como bool no Db2 (DbType.Boolean) e como o texto t ou f no Informix")]
    public void Convert_Boolean_ShouldGoByTheEngine()
    {
        //Assert
        Assert.Equal(new BoundQueryParameter(true, DbType.Boolean), QueryParameterBinding.Convert(ESqlDialect.Db2, Boolean("true")));
        Assert.Equal(new BoundQueryParameter(false, DbType.Boolean), QueryParameterBinding.Convert(ESqlDialect.Db2, Boolean("false")));
        Assert.Equal(new BoundQueryParameter("t", Ibm: EIbmParameterType.VarChar), QueryParameterBinding.Convert(ESqlDialect.Informix, Boolean("true")));
        Assert.Equal(new BoundQueryParameter("f", Ibm: EIbmParameterType.VarChar), QueryParameterBinding.Convert(ESqlDialect.Informix, Boolean("false")));
    }

    [Trait("QueryParameterBinding", "Convert")]
    [Fact(DisplayName = "OK a data de dia e o instante vão como DateTime, com até 6 casas, sem fuso")]
    public void Convert_DatesAndInstants_ShouldGoAsDateTime()
    {
        foreach (var dialect in new[] { ESqlDialect.Db2, ESqlDialect.Informix })
        {
            //Act
            var day = QueryParameterBinding.Convert(dialect, Date("2026-10-20"));
            var instant = QueryParameterBinding.Convert(dialect, Timestamp("2026-10-20 10:30:05"));
            var fraction = QueryParameterBinding.Convert(dialect, Timestamp("2026-10-20 10:30:05.123456"));
            var first = QueryParameterBinding.Convert(dialect, Timestamp("0001-01-01 00:00:00"));

            //Assert
            Assert.Equal(new BoundQueryParameter(new DateTime(2026, 10, 20), Ibm: EIbmParameterType.Date), day);
            Assert.Equal(new BoundQueryParameter(new DateTime(2026, 10, 20, 10, 30, 5), Ibm: EIbmParameterType.Timestamp), instant);
            Assert.Equal(new DateTime(2026, 10, 20, 10, 30, 5).AddTicks(1_234_560), fraction.Value);
            Assert.Equal(new DateTime(1, 1, 1), first.Value);
        }
    }

    [Trait("QueryParameterBinding", "Convert")]
    [Fact(DisplayName = "OK o nulo leva o tipo do valor para o Db2 e o Informix")]
    public void Convert_Null_ShouldKeepTheType()
    {
        //Act
        var db2 = new[] { Number(null), Text(null), Boolean(null), Date(null), Timestamp(null) }.Select(parameter => QueryParameterBinding.Convert(ESqlDialect.Db2, parameter)).ToList();
        var informix = new[] { Number(null), Text(null), Boolean(null), Date(null), Timestamp(null) }.Select(parameter => QueryParameterBinding.Convert(ESqlDialect.Informix, parameter)).ToList();

        //Assert
        Assert.All(db2.Concat(informix), bound => Assert.Equal(DBNull.Value, bound.Value));
        Assert.Equal([EIbmParameterType.BigInt, EIbmParameterType.VarChar, EIbmParameterType.None, EIbmParameterType.Date, EIbmParameterType.Timestamp], db2.Select(bound => bound.Ibm));
        Assert.Equal(DbType.Boolean, db2[2].DbType);
        Assert.Equal([EIbmParameterType.BigInt, EIbmParameterType.VarChar, EIbmParameterType.VarChar, EIbmParameterType.Date, EIbmParameterType.Timestamp], informix.Select(bound => bound.Ibm));
    }

    [Trait("QueryParameterBinding", "Literal")]
    [Theory(DisplayName = "OK o literal do Ver SQL: o número como está, o booleano de cada banco, o texto entre aspas, e o que o literal não escreve fica sem literal")]
    [InlineData("postgresql", "number", "12.50", "12.50")]
    [InlineData("postgresql", "boolean", "true", "TRUE")]
    [InlineData("informix", "boolean", "false", "'f'")]
    [InlineData("db2", "text", "it's", "'it''s'")]
    [InlineData("db2", "date", "2026-10-20", "'2026-10-20'")]
    [InlineData("db2", "text", "a\nb", null)]
    [InlineData("db2", "text", null, "NULL")]
    public void Literal_ShouldWriteTheValueForReading(string engine, string type, string? value, string? expected)
    {
        //Arrange
        var dialect = engine switch { "postgresql" => ESqlDialect.PostgreSql, "db2" => ESqlDialect.Db2, _ => ESqlDialect.Informix };

        //Act
        var literal = QueryParameterBinding.Literal(dialect, new QueryParameter(Enum.Parse<EQueryParameterType>(type, ignoreCase: true), value));

        //Assert
        Assert.Equal(expected, literal);
    }
}
