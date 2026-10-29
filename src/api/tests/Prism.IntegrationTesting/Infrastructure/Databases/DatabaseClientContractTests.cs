using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.TestingCore.Extensions;
using System.Diagnostics;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// O contrato que os três bancos cumprem (`IDatabaseClient` e `IDatabaseConnection`), contra o banco de verdade e pelo client que o
/// `AddInfrastructure` registra. A classe de cada banco informa o contêiner já com a carga (esquema `loja`: `cliente`, `pedido` com
/// 1.000 linhas, a visão `pedido_resumo`, a rotina `dobro` e a tabela de nome com aspas) e o SQL que só existe naquele banco.
/// Os testes só leem a carga; o que um deles cria, ele mesmo apaga.
/// </summary>
public abstract partial class DatabaseClientContractTests
{
    protected const string PedidoQuery = "SELECT numero, valor, criado_em, observacao FROM loja.pedido ORDER BY numero";

    private ServiceProvider _provider = null!;

    protected abstract EDatabaseEngine Engine { get; }

    /// <summary>O trecho da mensagem do banco para usuário ou senha errados.</summary>
    protected abstract string WrongPasswordMessage { get; }

    protected abstract string SyntaxErrorSqlState { get; }

    /// <summary>Uma consulta que leva 30 segundos no banco.</summary>
    protected abstract string SlowQuery { get; }

    /// <summary>Os números de `loja.pedido`, em ordem, por uma consulta de leitura que soma um ao contador do banco a cada execução.</summary>
    protected abstract string CountedQuery { get; }

    /// <summary>Quantas vezes a <see cref="CountedQuery"/> já foi executada nesta conexão.</summary>
    protected abstract string ExecutionCountQuery { get; }

    /// <summary>O que cria o contador da <see cref="CountedQuery"/> na conexão do teste, quando ele não está na carga.</summary>
    protected virtual string? ExecutionCounterSetup => null;

    /// <summary>
    /// Uma leitura de `loja.pedido` que devolve 20.000 linhas largas: o resultado não cabe nos buffers da rede (são alguns megabytes), e
    /// com a primeira página lida o banco ainda está no meio do comando.
    /// </summary>
    protected abstract string LargeReadQuery { get; }

    /// <summary>
    /// Quanto ficou pendente no banco por conta de outras conexões: transações abertas mais travas em `loja.pedido`. Zero é "nada
    /// pendente".
    /// </summary>
    protected abstract string PendingWorkQuery { get; }

    /// <summary>O comando do banco que grava `versao = 1` em todas as linhas da tabela e devolve o `numero` de cada linha gravada.</summary>
    protected abstract string WriteReturningRows(string table);

    /// <summary>
    /// A primeira linha da <see cref="PedidoQuery"/> (número 1001, valor 1,50, criado em 2026-01-01 00:01:00, observação "Pedido 1"), no
    /// texto que este banco entrega: o PostgreSQL escreve a data e a hora ele mesmo, e os outros passam pelo formatador do Prism.
    /// </summary>
    protected abstract string?[] FirstPedidoRow { get; }

    /// <summary>
    /// Com a primeira página de uma leitura lida e o cursor aberto, o banco mostra algo pendente por conta dela (uma transação, uma
    /// trava)? No PostgreSQL e no Db2, sim. No Informix a leitura fica em auto-commit, sem transação nem trava, e não há o que medir:
    /// o que continua valendo nele é o depois, em que nada pode sobrar.
    /// </summary>
    protected virtual bool OpenReadCursorHoldsWork => true;

    /// <summary>
    /// RN-SQL-001: como este banco responde ao envio com mais de um comando. O PostgreSQL o recusa ele mesmo, com o erro dele; no
    /// Db2 e no Informix quem recusa é a API, antes de ir ao banco.
    /// </summary>
    protected virtual EDatabaseFailure SeveralStatementsRefusal => EDatabaseFailure.ExecutionFailed;

    protected IDatabaseClient Client { get; private set; } = null!;

    protected ConnectionSettings Settings { get; private set; } = null!;

    /// <summary>
    /// O nome de um objeto como este banco o guarda quando é escrito sem aspas, que é como os testes daqui o escrevem no SQL: o
    /// PostgreSQL e o Informix o guardam em minúsculas, e o Db2, em maiúsculas. O que a carga cria entre aspas (`O'Brien "x"`,
    /// `nome completo`) fica como foi escrito nos três, e não passa por aqui.
    /// </summary>
    protected virtual string Name(string name)
        => name;

    private string[] Names(params string[] names)
        => [.. names.Select(Name)];

    /// <summary>Sobe (ou reaproveita) o contêiner do banco, já com a carga, e diz como conectar nele.</summary>
    protected abstract Task<ConnectionSettings> StartDatabaseAsync();

    /// <summary>O que o banco precisa além do `AddInfrastructure`. O Db2 e o Informix apontam a pasta de drivers para a do driver instalado.</summary>
    protected virtual Task ConfigureAsync(IServiceCollection services)
        => Task.CompletedTask;

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        Settings = await StartDatabaseAsync();

