using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using System.Text.Json;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-VAR-032: a forma dos `params` (campo por campo, sem o valor na mensagem), a leitura dos valores conferidos e o que só o banco decide (os dígitos do decimal, o
/// expoente que o `double` aguenta, o fuso do instante), antes de qualquer coisa ir ao banco.
/// </summary>
public sealed class QueryParameterRulesTests
{
    private static JsonElement Json(string json)
        => JsonDocument.Parse(json).RootElement.Clone();

    private static string One(string type, string? value)
        => $"[{{\"type\":\"{type}\",\"value\":{(value is null ? "null" : JsonSerializer.Serialize(value))}}}]";

    private static IReadOnlyList<(string Field, string Message)> RefusalsOf(string type, string? value)
        => QueryParameterRules.Refusals(Json(One(type, value)), "params");

    [Trait("QueryParameterRules", "Refusals")]
    [Theory(DisplayName = "OK sem params, ou com nulo, ou com a lista vazia, não há o que recusar")]
    [InlineData(null)]
    [InlineData("null")]
    [InlineData("[]")]
    public void Refusals_WithoutParameters_ShouldBeEmpty(string? json)
    {
        //Act
        var refusals = QueryParameterRules.Refusals(json is null ? null : Json(json), "params");

        //Assert
        Assert.Empty(refusals);
        Assert.Empty(QueryParameterRules.Read(json is null ? null : Json(json)));
    }

    [Trait("QueryParameterRules", "Refusals")]
    [Theory(DisplayName = "OK a forma certa de cada tipo é aceita")]
    [InlineData("number", "0")]
    [InlineData("number", "-0")]
    [InlineData("number", "12")]
    [InlineData("number", "-3.5")]
    [InlineData("number", "1e10")]
    [InlineData("number", "1E+10")]
    [InlineData("number", "1.5e-3")]
    [InlineData("number", "123456789012345678901234567890")]
    [InlineData("boolean", "true")]
    [InlineData("boolean", "false")]
    [InlineData("date", "2026-10-20")]
    [InlineData("date", "2024-02-29")]
    [InlineData("date", "0001-01-01")]
    [InlineData("date", "9999-12-31")]
    [InlineData("timestamp", "2026-10-20 10:30:00")]
    [InlineData("timestamp", "2026-10-20 10:30:00.1")]
    [InlineData("timestamp", "2026-10-20 10:30:00.123456")]
    [InlineData("timestamp", "2026-10-20 23:59:59")]
    [InlineData("timestamp", "2026-10-20 10:30:00Z")]
    [InlineData("timestamp", "2026-10-20 10:30:00+00")]
    [InlineData("timestamp", "2026-10-20 10:30:00-03:00")]
    [InlineData("timestamp", "2026-10-20 10:30:00+05:30")]
    [InlineData("text", "")]
    [InlineData("text", "it's \\ \"x\" ação ✓ 😀\nline")]
    public void Refusals_WithTheRightForm_ShouldBeEmpty(string type, string value)
    {
        //Act
        var refusals = RefusalsOf(type, value);

        //Assert
        Assert.Empty(refusals);
    }

    [Trait("QueryParameterRules", "Refusals")]
    [Theory(DisplayName = "OK o nulo de cada tipo é aceito")]
    [InlineData("text")]
    [InlineData("number")]
    [InlineData("boolean")]
    [InlineData("date")]
    [InlineData("timestamp")]
    public void Refusals_WithNull_ShouldBeEmpty(string type)
    {
        //Act
        var refusals = RefusalsOf(type, null);

        //Assert
        Assert.Empty(refusals);
        Assert.Equal([new QueryParameter(Enum.Parse<EQueryParameterType>(type, ignoreCase: true), null)], QueryParameterRules.Read(Json(One(type, null))));
    }

    [Trait("QueryParameterRules", "Refusals")]
    [Theory(DisplayName = "Erro a forma errada de cada tipo é recusada no campo value da entrada, sem o valor na mensagem")]
    [InlineData("number", "")]
    [InlineData("number", "+1")]
    [InlineData("number", "01")]
    [InlineData("number", ".5")]
    [InlineData("number", "5.")]
    [InlineData("number", "1e")]
    [InlineData("number", "0x1F")]
    [InlineData("number", "1_000")]
    [InlineData("number", "NaN")]
    [InlineData("number", "Infinity")]
    [InlineData("number", " 1")]
    [InlineData("number", "1 ")]
    [InlineData("number", "12\n")]
    [InlineData("boolean", "TRUE")]
    [InlineData("boolean", "1")]
    [InlineData("boolean", "t")]
    [InlineData("date", "2026-02-30")]
    [InlineData("date", "2025-02-29")]
    [InlineData("date", "2026-13-01")]
    [InlineData("date", "2026-1-1")]
    [InlineData("date", "0000-01-01")]
    [InlineData("date", "2026-10-20 10:00:00")]
    [InlineData("date", "26-10-20")]
    [InlineData("timestamp", "2026-10-20T10:30:00")]
    [InlineData("timestamp", "2026-10-20 24:00:00")]
    [InlineData("timestamp", "2026-10-20 10:60:00")]
    [InlineData("timestamp", "2026-10-20 10:30:60")]
    [InlineData("timestamp", "2026-10-20 10:30:00.1234567")]
    [InlineData("timestamp", "2026-10-20 10:30")]
    [InlineData("timestamp", "2026-02-30 10:30:00")]
    [InlineData("timestamp", "2026-10-20 10:30:00+16")]
    [InlineData("timestamp", "2026-10-20 10:30:00+03:60")]
    [InlineData("timestamp", "2026-10-20")]
    [InlineData("timestamp", "2026-10-20 10:30:00\n")]
    [InlineData("text", "a\0b")]
    public void Refusals_WithTheWrongForm_ShouldPointToTheValueField(string type, string value)
    {
        //Act
        var refusals = RefusalsOf(type, value);

        //Assert
        var refusal = Assert.Single(refusals);
        Assert.Equal("params[0].value", refusal.Field);
        Assert.False(string.IsNullOrWhiteSpace(refusal.Message));
        if (value.Length > 8)
            Assert.DoesNotContain(value, refusal.Message, StringComparison.Ordinal);
    }

    [Trait("QueryParameterRules", "Refusals")]
    [Fact(DisplayName = "OK o par UTF-16 inteiro vale")]
    public void Refusals_ShouldAcceptAWholeSurrogatePair()
    {
        //Assert
        Assert.Empty(RefusalsOf("text", "😀😀"));
        Assert.Empty(QueryParameterRules.Refusals(Json("[{\"type\":\"text\",\"value\":\"a\\uD83D\\uDE00b\"}]"), "params"));
    }

    /// <summary>A metade de um par UTF-16 escrita como escape do JSON: ler o texto lança no <c>System.Text.Json</c>, e a recusa tem de ser a do campo, e nunca o 500.</summary>
    [Trait("QueryParameterRules", "Refusals")]
    [Theory(DisplayName = "Erro a metade de um par UTF-16 no JSON é recusada no campo value, sem lançar")]
    [InlineData("a\\uD800b")]
    [InlineData("a\\uDC00b")]
    [InlineData("a\\uD800")]
    [InlineData("\\uD83D\\uD83D")]
    public void Refusals_WithAHalfSurrogateEscape_ShouldPointToTheValueField(string escaped)
    {
        //Arrange
        var parameters = Json($"[{{\"type\":\"text\",\"value\":\"{escaped}\"}}]");

        //Act
        var refusals = QueryParameterRules.Refusals(parameters, "params");

        //Assert
        Assert.Equal(["params[0].value"], refusals.Select(refusal => refusal.Field));
    }

    [Trait("QueryParameterRules", "Refusals")]
    [Fact(DisplayName = "Erro o UTF-8 inválido no texto do valor, ou do type, é recusado no campo, sem lançar")]
    public void Refusals_WithInvalidUtf8_ShouldPointToTheField()
    {
        //Arrange
        byte[] Body(string before, string after) => [.. System.Text.Encoding.UTF8.GetBytes(before), 0xFF, .. System.Text.Encoding.UTF8.GetBytes(after)];
        var value = JsonDocument.Parse(Body("[{\"type\":\"text\",\"value\":\"a", "b\"}]")).RootElement.Clone();
        var type = JsonDocument.Parse(Body("[{\"type\":\"te", "xt\",\"value\":\"b\"}]")).RootElement.Clone();

        //Assert
        Assert.Equal(["params[0].value"], QueryParameterRules.Refusals(value, "params").Select(refusal => refusal.Field));
        Assert.Equal(["params[0].type"], QueryParameterRules.Refusals(type, "params").Select(refusal => refusal.Field));
    }

    [Trait("QueryParameterRules", "Refusals")]
    [Fact(DisplayName = "OK os limites: 100 caracteres no número, 1.000.000 no texto, e um a mais é recusado")]
    public void Refusals_ShouldEnforceTheSizeLimits()
    {
        //Assert
        Assert.Empty(RefusalsOf("number", new string('9', 100)));
        Assert.Single(RefusalsOf("number", new string('9', 101)));
        Assert.Empty(RefusalsOf("text", new string('x', 1_000_000)));
        Assert.Single(RefusalsOf("text", new string('x', 1_000_001)));
    }

    [Trait("QueryParameterRules", "Refusals")]
    [Fact(DisplayName = "OK até 10.000 entradas; com uma a mais, a lista é recusada no campo params")]
    public void Refusals_ShouldEnforceTheCountLimit()
    {
        //Arrange
        string List(int count) => $"[{string.Join(',', Enumerable.Repeat("{\"type\":\"number\",\"value\":\"1\"}", count))}]";

        //Act
        var within = QueryParameterRules.Refusals(Json(List(10_000)), "params");
        var over = QueryParameterRules.Refusals(Json(List(10_001)), "params");

        //Assert
        Assert.Empty(within);
        Assert.Equal(["params"], over.Select(refusal => refusal.Field));
    }

    [Trait("QueryParameterRules", "Refusals")]
    [Fact(DisplayName = "OK o texto de todos os valores passa de 4 MiB em UTF-8 e é recusado no campo params")]
    public void Refusals_ShouldEnforceTheTotalSize()
    {
        //Arrange: 5 textos de 1.000.000 de caracteres de 1 byte cabem (5.000.000 > 4 MiB, então não): 4 cabem, 5 não.
        string Texts(int count, string character) => $"[{string.Join(',', Enumerable.Repeat($"{{\"type\":\"text\",\"value\":\"{new string(character[0], 1_000_000)}\"}}", count))}]";

        //Act
        var four = QueryParameterRules.Refusals(Json(Texts(4, "x")), "params");
        var five = QueryParameterRules.Refusals(Json(Texts(5, "x")), "params");
        var accents = QueryParameterRules.Refusals(Json(Texts(3, "é")), "params");

        //Assert
        Assert.Empty(four);
        Assert.Equal(["params"], five.Select(refusal => refusal.Field));
        Assert.Equal(["params"], accents.Select(refusal => refusal.Field));
    }

    [Trait("QueryParameterRules", "Refusals")]
    [Theory(DisplayName = "Erro a entrada que não é um objeto com type e value é recusada no campo da entrada")]
    [InlineData("[\"x\"]", "params[0]")]
    [InlineData("[1]", "params[0]")]
    [InlineData("[null]", "params[0]")]
    [InlineData("[[]]", "params[0]")]
    [InlineData("[{}]", "params[0]")]
    [InlineData("[{\"type\":\"text\"}]", "params[0]")]
    [InlineData("[{\"value\":\"x\"}]", "params[0]")]
    [InlineData("[{\"type\":\"text\",\"value\":\"x\",\"extra\":1}]", "params[0]")]
    [InlineData("[{\"type\":1,\"value\":\"x\"}]", "params[0].type")]
    [InlineData("[{\"type\":null,\"value\":\"x\"}]", "params[0].type")]
    [InlineData("[{\"type\":\"Text\",\"value\":\"x\"}]", "params[0].type")]
    [InlineData("[{\"type\":\"int\",\"value\":\"x\"}]", "params[0].type")]
    [InlineData("[{\"type\":\"number\",\"value\":5}]", "params[0].value")]
    [InlineData("[{\"type\":\"boolean\",\"value\":true}]", "params[0].value")]
    [InlineData("[{\"type\":\"text\",\"value\":[\"x\"]}]", "params[0].value")]
    [InlineData("{\"type\":\"text\",\"value\":\"x\"}", "params")]
    [InlineData("\"x\"", "params")]
    [InlineData("5", "params")]
    public void Refusals_WithAnEntryOutOfShape_ShouldPointToIt(string json, string field)
    {
        //Act
        var refusals = QueryParameterRules.Refusals(Json(json), "params");

        //Assert
        Assert.Equal([field], refusals.Select(refusal => refusal.Field));
    }

    [Trait("QueryParameterRules", "Refusals")]
    [Fact(DisplayName = "OK cada entrada errada é recusada no campo dela, com o prefixo pedido (source.params)")]
    public void Refusals_ShouldReportEveryEntryUnderThePrefix()
    {
        //Arrange
        var json = Json("[{\"type\":\"number\",\"value\":\"1\"},{\"type\":\"number\",\"value\":\"x\"},{\"type\":\"date\",\"value\":\"2026-02-30\"},{\"type\":\"text\",\"value\":\"ok\"}]");

        //Act
        var refusals = QueryParameterRules.Refusals(json, "source.params");

        //Assert
        Assert.Equal(["source.params[1].value", "source.params[2].value"], refusals.Select(refusal => refusal.Field));
    }

    [Trait("QueryParameterRules", "Read")]
    [Fact(DisplayName = "OK lê os valores conferidos na ordem, com o tipo de cada um")]
    public void Read_ShouldReturnTheValuesInOrder()
    {
        //Arrange
        var json = Json("[{\"type\":\"number\",\"value\":\"7\"},{\"type\":\"text\",\"value\":null},{\"type\":\"timestamp\",\"value\":\"2026-10-20 10:30:00\"},{\"type\":\"boolean\",\"value\":\"true\"},{\"type\":\"date\",\"value\":\"2026-10-20\"}]");

        //Act
        var values = QueryParameterRules.Read(json);

        //Assert
        Assert.Equal(
            [new QueryParameter(EQueryParameterType.Number, "7"), new QueryParameter(EQueryParameterType.Text, null), new QueryParameter(EQueryParameterType.Timestamp, "2026-10-20 10:30:00"), new QueryParameter(EQueryParameterType.Boolean, "true"), new QueryParameter(EQueryParameterType.Date, "2026-10-20")],
            values);
        Assert.Equal(1 + 19 + 4 + 10, QueryParameterRules.Bytes(values));
    }

    [Trait("QueryParameterRules", "ToString")]
    [Fact(DisplayName = "OK o valor nunca é impresso (RN-LOG-001)")]
    public void ToString_ShouldNotPrintTheValue()
    {
        //Assert
        Assert.Equal("QueryParameter", new QueryParameter(EQueryParameterType.Text, "'; DROP TABLE pedido; --").ToString());
    }

    [Trait("QueryParameterRules", "EngineRefusal")]
    [Theory(DisplayName = "OK o decimal de até 31 dígitos vai, e o de 32 é recusado com a frase do banco")]
    [InlineData(EDatabaseEngine.Db2, "1234567890123456789012345678901", null)]
    [InlineData(EDatabaseEngine.Db2, "12345678901234567890123456789012", "O número tem 32 dígitos, e o Db2 guarda até 31.")]
    [InlineData(EDatabaseEngine.Db2, "12345678901234567890123456789012345.5", "O número tem 36 dígitos, e o Db2 guarda até 31.")]
    [InlineData(EDatabaseEngine.Db2, "-1234567890123456789012345678.90", null)]
    [InlineData(EDatabaseEngine.Db2, "0.1234567890123456789012345678901", null)]
    [InlineData(EDatabaseEngine.Db2, "0.12345678901234567890123456789012", "O número tem 32 dígitos, e o Db2 guarda até 31.")]
    [InlineData(EDatabaseEngine.Db2, "12.5000", null)]
    [InlineData(EDatabaseEngine.Informix, "12345678901234567890123456789.12", null)]
    [InlineData(EDatabaseEngine.Informix, "123456789012345678901234567890.12", "O número tem 32 dígitos, e o Informix guarda até 31 pelo driver.")]
    [InlineData(EDatabaseEngine.Informix, "1234567890123456789012345678901.12", "O número tem 33 dígitos, e o Informix guarda até 31 pelo driver.")]
    [InlineData(EDatabaseEngine.Informix, "12345678901234567890123456789012", "O número tem 32 dígitos, e o Informix guarda até 31 pelo driver.")]
    [InlineData(EDatabaseEngine.Informix, "9223372036854775808", null)]
    [InlineData(EDatabaseEngine.PostgreSql, "12345678901234567890123456789012345.5", null)]
    public void EngineRefusal_ShouldLimitTheDecimalDigits(EDatabaseEngine engine, string number, string? message)
    {
        //Act
        var refusal = QueryParameterRules.EngineRefusal(engine, [new QueryParameter(EQueryParameterType.Number, number)], "params");

        //Assert
        Assert.Equal(message, refusal?.Message);
        if (message is not null)
            Assert.Equal("params[0].value", refusal!.Value.Field);
    }

    [Trait("QueryParameterRules", "EngineRefusal")]
    [Theory(DisplayName = "OK o número com expoente que o double não guarda é recusado nos bancos da IBM, e o PostgreSQL deixa para o servidor")]
    [InlineData(EDatabaseEngine.Db2, "1.5e300", false)]
    [InlineData(EDatabaseEngine.Db2, "1e400", true)]
    [InlineData(EDatabaseEngine.Db2, "-1e400", true)]
    [InlineData(EDatabaseEngine.Db2, "1e-400", false)]
    [InlineData(EDatabaseEngine.Informix, "1e400", true)]
    [InlineData(EDatabaseEngine.PostgreSql, "1e400", false)]
    public void EngineRefusal_ShouldRefuseTheExponentOutOfTheDouble(EDatabaseEngine engine, string number, bool refused)
    {
        //Act
        var refusal = QueryParameterRules.EngineRefusal(engine, [new QueryParameter(EQueryParameterType.Number, number)], "params");

        //Assert
        Assert.Equal(refused, refusal is not null);
    }

    [Trait("QueryParameterRules", "EngineRefusal")]
    [Theory(DisplayName = "OK o instante com fuso só vale no PostgreSQL")]
    [InlineData(EDatabaseEngine.PostgreSql, "2026-10-20 10:30:00-03", false)]
    [InlineData(EDatabaseEngine.PostgreSql, "2026-10-20 10:30:00Z", false)]
    [InlineData(EDatabaseEngine.Db2, "2026-10-20 10:30:00-03", true)]
    [InlineData(EDatabaseEngine.Db2, "2026-10-20 10:30:00", false)]
    [InlineData(EDatabaseEngine.Informix, "2026-10-20 10:30:00+00", true)]
    [InlineData(EDatabaseEngine.Informix, "2026-10-20 10:30:00.123456", false)]
    public void EngineRefusal_ShouldRefuseTheTimeZoneOutsidePostgreSql(EDatabaseEngine engine, string instant, bool refused)
    {
        //Act
        var refusal = QueryParameterRules.EngineRefusal(engine, [new QueryParameter(EQueryParameterType.Timestamp, instant)], "params");

        //Assert
        Assert.Equal(refused, refusal is not null);
    }

    [Trait("QueryParameterRules", "EngineRefusal")]
    [Fact(DisplayName = "OK aponta a primeira entrada que o banco não guarda, na posição dela, e pula o nulo")]
    public void EngineRefusal_ShouldPointToTheFirstEntryTheDatabaseDoesNotHold()
    {
        //Arrange
        QueryParameter[] values = [new(EQueryParameterType.Number, null), new(EQueryParameterType.Text, "x"), new(EQueryParameterType.Number, "1e999"), new(EQueryParameterType.Number, "1e999")];

        //Act
        var refusal = QueryParameterRules.EngineRefusal(EDatabaseEngine.Db2, values, "source.params");

        //Assert
        Assert.Equal("source.params[2].value", refusal!.Value.Field);
    }

    [Trait("QueryParameterRules", "Refusal")]
    [Fact(DisplayName = "OK sem valores o comando vai como veio; com eles, os marcadores têm de bater, e depois o banco")]
    public void Refusal_ShouldCheckTheMarkersThenTheEngine()
    {
        //Arrange
        QueryParameter[] one = [new(EQueryParameterType.Number, "1")];
        QueryParameter[] huge = [new(EQueryParameterType.Number, "1e999")];

        //Act
        var without = QueryParameterRules.Refusal("SELECT $1", EDatabaseEngine.PostgreSql, [], "params");
        var mismatch = QueryParameterRules.Refusal("SELECT $1, $2", EDatabaseEngine.PostgreSql, one, "params");
        var invalid = QueryParameterRules.Refusal("SELECT ? FROM sysibm.sysdummy1", EDatabaseEngine.Db2, huge, "params");
        var ok = QueryParameterRules.Refusal("SELECT ? FROM sysibm.sysdummy1", EDatabaseEngine.Db2, one, "params");

        //Assert
        Assert.Null(without);
        Assert.Equal((EDatabaseFailure.ParametersMismatch, 2, 1), (mismatch!.Kind, mismatch.Markers, mismatch.Values));
        Assert.Equal((EDatabaseFailure.QueryInvalid, "params[0].value"), (invalid!.Kind, invalid.Field));
        Assert.Null(ok);
    }

    [Trait("QueryParameterRules", "FilterHasMarker")]
    [Theory(DisplayName = "OK o filtro com marcador fora de texto e de comentário é detectado")]
    [InlineData(EDatabaseEngine.PostgreSql, "a = $1", true)]
    [InlineData(EDatabaseEngine.PostgreSql, "a = '$1'", false)]
    [InlineData(EDatabaseEngine.PostgreSql, "a ? 'x'", false)]
    [InlineData(EDatabaseEngine.Db2, "a = ?", true)]
    [InlineData(EDatabaseEngine.Db2, "a = '?' /* ? */", false)]
    [InlineData(EDatabaseEngine.Informix, "a = ? ORDER BY b", true)]
    public void FilterHasMarker_ShouldLookOutsideTextAndComments(EDatabaseEngine engine, string filter, bool expected)
    {
        //Assert
        Assert.Equal(expected, QueryParameterRules.FilterHasMarker(filter, engine));
    }
}
