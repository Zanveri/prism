using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Extensions;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// A edição de registros no Db2: a transação do "Salvar" é a do driver (que sai do auto-commit), e quem converte o texto é o Prism,
/// do formato em que ele escreveu a célula. Os nomes escritos sem aspas ficam em maiúsculas no catálogo.
/// </summary>
[TestFixture]
[Category("Databases")]
[Category("Db2")]
public sealed class Db2EditTests : DatabaseEditContractTests
{
    private readonly string _schema = $"EDICAO_{Guid.NewGuid():N}"[..18].ToUpperInvariant();

    protected override EDatabaseEngine Engine => EDatabaseEngine.Db2;

    protected override string Schema => _schema;

    protected override string? GeneratedColumn => "dobro";

    protected override IEnumerable<string> Setup =>
    [
        $"CREATE SCHEMA {_schema}",
        $"CREATE TABLE {_schema}.PEDIDO (ID INTEGER NOT NULL PRIMARY KEY, STATUS VARCHAR(20), QUANTIDADE INTEGER NOT NULL DEFAULT 0, DOBRO INTEGER GENERATED ALWAYS AS (QUANTIDADE * 2), ANEXO VARBINARY(32))",
        $"CREATE TABLE {_schema}.SEM_CHAVE (ID INTEGER, STATUS VARCHAR(20))",
        $"CREATE VIEW {_schema}.RESUMO AS SELECT ID, STATUS FROM {_schema}.PEDIDO",
        $"CREATE TABLE {_schema}.UNICA (ID INTEGER, STATUS VARCHAR(20), CODIGO INTEGER NOT NULL, CONSTRAINT UQ_UNICA UNIQUE (CODIGO))",
        $"CREATE TABLE {_schema}.TIPOS (ID INTEGER NOT NULL PRIMARY KEY, TEXTO VARCHAR(40), INTEIRO SMALLINT, GRANDE BIGINT, VALOR DECIMAL(31, 5), FLUTUANTE_DECIMAL DECFLOAT(34), FLUTUANTE DOUBLE, DIA DATE, HORA TIME, MOMENTO TIMESTAMP, PRECISO TIMESTAMP(12), LOGICO BOOLEAN)",
        $"INSERT INTO {_schema}.TIPOS (ID) VALUES (1)"
    ];

    protected override IEnumerable<string> Teardown =>
    [
        $"DROP VIEW {_schema}.RESUMO",
        .. new[] { "PEDIDO", "SEM_CHAVE", "UNICA", "TIPOS" }.Select(table => $"DROP TABLE {_schema}.{table}"),
        $"DROP SCHEMA {_schema} RESTRICT"
    ];

    protected override IReadOnlyList<(string Column, string Written, string Read)> TypeSamples =>
    [
        ("texto", "it's \\ ok", "it's \\ ok"),
        ("inteiro", "-12", "-12"),
        ("grande", "9007199254740993", "9007199254740993"),
        ("valor", "1234567890123456789012345.12345", "1234567890123456789012345.12345"),
        ("flutuante_decimal", "1.5", "1.5"),
        ("flutuante", "0.1", "0.1"),
        ("dia", "2026-10-09", "2026-10-09"),
        ("hora", "13:05:07", "13:05:07"),
        ("momento", "2026-10-09 13:05:07.123456", "2026-10-09 13:05:07.123456"),
        ("preciso", "2026-10-09 13:05:07.123456789012", "2026-10-09 13:05:07.123456789012"),
        ("logico", "true", "true")
    ];

    protected override Task<ConnectionSettings> StartDatabaseAsync()
        => Db2Singleton.GetSettingsAsync();

    protected override async Task ConfigureAsync(IServiceCollection services)
        => services.UseDriverSource(directory: await IbmDriverSingleton.GetDirectoryAsync());

    protected override string WithFirstRows(string select, int rows)
        => $"{select} FETCH FIRST {rows} ROWS ONLY";

    protected override string? ReadOnlyClause => "FOR READ ONLY";

    protected override string Name(string name)
        => name.ToUpperInvariant();

    /// <summary>No Db2 o qualificador sem esquema é lido no esquema atual da sessão, e não no da tabela do `FROM`: vai com ele.</summary>
    protected override string JoinQualifier(string table)
        => $"{Schema}.{Table(table)}";
    /// <summary>A sonda S-COL-1 no Db2: o `LIMIT … OFFSET` do fim do comando dentro da tabela derivada do `UPDATE` (a sonda de antes só o provou na contagem).</summary>
    [Test]
    public async Task WholeColumn_WithLimitAndOffset_IsSavedByTheKey()
    {
        var session = await OpenSessionAsync();
        var page = await EditableAsync(session, $"SELECT * FROM {Quoted("pedido")} ORDER BY 1 LIMIT 2 OFFSET 1");
        EditChange change = new(EEditKind.UpdateAll, 0, [], [new EditValue(Column(page, "quantidade"), "7")]);

        var counted = Value(await Service.CountWholeColumnAsync(session, page.ResultID!.Value, [change], CancellationToken.None));
        var saved = await Service.ApplyEditsAsync(session, page.ResultID.Value, [change with { Rows = counted }], CancellationToken.None);

        Assert.That(counted, Is.EqualTo(2));
        Assert.That(saved.IsSuccess, Is.True, saved.IsFailure ? saved.Error.Message : null);
        Assert.That(await RowsAsync("pedido", "quantidade"), Is.EqualTo(new[] { ("1", (string?)"1"), ("2", "7"), ("3", "7") }));
    }
}
