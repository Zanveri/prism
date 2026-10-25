using Prism.Infrastructure.Databases.Clients;
using System.Text.Json;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-VAR-032: a contagem dos marcadores de parâmetro pelo leitor do texto da API. Os casos de contagem de `src/test-fixtures/variables/markers.json`
/// (o texto, o banco e o número de marcadores; a tela lê o mesmo arquivo, e os dois leitores têm de contar igual) e o que só a API
/// faz: a conferência contra os valores, a troca do texto e a posição de cada marcador.
/// </summary>
public sealed class ParameterMarkersTests
{
    public static TheoryData<string, string, string, int> Fixture()
    {
        var data = new TheoryData<string, string, string, int>();
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "test-fixtures", "variables", "markers.json")));
        foreach (var item in document.RootElement.GetProperty("cases").EnumerateArray())
            data.Add(item.GetProperty("name").GetString()!, item.GetProperty("engine").GetString()!, item.GetProperty("text").GetString()!, item.GetProperty("count").GetInt32());

        return data;
    }

    public static TheoryData<string, string, int[]> FixtureNumbers()
    {
        var data = new TheoryData<string, string, int[]>();
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "test-fixtures", "variables", "markers.json")));
        foreach (var item in document.RootElement.GetProperty("cases").EnumerateArray())
            if (item.TryGetProperty("numbers", out var numbers))
                data.Add(item.GetProperty("name").GetString()!, item.GetProperty("text").GetString()!, numbers.EnumerateArray().Select(number => number.GetInt32()).ToArray());

        return data;
    }

    private static ESqlDialect DialectOf(string engine)
        => engine switch
        {
            "postgresql" => ESqlDialect.PostgreSql,
            "db2" => ESqlDialect.Db2,
            "informix" => ESqlDialect.Informix,
            _ => throw new ArgumentOutOfRangeException(nameof(engine))
        };

    [Trait("ParameterMarkers", "Count")]
    [Theory(DisplayName = "OK conta os marcadores do fixture")]
    [MemberData(nameof(Fixture))]
    public void Count_ShouldFollowTheFixture(string name, string engine, string text, int expected)
    {
        //Act
        var count = ParameterMarkers.Count(text, DialectOf(engine));

        //Assert
        Assert.True(expected == count, $"{name}: esperado {expected}, contou {count}");
    }

    [Trait("ParameterMarkers", "Count")]
    [Theory(DisplayName = "OK acha o número de cada $n do fixture do PostgreSQL, na ordem do texto")]
    [MemberData(nameof(FixtureNumbers))]
    public void Find_ShouldFollowTheFixtureNumbers(string name, string text, int[] expected)
    {
        //Act
        var numbers = ParameterMarkers.Find(text, ESqlDialect.PostgreSql).Select(marker => marker.Number).ToArray();

        //Assert
        Assert.True(expected.SequenceEqual(numbers), $"{name}: esperado [{string.Join(", ", expected)}], achou [{string.Join(", ", numbers)}]");
    }

    [Trait("ParameterMarkers", "Count")]
    [Fact(DisplayName = "OK o fixture tem casos dos três bancos")]
    public void Fixture_ShouldCoverTheThreeEngines()
    {
        //Act
        var engines = Fixture().Select(row => (string)row[1]!).Distinct().Order().ToArray();

        //Assert
        Assert.Equal(["db2", "informix", "postgresql"], engines);
        Assert.True(Fixture().Count() >= 120);
    }

    [Trait("ParameterMarkers", "Find")]
    [Fact(DisplayName = "OK no PostgreSQL cada ocorrência conta, e o número e a posição de cada uma saem do texto")]
    public void Find_ShouldReturnEveryOccurrenceWithItsNumberAndPosition()
    {
        //Act
        var markers = ParameterMarkers.Find("SELECT $2, $10, $2", ESqlDialect.PostgreSql);

        //Assert
        Assert.Equal([(7, 9, 2, 0), (11, 14, 10, 1), (16, 18, 2, 2)], markers.Select(marker => (marker.Start, marker.End, marker.Number, marker.Index)));
        Assert.Equal([2, 10], ParameterMarkers.DistinctNumbers(markers));
    }

    [Trait("ParameterMarkers", "Find")]
    [Fact(DisplayName = "OK no Db2 e no Informix o marcador é o ? e não tem número")]
    public void Find_ShouldReturnTheQuestionMarksWithoutANumber()
    {
        //Act
        var markers = ParameterMarkers.Find("SELECT ?, '?', ? FROM t", ESqlDialect.Informix);

        //Assert
        Assert.Equal([(7, 8, 0, 0), (15, 16, 0, 1)], markers.Select(marker => (marker.Start, marker.End, marker.Number, marker.Index)));
    }

    [Trait("ParameterMarkers", "Find")]
    [Fact(DisplayName = "OK o número de marcador enorme não estoura")]
    public void Find_ShouldCapAHugeNumber()
    {
        //Act
        var markers = ParameterMarkers.Find("SELECT $99999999999999999999", ESqlDialect.PostgreSql);

        //Assert
        Assert.Equal(1_000_000, Assert.Single(markers).Number);
    }

    public static TheoryData<string, string, int, int?, int?, string?> Mismatches()
        => new()
        {
            { "postgresql", "SELECT $1, $2", 2, null, null, null },
            { "postgresql", "SELECT $1, $1", 1, null, null, null },
            { "postgresql", "SELECT $2, $1", 2, null, null, null },
            { "postgresql", "SELECT $1, $2", 3, 2, 3, "O comando tem 2 marcadores, e vieram 3 valores." },
            { "postgresql", "SELECT $1, $2", 1, 2, 1, "O comando tem 2 marcadores, e veio 1 valor." },
            { "postgresql", "SELECT $1, $1", 2, 1, 2, "O comando tem 1 marcador, e vieram 2 valores." },
            { "postgresql", "SELECT 1", 2, 0, 2, "O comando tem 0 marcadores, e vieram 2 valores." },
            { "postgresql", "SELECT $1, $3", 2, 2, 2, "Os marcadores do comando têm de ir de $1 ao último sem pular nenhum, e falta o $2." },
            { "postgresql", "SELECT $2", 1, 1, 1, "Os marcadores do comando têm de ir de $1 ao último sem pular nenhum, e falta o $1." },
            { "postgresql", "SELECT $0", 1, 1, 1, "O marcador $0 não existe: os do PostgreSQL começam em $1." },
            { "postgresql", "SELECT data ? 'a', $1", 1, null, null, null },
            { "db2", "SELECT ?, ? FROM sysibm.sysdummy1", 2, null, null, null },
            { "db2", "SELECT ? FROM sysibm.sysdummy1", 3, 1, 3, "O comando tem 1 marcador, e vieram 3 valores." },
            { "db2", "SELECT 1 FROM sysibm.sysdummy1", 1, 0, 1, "O comando tem 0 marcadores, e veio 1 valor." },
            { "informix", "SELECT FIRST ? c FROM t WHERE a = ?", 1, 2, 1, "O comando tem 2 marcadores, e veio 1 valor." },
            { "informix", "SELECT '?' FROM systables", 0, null, null, null }
        };

    [Trait("ParameterMarkers", "Mismatch")]
    [Theory(DisplayName = "OK confere os marcadores do texto com o número de valores, cada banco com a regra dele")]
    [MemberData(nameof(Mismatches))]
    public void Mismatch_ShouldCompareTheMarkersWithTheValues(string engine, string sql, int values, int? markers, int? expectedValues, string? message)
    {
        //Act
        var mismatch = ParameterMarkers.Mismatch(sql, DialectOf(engine), values);

        //Assert
        Assert.Equal((markers, expectedValues, message), (mismatch?.Markers, mismatch?.Values, mismatch?.Message));
    }

    [Trait("ParameterMarkers", "Rewrite")]
    [Fact(DisplayName = "OK troca só os marcadores, e deixa o resto do texto como está")]
    public void Rewrite_ShouldReplaceOnlyTheMarkers()
    {
        //Arrange
        const string Sql = "SELECT '$1', $1 /* $2 */, $2";
        var markers = ParameterMarkers.Find(Sql, ESqlDialect.PostgreSql);

        //Act
        var rewritten = ParameterMarkers.Rewrite(Sql, markers, marker => $"${marker.Number + 10}");

        //Assert
        Assert.Equal("SELECT '$1', $11 /* $2 */, $12", rewritten);
        Assert.Same(Sql, ParameterMarkers.Rewrite(Sql, [], _ => "x"));
    }

    [Trait("ParameterMarkers", "IsMarkerAt")]
    [Theory(DisplayName = "OK reconhece o marcador nos pedaços do leitor da edição")]
    [InlineData("postgresql", "ORDER BY a = $2", true)]
    [InlineData("postgresql", "ORDER BY a = '$2'", false)]
    [InlineData("postgresql", "ORDER BY a ? 'x'", false)]
    [InlineData("postgresql", "ORDER BY a = $ 2", false)]
    [InlineData("db2", "ORDER BY a = ?", true)]
    [InlineData("informix", "ORDER BY a = '?'", false)]
    public void IsMarkerAt_ShouldFindTheMarkerInTheTokens(string engine, string sql, bool expected)
    {
        //Arrange
        var dialect = DialectOf(engine);
        var tokens = EditableSql.Lex(sql, dialect).ToList();

        //Act
        var found = Enumerable.Range(0, tokens.Count).Any(index => ParameterMarkers.IsMarkerAt(tokens, index, dialect));

        //Assert
        Assert.Equal(expected, found);
    }
}
