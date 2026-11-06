using System.Text.Json;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Journal.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>RN-AUDIT-005 a 008: testes da classificação de nível de perigo, motivo e ação de comandos SQL, inclusive contra a fixture de ouro.</summary>
public sealed class CommandDangerTests
{
    private static readonly JsonSerializerOptions FixtureJsonOptions = new() { PropertyNameCaseInsensitive = true };

    [Fact(DisplayName = "Classify deve classificar DELETE sem WHERE, ALTER TABLE DROP COLUMN e SELECT com texto 'DELETE' conforme RN-AUDIT-005 a 007")]
    public void Classify_ShouldClassifyCoreExamples_AccordingToSpec()
    {
        Assert.Equal((EJournalLevel.Critical, "DELETE sem WHERE: apaga todas as linhas de pedido.", "DELETE"), CommandDanger.Classify("DELETE FROM pedido", EDatabaseEngine.PostgreSql));
        Assert.Equal((EJournalLevel.Critical, "DROP COLUMN dentro de ALTER TABLE.", "ALTER TABLE"), CommandDanger.Classify("ALTER TABLE pedido DROP COLUMN obs", EDatabaseEngine.PostgreSql));
        Assert.Equal((EJournalLevel.Info, "Leitura.", "SELECT"), CommandDanger.Classify("SELECT * FROM pedido WHERE status = 'DELETE'", EDatabaseEngine.PostgreSql));
    }

    [Theory(DisplayName = "Classify deve concordar com a fixture de ouro levels.json nos três bancos (RN-AUDIT-008)")]
    [MemberData(nameof(GoldenCases))]
    public void MatchesGoldenFixture(string name, string sql, EDatabaseEngine engine, EJournalLevel expectedLevel, string expectedReason, string expectedAction)
    {
        var actual = CommandDanger.Classify(sql, engine);

        Assert.True(expectedLevel == actual.Level, $"{name}: nível esperado {expectedLevel}, veio {actual.Level}.");
        Assert.True(expectedReason == actual.Reason, $"{name}: motivo esperado \"{expectedReason}\", veio \"{actual.Reason}\".");
        Assert.True(expectedAction == actual.Action, $"{name}: ação esperada \"{expectedAction}\", veio \"{actual.Action}\".");
    }

    public static TheoryData<string, string, EDatabaseEngine, EJournalLevel, string, string> GoldenCases()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "test-fixtures", "audit", "levels.json");
        var fixture = JsonSerializer.Deserialize<GoldenFixture>(File.ReadAllText(path), FixtureJsonOptions)
            ?? throw new InvalidOperationException("A fixture de níveis de perigo não pôde ser lida.");

        var data = new TheoryData<string, string, EDatabaseEngine, EJournalLevel, string, string>();
        foreach (var item in fixture.Cases)
            data.Add(item.Name, item.Sql, ParseEngine(item.Engine), ParseLevel(item.Level), item.Reason, item.Action);

        return data;
    }

    private static EDatabaseEngine ParseEngine(string engine)
        => engine switch
        {
            "postgresql" => EDatabaseEngine.PostgreSql,
            "db2" => EDatabaseEngine.Db2,
            "informix" => EDatabaseEngine.Informix,
            _ => throw new InvalidOperationException($"Banco desconhecido na fixture: {engine}.")
        };

    private static EJournalLevel ParseLevel(string level)
        => level switch
        {
            "info" => EJournalLevel.Info,
            "warning" => EJournalLevel.Warning,
            "high" => EJournalLevel.High,
            "critical" => EJournalLevel.Critical,
            _ => throw new InvalidOperationException($"Nível desconhecido na fixture: {level}.")
        };

    private sealed record GoldenFixture(string Rule, IReadOnlyList<GoldenCase> Cases);

    private sealed record GoldenCase(string Name, string Sql, string Engine, string Level, string Reason, string Action, bool ClientSkip = false);
}
