using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Extensions;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// RN-EXPORT-017: a leitura da exportação contra o PostgreSQL de verdade. A conexão à parte prepara a forma do texto (`DateStyle`, `extra_float_digits`,
/// `bytea_output`) e abre a transação `REPEATABLE READ READ ONLY`, em que a contagem e a leitura veem o mesmo instante; a contagem recusada não estraga a
/// transação; cada valor vem inteiro, o texto grande lido em pedaços, e o teto do valor é contado em bytes de UTF-8. Os testes só leem a carga; a tabela
/// que um deles cria, ele mesmo apaga.
/// </summary>
[TestFixture]
[Category("Databases")]
public sealed class PostgresExportTests
{
    private ServiceProvider _provider = null!;
    private IDatabaseClient _client = null!;
    private ConnectionSettings _settings = null!;

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        _settings = await PostgresSingleton.GetSettingsAsync();

        // A pasta de dados é do cofre, que estes testes não abrem: nada é gravado nela.
        _provider = new ServiceCollection().AddInfrastructure(Path.Combine(Path.GetTempPath(), "prism-tests-sem-cofre")).BuildServiceProvider();
        _client = _provider.GetServices<IDatabaseClient>().Single(client => client.Engine == EDatabaseEngine.PostgreSql);
    }

    [OneTimeTearDown]
    public async Task StopAsync()
        => await _provider.DisposeAsync();

    private async Task<IDatabaseConnection> OpenAsync()
    {
        var opened = await _client.OpenAsync(_settings, CancellationToken.None);
        Assert.That(opened.IsSuccess, Is.True, opened.IsFailure ? opened.Error.Message : null);

        return opened.Value;
    }

    /// <summary>Abre a conexão como a exportação a usa: a sessão preparada e a transação aberta.</summary>
    private async Task<IDatabaseConnection> BeginAsync()
    {
        var connection = await OpenAsync();
        var begun = await connection.BeginExportAsync(CancellationToken.None);
        Assert.That(begun.IsSuccess, Is.True, begun.IsFailure ? begun.Error.Message : null);

        return connection;
    }

    private static async Task<IReadOnlyList<QueryColumn>> StartReadAsync(IDatabaseConnection connection, string sql)
    {
        var started = await connection.StartExportReadAsync(sql, CancellationToken.None);
        Assert.That(started.IsSuccess, Is.True, started.IsFailure ? started.Error.Message : null);

        return started.Value;
    }

    private static ExportReadPlan PlanFor(int columns)
        => new([.. Enumerable.Range(0, columns)], new HashSet<int>());

    /// <summary>Lê o resultado até o fim, lote a lote, e devolve as linhas e quantos lotes foram.</summary>
    private static async Task<(List<IReadOnlyList<ExportCell>> Rows, int Batches)> ReadAllAsync(IDatabaseConnection connection, ExportReadPlan plan)
    {
        var rows = new List<IReadOnlyList<ExportCell>>();
        var batches = 0;

        while (true)
        {
            var batch = await connection.ReadExportRowsAsync(plan, CancellationToken.None);
            Assert.That(batch.IsSuccess, Is.True, batch.IsFailure ? batch.Error.Message : null);
            Assert.That(batch.Value.Oversize, Is.Null);

            batches++;
            rows.AddRange(batch.Value.Rows);
            if (batch.Value.Finished)
                return (rows, batches);
        }
    }

    private static async Task ExecuteAsync(IDatabaseConnection connection, string sql)
    {
        var executed = await connection.ExecuteAsync(sql, CancellationToken.None);
        Assert.That(executed.IsSuccess, Is.True, executed.IsFailure ? executed.Error.Message : null);
    }

    [Test]
    public async Task Begin_PreparesTheTextForm_AndOpensARepeatableReadReadOnlyTransaction()
    {
        await using var connection = await BeginAsync();
        await StartReadAsync(connection, "SELECT current_setting('transaction_isolation') AS isolamento, current_setting('transaction_read_only') AS leitura, current_setting('DateStyle') AS datas, current_setting('extra_float_digits') AS digitos, current_setting('bytea_output') AS binario, current_setting('lock_timeout') AS trava");

        var (rows, _) = await ReadAllAsync(connection, PlanFor(6));

        Assert.That(rows.Single().Select(cell => cell.Text), Is.EqualTo(new[] { "repeatable read", "on", "ISO, YMD", "3", "hex", "5s" }));
    }

    /// <summary>RN-EXPORT-017: o texto como o servidor o escreve com a forma da exportação; o lógico em `true`/`false` e o binário em bytes.</summary>
    [Test]
    public async Task Read_WritesEachTypeInTheExportForm()
    {
        await using var connection = await BeginAsync();
        await StartReadAsync(connection, "SELECT TRUE AS ativo, FALSE AS inativo, '\\x00ff10'::BYTEA AS dado, DATE '2026-10-16' AS dia, TIMESTAMP '2026-10-16 14:30:05.5' AS momento, 0.1::FLOAT8 AS fracao, 12.50::NUMERIC(6, 2) AS valor, NULL::TEXT AS nada");

        var (rows, _) = await ReadAllAsync(connection, PlanFor(8));

        var row = rows.Single();
        Assert.That(row.Select(cell => cell.Text), Is.EqualTo(new[] { "true", "false", null, "2026-10-16", "2026-10-16 14:30:05.5", "0.1", "12.50", null }));
        Assert.That(row[2].Bytes, Is.EqualTo(new byte[] { 0x00, 0xFF, 0x10 }));
        Assert.That(row[7].IsNull, Is.True);
    }

    /// <summary>O texto maior que um pedaço (64 Ki caracteres) vem inteiro, de vários pedaços.</summary>
    [Test]
    public async Task Read_LargeText_ComesWhole()
    {
        await using var connection = await BeginAsync();
        await StartReadAsync(connection, "SELECT repeat('é', 200000) || 'fim' AS texto, decode(repeat('ab', 150000), 'hex') AS dado");

        var (rows, _) = await ReadAllAsync(connection, PlanFor(2));

        var row = rows.Single();
        Assert.That(row[0].Text, Has.Length.EqualTo(200003));
        Assert.That(row[0].Text, Does.StartWith("éé").And.EndWith("éfim"));
        Assert.That(row[1].Bytes, Has.Length.EqualTo(150000).And.All.EqualTo(0xAB));
    }

    /// <summary>RN-EXPORT-017: o teto do valor é em bytes de UTF-8: 200.000 "é" são 400.000 bytes, acima de um teto de 300.000.</summary>
    [Test]
    public async Task Read_ValueOverTheLimit_StopsAtIt()
    {
        await using var connection = await BeginAsync();
        await StartReadAsync(connection, "SELECT numero, CASE WHEN numero = 2 THEN repeat('é', 200000) ELSE 'curto' END AS texto FROM generate_series(1, 3) AS numero");

        var batch = await connection.ReadExportRowsAsync(PlanFor(2) with { MaxValueBytes = 300000 }, CancellationToken.None);

        Assert.That(batch.IsSuccess, Is.True, batch.IsFailure ? batch.Error.Message : null);
        Assert.That(batch.Value.Oversize, Is.EqualTo(new ExportOversize(1, WholeRow: false)));
        Assert.That(batch.Value.Rows.Select(row => row[0].Text), Is.EqualTo(new[] { "1" }));
    }

    [Test]
    public async Task Read_WholeTable_InBatches_WithTheCount()
    {
        await using var connection = await BeginAsync();

        var total = await connection.CountExportAsync("SELECT numero, valor, criado_em, observacao FROM loja.pedido", CancellationToken.None);
        await StartReadAsync(connection, "SELECT numero, valor, criado_em, observacao FROM loja.pedido ORDER BY numero");
        var (rows, batches) = await ReadAllAsync(connection, PlanFor(4) with { MaxRows = 400 });

        Assert.That(total.Value, Is.EqualTo(1000));
        Assert.That(batches, Is.EqualTo(3));
        Assert.That(rows, Has.Count.EqualTo(1000));
        Assert.That(rows[0].Select(cell => cell.Text), Is.EqualTo(new[] { "1001", "1.50", "2026-01-01 00:01:00", "Pedido 1" }));
        Assert.That(rows[6][3].IsNull, Is.True);
    }

    /// <summary>
    /// A contagem recusada vem sem total, e a leitura segue na mesma transação: o ponto de salvamento desfez só a contagem. A recusa é a da tabela que não
    /// existe (42P01), e não a de uma conta como `1 / 0`: o PostgreSQL não calcula a coluna que o `COUNT(*)` de fora não usa, e essa contagem daria 1.
    /// </summary>
    [Test]
    public async Task Count_Refused_ComesWithoutTotal_AndTheReadGoesOn()
    {
        await using var connection = await BeginAsync();

        var total = await connection.CountExportAsync("SELECT x FROM loja.nao_existe", CancellationToken.None);
        await StartReadAsync(connection, "SELECT numero FROM loja.pedido ORDER BY numero LIMIT 3");
        var (rows, _) = await ReadAllAsync(connection, PlanFor(1));

        Assert.That(total.IsSuccess, Is.True, total.IsFailure ? total.Error.Message : null);
        Assert.That(total.Value, Is.Null);
        Assert.That(rows.Select(row => row[0].Text), Is.EqualTo(new[] { "1001", "1002", "1003" }));
    }

    /// <summary>RN-EXPORT-017: a contagem e a leitura veem o mesmo instante: a linha gravada por outra conexão entre as duas não entra no arquivo.</summary>
    [Test]
    public async Task CountAndRead_SeeTheSameInstant()
    {
        var table = $"loja.exporta_{Guid.NewGuid():N}";
        await using var writer = await OpenAsync();
        await ExecuteAsync(writer, $"CREATE TABLE {table} (id INTEGER NOT NULL)");

        try
        {
            await ExecuteAsync(writer, $"INSERT INTO {table} (id) VALUES (1), (2)");
            await using var connection = await BeginAsync();

            var total = await connection.CountExportAsync($"SELECT id FROM {table}", CancellationToken.None);
            await ExecuteAsync(writer, $"INSERT INTO {table} (id) VALUES (3)");
            await StartReadAsync(connection, $"SELECT id FROM {table} ORDER BY id");
            var (rows, _) = await ReadAllAsync(connection, PlanFor(1));

            Assert.That(total.Value, Is.EqualTo(2));
            Assert.That(rows.Select(row => row[0].Text), Is.EqualTo(new[] { "1", "2" }));
        }
        finally
        {
            await ExecuteAsync(writer, $"DROP TABLE {table}");
        }
    }

    /// <summary>A transação é só de leitura: o comando que grava, se passasse pela regra do texto, o banco recusaria com o erro dele.</summary>
    [Test]
    public async Task Read_Write_IsRefusedByTheDatabase()
    {
        await using var connection = await BeginAsync();

        var started = await connection.StartExportReadAsync($"CREATE TABLE loja.nao_cria_{Guid.NewGuid():N} (id INTEGER)", CancellationToken.None);

        Assert.That(started.IsFailure, Is.True);
        Assert.That(started.Error.SqlState, Is.EqualTo("25006"));
    }
}
