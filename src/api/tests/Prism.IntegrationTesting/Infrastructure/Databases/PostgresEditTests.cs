using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Configurations;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// A edição de registros no PostgreSQL: quem converte o texto é o banco, como converteria um literal escrito na sessão, e de onde vem
/// cada coluna é ele quem diz, na resposta do comando.
/// </summary>
[TestFixture]
[Category("Databases")]
public sealed class PostgresEditTests : DatabaseEditContractTests
{
    private readonly string _schema = $"edicao_{Guid.NewGuid():N}"[..20];

    protected override EDatabaseEngine Engine => EDatabaseEngine.PostgreSql;

    protected override string Schema => _schema;

    protected override string? GeneratedColumn => "dobro";

    protected override IEnumerable<string> Setup =>
    [
        $"CREATE SCHEMA {_schema}",
        $"CREATE TABLE {_schema}.pedido (id integer PRIMARY KEY, status varchar(20), quantidade integer NOT NULL DEFAULT 0, dobro integer GENERATED ALWAYS AS (quantidade * 2) STORED, anexo bytea)",
        $"CREATE TABLE {_schema}.sem_chave (id integer, status varchar(20))",
        $"CREATE VIEW {_schema}.resumo AS SELECT id, status FROM {_schema}.pedido",
        $"CREATE TABLE {_schema}.unica (id integer, status varchar(20), codigo integer NOT NULL, CONSTRAINT uq_unica UNIQUE (codigo))",
        $"CREATE TABLE {_schema}.tipos (id integer PRIMARY KEY, texto varchar(40), inteiro smallint, grande bigint, decimal numeric(31,5), flutuante double precision, dia date, hora time, momento timestamp, fuso timestamptz, logico boolean, documento jsonb, lista integer[])",
        $"INSERT INTO {_schema}.tipos (id) VALUES (1)",
        $"CREATE TABLE {_schema}.muitas (id integer PRIMARY KEY, status varchar(20))",
        $"INSERT INTO {_schema}.muitas SELECT numero, 'linha ' || numero FROM generate_series(1, 120) AS numero"
    ];

    protected override IEnumerable<string> Teardown => [$"DROP SCHEMA {_schema} CASCADE"];

    protected override IReadOnlyList<(string Column, string Written, string Read)> TypeSamples =>
    [
        ("texto", "it's \\ ok", "it's \\ ok"),
        ("inteiro", "-12", "-12"),
        ("grande", "9007199254740993", "9007199254740993"),
        ("decimal", "1234567890123456789012345.12345", "1234567890123456789012345.12345"),
        ("flutuante", "0.1", "0.1"),
        ("dia", "2026-10-09", "2026-10-09"),
        ("hora", "13:05:07", "13:05:07"),
        ("momento", "2026-10-09 13:05:07.123456", "2026-10-09 13:05:07.123456"),
        ("fuso", "2026-10-09 13:05:07+00", "2026-10-09 13:05:07+00"),
        ("logico", "true", "true"),
        ("documento", "{\"a\": 1}", "{\"a\": 1}"),
        ("lista", "{1,2,3}", "{1,2,3}")
    ];

    protected override Task<ConnectionSettings> StartDatabaseAsync()
        => PostgresSingleton.GetSettingsAsync();

    protected override string WithFirstRows(string select, int rows)
        => $"{select} LIMIT {rows}";

    protected override string Name(string name)
        => name;

    /// <summary>RN-EDIT-010: o `edit-target` não usa a sessão do resultado, e o cursor dela continua aberto para "carregar mais".</summary>
    [Test]
    public async Task EditTarget_KeepsTheCursorOfTheResultOpen()
    {
        var session = await OpenSessionAsync();
        var page = await RecordsAsync(session, "muitas", pageSize: 50);
        Assert.That(page.HasMore, Is.True);

        Value(await Service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None));
        var next = Value(await Service.FetchNextAsync(session, CancellationToken.None));

        Assert.That(next.Rows[0][0], Is.EqualTo("51"));
        Assert.That(next.ResultID, Is.EqualTo(page.ResultID));
    }

    /// <summary>RN-EDIT-010: com a sessão da árvore da mesma conexão o catálogo vai nela; sem ela (inexistente, de outra conexão), numa conexão à parte, sem recusa a mais.</summary>
    [Test]
    public async Task EditTarget_TakesTheCatalogSessionOrASeparateConnection_WithoutAnotherRefusal()
    {
        var connectionID = Guid.NewGuid();
        var session = await OpenSessionAsync(connectionID: connectionID);
        var tree = await OpenSessionAsync(connectionID: connectionID);
        var other = await OpenSessionAsync();

        foreach (var catalogSession in new Guid?[] { tree, other, Guid.NewGuid(), session })
        {
            // O alvo vale para um resultado: cada volta pergunta por um resultado novo, e o catálogo é consultado de novo.
            var page = await RecordsAsync(session, "pedido");
            var target = await Service.GetEditTargetAsync(session, page.ResultID!.Value, catalogSession, CancellationToken.None);
            Assert.That(target.IsSuccess, Is.True, target.IsFailure ? target.Error.Message : null);
        }
    }
}
