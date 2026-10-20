using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Configurations;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// O carregador no PostgreSQL: um `INSERT` de uma linha por comando, em lotes de até 500 comandos numa ida só (`NpgsqlBatch`), com os valores em
/// parâmetros sem tipo, que o banco converte, e o binário em `bytea`. A linha recusada é a do comando do lote que falhou.
/// </summary>
[TestFixture]
[Category("Databases")]
public sealed class PostgresLoadTests : DatabaseLoadContractTests
{
    private readonly string _schema = $"carga_{Guid.NewGuid():N}"[..20];

    protected override EDatabaseEngine Engine => EDatabaseEngine.PostgreSql;

    protected override string Schema => _schema;

    protected override string Table => "carga";

    protected override IEnumerable<string> Setup =>
    [
        $"CREATE SCHEMA {_schema}",
        $"CREATE TABLE {_schema}.carga (id integer PRIMARY KEY, nome varchar(40), texto text, anexo bytea)"
    ];

    protected override IEnumerable<string> Teardown => [$"DROP SCHEMA {_schema} CASCADE"];

    protected override Task<ConnectionSettings> StartDatabaseAsync()
        => PostgresSingleton.GetSettingsAsync();

    protected override string Name(string name)
        => name;

    /// <summary>RN-IMPORT-016: a recusa do nulo diz a coluna (o campo `column` do erro do PostgreSQL), e a linha é a do comando do lote.</summary>
    [Test]
    public async Task Refusal_OfANull_SaysTheColumn()
    {
        await RunAsync(Settings, $"ALTER TABLE {_schema}.carga ALTER COLUMN nome SET NOT NULL");
        try
        {
            var (connection, target, columns) = await BeginAsync(Settings);
            await using (connection)
            {
                var rows = Enumerable.Range(1, 3).Select(id => Row(columns, id)).ToList();
                rows[2] = [rows[2][0], new EditParameter(null), rows[2][2], rows[2][3]];

                Success(await connection.BeginLoadTransactionAsync(CancellationToken.None));
                var refused = await InsertAsync(connection, target, rows);

                Assert.That(refused, Is.Not.Null);
                Assert.That((refused!.Change, refused.SqlState, refused.ColumnName), Is.EqualTo(((int?)2, (string?)"23502", (string?)"nome")));
            }
        }
        finally
        {
            await RunAsync(Settings, $"ALTER TABLE {_schema}.carga ALTER COLUMN nome DROP NOT NULL");
        }
    }
}