        // A pasta de dados é do cofre, que estes testes não abrem: nada é gravado nela.
        var services = new ServiceCollection().AddInfrastructure(Path.Combine(Path.GetTempPath(), "prism-tests-sem-cofre"));
        await ConfigureAsync(services);
        _provider = services.BuildServiceProvider();
        Client = _provider.GetServices<IDatabaseClient>().Single(client => client.Engine == Engine);
    }

    [OneTimeTearDown]
    public async Task StopAsync()
        => await _provider.DisposeAsync();

    protected async Task<IDatabaseConnection> OpenAsync()
    {
        var opened = await Client.OpenAsync(Settings, CancellationToken.None);
        Assert.That(opened.IsSuccess, Is.True, opened.IsFailure ? opened.Error.Message : null);

        return opened.Value;
    }

    protected static async Task<QueryPage> ExecutePageAsync(IDatabaseConnection connection, string sql)
    {
        var outcome = await connection.ExecuteAsync(sql, CancellationToken.None);
        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);
        Assert.That(outcome.Value.Page, Is.Not.Null);

        return outcome.Value.Page!;
    }

    private static async Task<QueryPage> FetchPageAsync(IDatabaseConnection connection)
    {
        var page = await connection.FetchNextAsync(CancellationToken.None);
        Assert.That(page.IsSuccess, Is.True, page.IsFailure ? page.Error.Message : null);

        return page.Value;
    }

    /// <summary>Um valor lido por outra conexão, aberta e fechada aqui: é o que qualquer outra pessoa veria no banco neste instante.</summary>
    protected async Task<long> ReadFromAnotherConnectionAsync(string sql)
    {
        await using var connection = await OpenAsync();
        var page = await ExecutePageAsync(connection, sql);

        return long.Parse(page.Rows[0][0]!);
    }

    /// <summary>Uma tabela só do teste, com as 1.000 linhas de `loja.pedido` e `versao` zero. Quem cria apaga, com <see cref="DropAsync"/>.</summary>
    protected async Task<string> CreateWriteTableAsync()
    {
        var table = $"loja.escrita_{Guid.NewGuid():N}";
        await using var connection = await OpenAsync();
        var created = await connection.ExecuteAsync($"CREATE TABLE {table} (numero INTEGER NOT NULL, versao INTEGER NOT NULL)", CancellationToken.None);
        var filled = await connection.ExecuteAsync($"INSERT INTO {table} (numero, versao) SELECT numero, 0 FROM loja.pedido", CancellationToken.None);
        Assert.That(created.IsSuccess && filled.IsSuccess, Is.True);

        return table;
    }

    protected async Task DropAsync(string table)
    {
        await using var connection = await OpenAsync();
        await connection.ExecuteAsync($"DROP TABLE {table}", CancellationToken.None);
    }

    private static string?[] FirstColumn(QueryPage page)
        => [.. page.Rows.Select(row => row[0])];

    private static string[] Numbers(int first, int count)
        => [.. Enumerable.Range(first, count).Select(number => number.ToString())];

    [Test]
    public async Task Open_WithWrongPassword_ReturnsConnectionFailedWithTheDatabaseMessage()
    {
        var opened = await Client.OpenAsync(Settings with { Password = $"errada-{Guid.NewGuid():N}" }, CancellationToken.None);

        Assert.That(opened.IsFailure, Is.True);
        Assert.That(opened.Error.Kind, Is.EqualTo(EDatabaseFailure.ConnectionFailed));
        Assert.That(opened.Error.Message, Does.Contain(WrongPasswordMessage));
    }

    [Test]
    public async Task Open_ReportsTheServerVersion()
    {
        await using var connection = await OpenAsync();

        Assert.That(connection.ServerVersion, Is.Not.Empty);
        Assert.That(connection.IsOpen, Is.True);
    }

    [Test]
    public async Task Ping_Succeeds()
    {
        await using var connection = await OpenAsync();

        var ping = await connection.PingAsync(CancellationToken.None);

        Assert.That(ping.IsSuccess, Is.True);
    }

    /// <summary>RN-ARVORE-004.</summary>
    [Test]
    public async Task GetSchemas_ContainsTheSeedSchema_AndSystemSchemasComeLast()
    {
        await using var connection = await OpenAsync();

        var schemas = await connection.GetSchemasAsync(CancellationToken.None);

        Assert.That(schemas.IsSuccess, Is.True);
        Assert.That(schemas.Value.Select(schema => (schema.Name, schema.IsSystem)), Has.Member((Name("loja"), false)));
        Assert.That(schemas.Value.Any(schema => schema.IsSystem), Is.True);
        Assert.That(schemas.Value.SkipWhile(schema => !schema.IsSystem).All(schema => schema.IsSystem), Is.True);
    }

    [Test]
    public async Task GetObjects_Tables_Views_Routines()
    {
        await using var connection = await OpenAsync();

        var tables = await connection.GetObjectsAsync(Name("loja"), "tables", CancellationToken.None);
        var views = await connection.GetObjectsAsync(Name("loja"), "views", CancellationToken.None);
        var routines = await connection.GetObjectsAsync(Name("loja"), "routines", CancellationToken.None);

        Assert.That(tables.IsSuccess && views.IsSuccess && routines.IsSuccess, Is.True);
        Assert.That(tables.Value.Select(table => (table.Name, table.Kind)), Is.SupersetOf(new[] { (Name("cliente"), "table"), (Name("pedido"), "table"), ("O'Brien \"x\"", "table") }));
        Assert.That(tables.Value.Select(table => table.Kind), Is.All.EqualTo("table"));
        Assert.That(views.Value.Select(view => (view.Name, view.Kind)), Is.EqualTo(new[] { (Name("pedido_resumo"), "view") }));
        Assert.That(routines.Value, Is.EqualTo(new[] { new DatabaseObjectInfo(Name("dobro"), "function", null, null) }));
    }

    [Test]
    public async Task GetObjects_OfUnknownSchema_ReturnsEmpty()
    {
        await using var connection = await OpenAsync();

        var tables = await connection.GetObjectsAsync("nao_existe", "tables", CancellationToken.None);

        Assert.That(tables.IsSuccess, Is.True);
        Assert.That(tables.Value, Is.Empty);
    }

    /// <summary>RN-ARVORE-003.</summary>
    [Test]
    public async Task GetColumns_MarksThePrimaryKey_AndKeepsColumnOrder()
    {
        await using var connection = await OpenAsync();

        var columns = await connection.GetColumnsAsync(Name("loja"), Name("pedido"), CancellationToken.None);

        Assert.That(columns.IsSuccess, Is.True);
        Assert.That(columns.Value.Select(column => column.Name), Is.EqualTo(Names("id", "numero", "cliente_id", "valor", "criado_em", "observacao")));
        Assert.That(columns.Value.Select(column => column.IsPrimaryKey), Is.EqualTo(new[] { true, false, false, false, false, false }));
        Assert.That(columns.Value.Select(column => column.IsNullable), Is.EqualTo(new[] { false, false, false, false, false, true }));
        Assert.That(columns.Value.Select(column => column.Position), Is.Ordered.Ascending);
        Assert.That(columns.Value.Select(column => column.Type), Has.None.Empty);
    }

    [Test]
    public async Task GetIndexes_ReportsUniqueAndColumns()
    {
        await using var connection = await OpenAsync();

        var indexes = await connection.GetIndexesAsync(Name("loja"), Name("pedido"), CancellationToken.None);

        Assert.That(indexes.IsSuccess, Is.True);

        var unique = indexes.Value.Single(index => index.Name == Name("uk_pedido_numero"));
        var composite = indexes.Value.Single(index => index.Name == Name("ix_pedido_cliente_data"));
        Assert.That(unique.IsUnique, Is.True);
        Assert.That(unique.Columns, Is.EqualTo(Names("numero")));
        Assert.That(composite.IsUnique, Is.False);
        Assert.That(composite.Columns, Is.EqualTo(Names("cliente_id", "criado_em")));
    }

    [Test]
    public async Task GetForeignKeys_ReportsColumnsAndReferencedTable()
    {
        await using var connection = await OpenAsync();

        var foreignKeys = await connection.GetForeignKeysAsync(Name("loja"), Name("pedido"), CancellationToken.None);

        Assert.That(foreignKeys.IsSuccess, Is.True);

        var foreignKey = foreignKeys.Value.Single();
        Assert.That(foreignKey.Name, Is.EqualTo(Name("fk_pedido_cliente")));
        Assert.That(foreignKey.Columns, Is.EqualTo(Names("cliente_id")));
        Assert.That(foreignKey.ReferencedSchema, Is.EqualTo(Name("loja")));
        Assert.That(foreignKey.ReferencedTable, Is.EqualTo(Name("cliente")));
        Assert.That(foreignKey.ReferencedColumns, Is.EqualTo(Names("id")));
    }

    /// <summary>O nome da tabela vai como parâmetro até a consulta de catálogo: aspa no nome não quebra o SQL nem vira SQL.</summary>
    [Test]
    public async Task GetColumns_OfTableWithQuoteInName_DoesNotBreak()
    {
        await using var connection = await OpenAsync();

        var columns = await connection.GetColumnsAsync(Name("loja"), "O'Brien \"x\"", CancellationToken.None);
        var indexes = await connection.GetIndexesAsync(Name("loja"), "O'Brien \"x\"", CancellationToken.None);
        var foreignKeys = await connection.GetForeignKeysAsync(Name("loja"), "O'Brien \"x\"", CancellationToken.None);

        Assert.That(columns.IsSuccess && indexes.IsSuccess && foreignKeys.IsSuccess, Is.True);
        Assert.That(columns.Value.Select(column => column.Name), Is.EqualTo(new[] { Name("id"), "nome completo" }));
        Assert.That(indexes.Value.Select(index => index.Name), Is.EqualTo(new[] { "pk_O'Brien" }));
        Assert.That(foreignKeys.Value, Is.Empty);
    }

    /// <summary>RN-SQL-004.</summary>
    [Test]
    public async Task Execute_SelectThousandRows_ReturnsFirst200_WithHasMore()
    {
        await using var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync(PedidoQuery, CancellationToken.None);

        Assert.That(outcome.IsSuccess, Is.True);
        Assert.That(outcome.Value.RowsAffected, Is.Null);

        var page = outcome.Value.Page!;
        Assert.That(page.Columns.Select(column => column.Name), Is.EqualTo(Names("numero", "valor", "criado_em", "observacao")));
        Assert.That(page.Columns.Select(column => column.Kind), Is.EqualTo(new[] { "number", "number", "datetime", "text" }));
        Assert.That(page.Columns.Select(column => column.Type), Has.None.Empty);
        Assert.That(FirstColumn(page), Is.EqualTo(Numbers(1001, 200)));
        Assert.That(page.Rows[0], Is.EqualTo(FirstPedidoRow));
        Assert.That(page.Rows[6][3], Is.Null);
        Assert.That(page.HasMore, Is.True);
        Assert.That(page.TotalRows, Is.Null);
        Assert.That(page.TruncatedCells, Is.Empty);
    }

    /// <summary>RN-SQL-016: a primeira página tem as linhas pedidas. Com as 1.000 de `loja.pedido`, a página de 1.000 já é o fim, e o cursor fecha.</summary>
    [TestCase(50, true)]
    [TestCase(200, true)]
    [TestCase(1000, false)]
    public async Task Execute_WithPageSize_ReturnsThatManyRows(int pageSize, bool hasMore)
    {
        await using var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync(PedidoQuery, pageSize, CancellationToken.None);
        var next = await connection.FetchNextAsync(CancellationToken.None);

        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);
        Assert.That(FirstColumn(outcome.Value.Page!), Is.EqualTo(Numbers(1001, pageSize)));
        Assert.That(outcome.Value.Page!.HasMore, Is.EqualTo(hasMore));
        Assert.That(outcome.Value.Page.TotalRows, Is.Null);
        Assert.That(next.IsSuccess, Is.EqualTo(hasMore));
    }

    /// <summary>
    /// RN-SQL-016: o "carregar mais" lê no tamanho com que o cursor abriu, sem receber tamanho. 2.300 linhas em páginas de 500: a
    /// primeira, três "carregar mais" de 500 e o último com as 300 que sobram, e então o cursor fecha.
    /// </summary>
    [Test]
    public async Task FetchNext_ReadsInThePageSizeOfTheCursor()
    {
        // 1.000 linhas com cada um dos clientes 1 e 2, e 300 com o 3: a mesma consulta nos três bancos.
        const string query = "SELECT pedido.numero FROM loja.pedido pedido, loja.cliente cliente WHERE cliente.id <= 3 AND (cliente.id < 3 OR pedido.numero <= 1300) ORDER BY cliente.id, pedido.numero";
        await using var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync(query, 500, CancellationToken.None);
        var pages = new List<QueryPage> { outcome.Value.Page! };
        while (pages[^1].HasMore)
            pages.Add(await FetchPageAsync(connection));

        var afterTheEnd = await connection.FetchNextAsync(CancellationToken.None);

        Assert.That(pages.Select(page => page.Rows.Count), Is.EqualTo(new[] { 500, 500, 500, 500, 300 }));
        Assert.That(pages.Select(page => page.HasMore), Is.EqualTo(new[] { true, true, true, true, false }));
        Assert.That(pages.SelectMany(FirstColumn), Is.EqualTo(Numbers(1001, 1000).Concat(Numbers(1001, 1000)).Concat(Numbers(1001, 300))));
        Assert.That(afterTheEnd.Error.Kind, Is.EqualTo(EDatabaseFailure.NoOpenCursor));
    }

    /// <summary>RN-SQL-016 e 013: o comando que grava e devolve linhas roda até o fim, e o tamanho pedido é o das linhas da resposta; o total é o do comando.</summary>
    [Test]
    public async Task Execute_WriteReturningRows_WithPageSize_ReturnsThatManyRowsAndTheTotal()
    {
        var table = await CreateWriteTableAsync();
        var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync(WriteReturningRows(table), 50, CancellationToken.None);
        await connection.DisposeAsync();
        var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        await DropAsync(table);

        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);
        Assert.That(outcome.Value.Page!.Rows, Has.Count.EqualTo(50));
        Assert.That(outcome.Value.Page.HasMore, Is.False);
        Assert.That(outcome.Value.Page.TotalRows, Is.EqualTo(1000));
        Assert.That(written, Is.EqualTo(1000));
    }

    /// <summary>
    /// RN-SQL-005. O contador é lido na mesma conexão, antes de executar e depois das duas páginas: uma leitura no meio seria um
    /// comando novo e fecharia o cursor que o teste observa. Se "carregar mais" executasse de novo, o contador subiria dois.
    /// </summary>
    [Test]
    public async Task FetchNext_ReturnsTheFollowing200_WithoutRunningAgain()
    {
        await using var connection = await OpenAsync();
        if (ExecutionCounterSetup is not null)
            Assert.That((await connection.ExecuteAsync(ExecutionCounterSetup, CancellationToken.None)).IsSuccess, Is.True);

        var before = long.Parse((await ExecutePageAsync(connection, ExecutionCountQuery)).Rows[0][0]!);
        var first = await ExecutePageAsync(connection, CountedQuery);
        var second = await FetchPageAsync(connection);
        var after = long.Parse((await ExecutePageAsync(connection, ExecutionCountQuery)).Rows[0][0]!);

        Assert.That(FirstColumn(first), Is.EqualTo(Numbers(1001, 200)));
        Assert.That(first.TotalRows, Is.Null);
        Assert.That(FirstColumn(second), Is.EqualTo(Numbers(1201, 200)));
        Assert.That(second.Columns, Is.EqualTo(first.Columns));
        Assert.That(second.HasMore, Is.True);
        Assert.That(after, Is.EqualTo(before + 1));
    }

    /// <summary>RN-SQL-007: o cursor fecha quando acaba.</summary>
    [Test]
    public async Task FetchNext_UntilTheEnd_LastPageHasMoreFalse_ThenNoOpenCursor()
    {
        await using var connection = await OpenAsync();
        var pages = new List<QueryPage> { await ExecutePageAsync(connection, PedidoQuery) };

        while (pages[^1].HasMore)
            pages.Add(await FetchPageAsync(connection));

        var afterTheEnd = await connection.FetchNextAsync(CancellationToken.None);

        Assert.That(pages.Select(page => page.Rows.Count), Is.EqualTo(new[] { 200, 200, 200, 200, 200 }));
        Assert.That(pages.SelectMany(FirstColumn), Is.EqualTo(Numbers(1001, 1000)));
        Assert.That(afterTheEnd.IsFailure, Is.True);
        Assert.That(afterTheEnd.Error.Kind, Is.EqualTo(EDatabaseFailure.NoOpenCursor));
    }

    /// <summary>RN-SQL-007: a cada nova execução o cursor anterior fecha.</summary>
    [Test]
    public async Task Execute_Again_ClosesThePreviousCursor()
    {
        await using var connection = await OpenAsync();
        await ExecutePageAsync(connection, PedidoQuery);

        var second = await ExecutePageAsync(connection, "SELECT id FROM loja.cliente ORDER BY id");
        var next = await connection.FetchNextAsync(CancellationToken.None);

        Assert.That(FirstColumn(second), Is.EqualTo(Numbers(1, 10)));
        Assert.That(second.HasMore, Is.False);
        Assert.That(next.IsFailure, Is.True);
        Assert.That(next.Error.Kind, Is.EqualTo(EDatabaseFailure.NoOpenCursor));
    }

    [Test]
    public async Task CloseCursor_ThenFetchNext_ReturnsNoOpenCursor_AndTheConnectionStillWorks()
    {
        await using var connection = await OpenAsync();
        await ExecutePageAsync(connection, PedidoQuery);

        await connection.CloseCursorAsync();
        var next = await connection.FetchNextAsync(CancellationToken.None);
        var again = await ExecutePageAsync(connection, PedidoQuery);

        Assert.That(next.IsFailure, Is.True);
        Assert.That(next.Error.Kind, Is.EqualTo(EDatabaseFailure.NoOpenCursor));
        Assert.That(FirstColumn(again), Is.EqualTo(Numbers(1001, 200)));
    }

    /// <summary>RN-SQL-006. O `;` do fim sai antes de o comando virar subconsulta.</summary>
    [Test]
    public async Task Count_ReturnsThousand()
    {
        await using var connection = await OpenAsync();

        var total = await connection.CountAsync($"{PedidoQuery};  ", CancellationToken.None);

        Assert.That(total.IsSuccess, Is.True, total.IsFailure ? total.Error.Message : null);
        Assert.That(total.Value, Is.EqualTo(1000));
    }

    /// <summary>Um comentário de linha no fim do comando não pode engolir o fecho da subconsulta.</summary>
    [Test]
    public async Task Count_OfQueryEndingInLineComment_StillCounts()
    {
        await using var connection = await OpenAsync();

        var total = await connection.CountAsync("SELECT id FROM loja.cliente -- todos os clientes", CancellationToken.None);

        Assert.That(total.IsSuccess, Is.True, total.IsFailure ? total.Error.Message : null);
        Assert.That(total.Value, Is.EqualTo(10));
    }

    /// <summary>RN-SQL-006: se o banco recusa a subconsulta, o erro é o do banco. A posição não vem: ela seria a do comando embrulhado.</summary>
    [Test]
    public async Task Count_OfQueryTheDatabaseRefuses_ReturnsExecutionFailed()
    {
        await using var connection = await OpenAsync();

        var total = await connection.CountAsync("SELECT id FROM loja.tabela_que_nao_existe", CancellationToken.None);

        Assert.That(total.IsFailure, Is.True);
        Assert.That(total.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(total.Error.Message, Is.Not.Empty);
        Assert.That(total.Error.Position, Is.Null);
    }

    /// <summary>RN-SQL-008.</summary>
    [Test]
    public async Task Execute_Update_ReturnsRowsAffected()
    {
        await using var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync("UPDATE loja.cliente SET nome = nome WHERE id <= 4", CancellationToken.None);

        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);
        Assert.That(outcome.Value.Page, Is.Null);
        Assert.That(outcome.Value.RowsAffected, Is.EqualTo(4));
    }

    /// <summary>RN-SQL-003: qualquer comando é aceito e enviado como está.</summary>
    [Test]
    public async Task Execute_Ddl_Succeeds()
    {
        await using var connection = await OpenAsync();
        var table = $"temporaria_{Guid.NewGuid():N}";

        var created = await connection.ExecuteAsync($"CREATE TABLE loja.{table} (id INTEGER)", CancellationToken.None);
        var tables = await connection.GetObjectsAsync(Name("loja"), "tables", CancellationToken.None);
        var dropped = await connection.ExecuteAsync($"DROP TABLE loja.{table}", CancellationToken.None);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(created.Value.Page, Is.Null);
        Assert.That(created.Value.RowsAffected, Is.Zero);
        Assert.That(tables.Value.Select(item => (item.Name, item.Kind)), Has.Member((Name(table), "table")));
        Assert.That(dropped.IsSuccess, Is.True);
    }

    /// <summary>RN-SQL-009. Depois do erro a conexão continua servindo.</summary>
    [Test]
    public async Task Execute_SyntaxError_ReturnsExecutionFailedWithMessageAndSqlState()
    {
        await using var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync("SELEC 1", CancellationToken.None);
        var ping = await connection.PingAsync(CancellationToken.None);

        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(outcome.Error.Message, Is.Not.Empty);
        Assert.That(outcome.Error.SqlState, Is.EqualTo(SyntaxErrorSqlState));
        // RN-SQL-010: sem pedido de cancelamento, nenhum desfecho de cancelamento.
        Assert.That(outcome.Error.Outcome, Is.Null);
        Assert.That(ping.IsSuccess, Is.True);
    }

    /// <summary>
    /// RN-SQL-010. O `Cancel` se repete até o comando voltar: um cancelamento que chegue antes de o comando estar no banco não tem o que
    /// interromper, e o teste não depende de adivinhar esse instante. Depois de cancelada, a conexão continua servindo.
    /// </summary>
    [Test]
    public async Task Cancel_StopsALongQuery()
    {
        await using var connection = await OpenAsync();
        var watch = Stopwatch.StartNew();

        var running = connection.ExecuteAsync(SlowQuery, CancellationToken.None);
        while (await Task.WhenAny(running, Task.Delay(250)) != running)
            connection.Cancel();

        var outcome = await running;
        watch.Stop();
        var ping = await connection.PingAsync(CancellationToken.None);

        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(outcome.Error.Message, Is.Not.Empty);
        // RN-SQL-010 (Ruling 135): a leitura interrompida não deixou nada, e o desfecho diz isso.
        Assert.That(outcome.Error.Outcome, Is.EqualTo(ECancelOutcome.Canceled));
        Assert.That(watch.Elapsed, Is.LessThan(TimeSpan.FromSeconds(5)));
        Assert.That(ping.IsSuccess, Is.True);
    }

    /// <summary>
    /// RN-SQL-010 (Ruling 135): o cancelamento já pedido quando o comando sai. O driver o recusa antes de enviar (o Npgsql pelo
    /// `ThrowIfCancellationRequested` do começo do `ExecuteReader`; o da IBM pela versão assíncrona do ADO.NET, que confere o pedido
    /// antes de chamar o driver), e essa é a prova que o desfecho `canceled` sem SQLSTATE exige: nada foi gravado, nem a gravação nem
    /// a leitura chegaram ao banco, e a conexão continua servindo.
    /// </summary>
    [Test]
    public async Task Cancel_BeforeTheCommandIsSent_IsCanceled_AndNothingIsWritten()
    {
        var table = await CreateWriteTableAsync();
        await using var connection = await OpenAsync();
        using var canceled = new CancellationTokenSource();
        await canceled.CancelAsync();

        var write = await connection.ExecuteAsync($"UPDATE {table} SET versao = 3", canceled.Token);
        var read = await connection.ExecuteAsync(PedidoQuery, canceled.Token);
        var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 3");
        var ping = await connection.PingAsync(CancellationToken.None);
        await DropAsync(table);

        foreach (var outcome in new[] { write, read })
        {
            Assert.That(outcome.IsFailure, Is.True);
            Assert.That(outcome.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
            Assert.That(outcome.Error.Message, Is.EqualTo("O comando foi cancelado."));
            Assert.That(outcome.Error.SqlState, Is.Null);
            Assert.That(outcome.Error.Outcome, Is.EqualTo(ECancelOutcome.Canceled));
        }

        Assert.That(written, Is.Zero);
        Assert.That(ping.IsSuccess, Is.True);
    }

    /// <summary>
    /// RN-SQL-010: o cancelamento que chega logo depois de o comando começar, quando a conexão ainda está preparando a execução e o
    /// comando do usuário nem chegou ao banco, também vale. O comando não fica rodando sem ter sido cancelado.
    /// </summary>
    [Test]
    public async Task Cancel_RightAfterTheCommandStarts_StopsIt()
    {
        await using var connection = await OpenAsync();
        var watch = Stopwatch.StartNew();

        var running = connection.ExecuteAsync(SlowQuery, CancellationToken.None);
        connection.Cancel();
        var outcome = await running;
        watch.Stop();
        var ping = await connection.PingAsync(CancellationToken.None);
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);

        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(outcome.Error.Outcome, Is.EqualTo(ECancelOutcome.Canceled));
        Assert.That(watch.Elapsed, Is.LessThan(TimeSpan.FromSeconds(5)));
        Assert.That(ping.IsSuccess, Is.True);
        Assert.That(pending, Is.Zero);
    }

    [Test]
    public async Task Execute_SelectWithZeroRows_ReturnsColumnsAndEmptyRows()
    {
        await using var connection = await OpenAsync();

        var page = await ExecutePageAsync(connection, "SELECT numero, observacao FROM loja.pedido WHERE numero < 0");
        var next = await connection.FetchNextAsync(CancellationToken.None);

        Assert.That(page.Columns.Select(column => column.Name), Is.EqualTo(Names("numero", "observacao")));
        Assert.That(page.Rows, Is.Empty);
        Assert.That(page.HasMore, Is.False);
        Assert.That(next.IsFailure, Is.True);
        Assert.That(next.Error.Kind, Is.EqualTo(EDatabaseFailure.NoOpenCursor));
    }

    /// <summary>
    /// RN-SQL-013 e RN-SESSAO-005: o comando que grava e devolve linhas é executado até o fim. A resposta traz as 200 primeiras e o total,
    /// sem cursor; a gravação já está confirmada quando ela chega, e fechar a conexão não a desfaz.
    /// </summary>
    [Test]
    public async Task Execute_WriteReturningManyRows_IsCommittedWhenTheResponseArrives()
    {
        var table = await CreateWriteTableAsync();
        var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync(WriteReturningRows(table), CancellationToken.None);
        var seenWhenTheResponseArrives = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        var next = await connection.FetchNextAsync(CancellationToken.None);
        await connection.DisposeAsync();
        var seenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        await DropAsync(table);

        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);
        Assert.That(outcome.Value.RowsAffected, Is.Null);
        Assert.That(outcome.Value.Page!.Rows, Has.Count.EqualTo(200));
        Assert.That(outcome.Value.Page.Columns.Select(column => column.Name), Is.EqualTo(Names("numero")));
        Assert.That(outcome.Value.Page.HasMore, Is.False);
        Assert.That(outcome.Value.Page.TotalRows, Is.EqualTo(1000));
        Assert.That(seenWhenTheResponseArrives, Is.EqualTo(1000));
        Assert.That(next.IsFailure, Is.True);
        Assert.That(next.Error.Kind, Is.EqualTo(EDatabaseFailure.NoOpenCursor));
        Assert.That(seenAfterClosing, Is.EqualTo(1000));
    }

    /// <summary>RN-SESSAO-005.</summary>
    [Test]
    public async Task Execute_WriteWithoutRows_IsCommittedWhenTheResponseArrives()
    {
        var table = await CreateWriteTableAsync();
        var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync($"UPDATE {table} SET versao = 2", CancellationToken.None);
        var seenWhenTheResponseArrives = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 2");
        await connection.DisposeAsync();
        var seenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 2");
        await DropAsync(table);

        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);
        Assert.That(outcome.Value.Page, Is.Null);
        Assert.That(outcome.Value.RowsAffected, Is.EqualTo(1000));
        Assert.That(seenWhenTheResponseArrives, Is.EqualTo(1000));
        Assert.That(seenAfterClosing, Is.EqualTo(1000));
    }

    /// <summary>
    /// RN-SQL-007: o cursor de uma leitura segura recurso no banco só enquanto está aberto. Com a primeira página lida há transação e trava;
    /// fechado o cursor, com a conexão ainda aberta, não sobra nada; e fechar a conexão com o cursor aberto também não deixa nada.
    /// </summary>
    [Test]
    public async Task Execute_ReadWithOpenCursor_ThenCloseSession_LeavesNothingPending()
    {
        var connection = await OpenAsync();

        var page = await ExecutePageAsync(connection, LargeReadQuery);
        var pendingWithTheCursorOpen = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        await connection.CloseCursorAsync();
        var pendingAfterClosingTheCursor = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        await ExecutePageAsync(connection, LargeReadQuery);
        await connection.DisposeAsync();

        // O banco leva alguns milissegundos para dar por encerrada a conexão que o cliente fechou.
        var watch = Stopwatch.StartNew();
        long pendingAfterClosingTheConnection;
        while ((pendingAfterClosingTheConnection = await ReadFromAnotherConnectionAsync(PendingWorkQuery)) != 0 && watch.Elapsed < TimeSpan.FromSeconds(10))
            await Task.Delay(25);

        Assert.That(page.HasMore, Is.True);
        Assert.That(pendingWithTheCursorOpen > 0, Is.EqualTo(OpenReadCursorHoldsWork));
        Assert.That(pendingAfterClosingTheCursor, Is.Zero);
        Assert.That(pendingAfterClosingTheConnection, Is.Zero);
    }

    /// <summary>
    /// RN-SQL-001 e RN-SESSAO-005: uma gravação seguida de uma leitura grande, enviadas juntas. Ou o banco recusa o envio inteiro e nada
    /// muda, ou a gravação está confirmada e continua lá depois de a conexão fechar. O que não pode acontecer é a resposta trazer as
    /// linhas da leitura e a gravação sumir quando o cursor fecha.
    /// </summary>
    [Test]
    public async Task Execute_TwoStatements_NeverLosesTheFirstWrite()
    {
        var table = await CreateWriteTableAsync();
        var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync($"UPDATE {table} SET versao = 5; {LargeReadQuery}", CancellationToken.None);
        var seenWhenTheResponseArrives = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 5");
        await connection.DisposeAsync();
        var seenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 5");
        await DropAsync(table);

        if (outcome.IsFailure)
        {
            Assert.That(outcome.Error.Kind, Is.EqualTo(SeveralStatementsRefusal));
            Assert.That(seenWhenTheResponseArrives, Is.Zero);
            Assert.That(seenAfterClosing, Is.Zero);
        }
        else
        {
            Assert.That(seenWhenTheResponseArrives, Is.EqualTo(1000));
            Assert.That(seenAfterClosing, Is.EqualTo(1000));
        }
    }

    /// <summary>RN-SQL-003: controle de transação é recusado sem ir ao banco, e a conexão segue como estava.</summary>
    [Test]
    public async Task Execute_TransactionControl_IsRefusedWithoutReachingTheDatabase()
    {
        await using var connection = await OpenAsync();

        var refusals = new List<DatabaseFailure>();
        foreach (var sql in new[] { "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT ponto", "-- abre\nbegin transaction", "START TRANSACTION", ";BEGIN", "; ;\n BEGIN" })
            refusals.Add((await connection.ExecuteAsync(sql, CancellationToken.None)).Error);

        var afterwards = await ExecutePageAsync(connection, "SELECT id FROM loja.cliente ORDER BY id");
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);

        Assert.That(refusals.Select(refusal => refusal.Kind), Is.All.EqualTo(EDatabaseFailure.TransactionControlNotSupported));
        // RN-SESSAO-005: recusado antes de executar, sem `executed`.
        Assert.That(refusals.Select(refusal => refusal.Executed), Is.All.False);
        Assert.That(afterwards.Rows, Has.Count.EqualTo(10));
        Assert.That(pending, Is.Zero);
    }

    /// <summary>
    /// RN-SQL-010: cancelar sem comando em andamento não faz nada. Com o cursor aberto e parado, o resultado continua legível até o fim,
    /// inclusive a parte que o banco ainda não tinha mandado quando o cancelamento chegou.
    /// </summary>
    [Test]
    public async Task Cancel_WithAnIdleOpenCursor_LeavesItReadableToTheEnd()
    {
        await using var connection = await OpenAsync();
        var page = await ExecutePageAsync(connection, LargeReadQuery);
        long rows = page.Rows.Count;

        connection.Cancel();
        while (page.HasMore)
        {
            page = await FetchPageAsync(connection);
            rows += page.Rows.Count;
        }

        Assert.That(rows, Is.EqualTo(20000));
    }

    /// <summary>Exatamente uma página: o cursor não fica aberto à espera de uma linha que não existe.</summary>
    [Test]
    public async Task Execute_SelectWithExactlyOnePage_HasMoreIsFalse()
    {
        await using var connection = await OpenAsync();

        var page = await ExecutePageAsync(connection, "SELECT numero FROM loja.pedido WHERE numero <= 1200 ORDER BY numero");

        Assert.That(page.Rows, Has.Count.EqualTo(200));
        Assert.That(page.HasMore, Is.False);
    }
}
