using CSharpFunctionalExtensions;
using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Extensions;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// RN-EDIT-002 a 012 contra o banco de verdade, pelo registro de sessões: os Registros de uma tabela (`SELECT * FROM "esquema"."tabela"`)
/// são editáveis quando ela tem chave; o "Salvar" grava numa transação só, exatamente uma linha por comando, e desfaz tudo quando um
/// comando afeta outro número de linhas ou o banco recusa. Cada banco monta um esquema só dele (no Informix, um dono, com os nomes de
/// tabela sorteados, porque lá o nome é único no banco inteiro) e o apaga no fim.
/// </summary>
public abstract class DatabaseEditContractTests
{
    private ServiceProvider _provider = null!;
    private IDatabaseSessionService _service = null!;
    private IVaultService _vault = null!;
    private IDatabaseClient _client = null!;

    protected ConnectionSettings Settings { get; private set; } = null!;

    protected abstract EDatabaseEngine Engine { get; }

    /// <summary>O esquema (no Informix, o dono), como o banco o guarda.</summary>
    protected abstract string Schema { get; }

    protected abstract IEnumerable<string> Setup { get; }

    protected abstract IEnumerable<string> Teardown { get; }

    /// <summary>A coluna sempre gerada pelo banco de `pedido`, como o banco a guarda; nula onde ele não tem (Informix).</summary>
    protected abstract string? GeneratedColumn { get; }

    /// <summary>
    /// RN-EDIT-006 (a sonda S-IBM-4): cada tipo editável de `tipos`, com o texto que a pessoa digita e o que a grade mostra depois de
    /// ler de novo. No Db2 e no Informix é o Prism quem converte, e o texto lido é o mesmo que ele escreveu na célula.
    /// </summary>
    protected abstract IReadOnlyList<(string Column, string Written, string Read)> TypeSamples { get; }

    protected abstract Task<ConnectionSettings> StartDatabaseAsync();

    protected virtual Task ConfigureAsync(IServiceCollection services)
        => Task.CompletedTask;

    /// <summary>O nome como o banco o guarda quando é escrito sem aspas.</summary>
    protected abstract string Name(string name);

    /// <summary>O nome de uma tabela do teste, como o banco o guarda.</summary>
    protected virtual string Table(string name)
        => Name(name);

    /// <summary>Uma tabela das junções como o `FROM` a escreve: com o esquema, onde o caminho de busca da sessão não a acha sem ele.</summary>
    protected virtual string JoinFrom(string table)
        => Quoted(table);

    /// <summary>O qualificador de uma coluna das junções, sem apelido: o nome da tabela, como o comando do dono escreve.</summary>
    protected virtual string JoinQualifier(string table)
        => Table(table);

    /// <summary>
    /// RN-GRADE-011: o `SELECT` (que termina em `ORDER BY`) só com as primeiras `rows` linhas, no limite de linhas do banco: `LIMIT` no
    /// PostgreSQL, `FETCH FIRST` no Db2, `FIRST` na cabeça no Informix.
    /// </summary>
    protected abstract string WithFirstRows(string select, int rows);

    /// <summary>RN-GRADE-011: o fim de comando que a tabela derivada do banco não aceita dentro dela (`FOR READ ONLY` no Db2 e no Informix); nulo onde não se testa.</summary>
    protected virtual string? ReadOnlyClause => null;

    protected IDatabaseSessionService Service => _service;

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        Settings = await StartDatabaseAsync();

        var services = new ServiceCollection().AddInfrastructure(Directory.CreateTempSubdirectory("prism-edits-").FullName);
        await ConfigureAsync(services);
        _provider = services.BuildServiceProvider();
        _service = _provider.GetRequiredService<IDatabaseSessionService>();
        _vault = _provider.GetRequiredService<IVaultService>();
        _client = _provider.GetServices<IDatabaseClient>().Single(client => client.Engine == Engine);

        await RunAsync(Settings, [.. Setup, .. JoinTables.Select(table => $"CREATE TABLE {Schema}.{Table(table.Name)} ({table.Columns})")]);
    }

    [OneTimeTearDown]
    public async Task StopAsync()
    {
        await using (var connection = Value(await _client.OpenAsync(Settings, CancellationToken.None)))
        {
            foreach (var sql in JoinTables.Select(table => $"DROP TABLE {Schema}.{Table(table.Name)}").Concat(Teardown))
                await connection.ExecuteAsync(sql, CancellationToken.None);
        }

        await _provider.DisposeAsync();
    }

    [SetUp]
    public Task ResetAsync()
        => RunAsync(Settings, [$"DELETE FROM {Quoted("pedido")}", .. new[] { (1, "aberta", 1), (2, "aberta", 2), (3, "fechada", 3) }.Select(row => $"INSERT INTO {Quoted("pedido")} ({Q(Name("id"))}, {Q(Name("status"))}, {Q(Name("quantidade"))}) VALUES ({row.Item1}, '{row.Item2}', {row.Item3})")]);

    /// <summary>RN-EDIT-002: os Registros de uma tabela com chave primária. A página diz que só o catálogo sabe, e o catálogo diz o que se edita.</summary>
    [Test]
    public async Task EditTarget_OfTheRecordsOfATableWithAPrimaryKey_IsEditable()
    {
        var session = await OpenSessionAsync();
        var page = await RecordsAsync(session, "pedido");

        Assert.That(page.ResultID, Is.Not.Null);
        Assert.That(page.Editable, Is.EqualTo(ResultEditability.Unknown));

        var target = Value(await _service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None));
        var table = target.Tables.Single();

        Assert.That((table.Schema, table.Name, table.Editable, table.Reason), Is.EqualTo((Schema, Table("pedido"), true, (string?)null)));
        Assert.That(table.Key, Is.EqualTo(new[] { Column(page, "id") }));
        Assert.That(target.RowOperations, Is.True);
        Assert.That(target.OneAtATime, Is.False);
        Assert.That(target.Columns[Column(page, "status")].Editable, Is.True);
        Assert.That(target.Columns[Column(page, "id")].Editable, Is.True);
        Assert.That(target.Columns[Column(page, "anexo")], Has.Property(nameof(EditColumn.Editable)).False.And.Property(nameof(EditColumn.Reason)).EqualTo("coluna binária"));

        if (GeneratedColumn is { } generated)
            Assert.That(target.Columns[Column(page, generated)], Has.Property(nameof(EditColumn.Editable)).False.And.Property(nameof(EditColumn.Reason)).EqualTo("gerada pelo banco"));
    }

    /// <summary>RN-EDIT-002: a visão e a tabela sem chave ficam só leitura, com o motivo; a chave única de colunas não nulas serve de chave.</summary>
    [Test]
    public async Task EditTarget_OfAViewAndOfATableWithoutKey_IsReadOnly_AndAUniqueKeyServes()
    {
        var session = await OpenSessionAsync();

        var view = await TargetAsync(session, "resumo");
        var withoutKey = await TargetAsync(session, "sem_chave");
        var unique = await TargetAsync(session, "unica");

        Assert.That(view.Target.Tables[0].Reason, Is.EqualTo($"{Table("resumo")} é uma visão"));
        Assert.That(withoutKey.Target.Tables[0].Reason, Is.EqualTo($"{Table("sem_chave")} não tem chave primária nem chave única de colunas não nulas"));
        Assert.That(view.Target.Columns.Concat(withoutKey.Target.Columns).Select(column => column.Editable), Is.All.False);
        Assert.That(unique.Target.Tables[0], Has.Property(nameof(EditTable.Editable)).True);
        Assert.That(unique.Target.Tables[0].Key, Is.EqualTo(new[] { Column(unique.Page, "codigo") }));
    }

    /// <summary>RN-EDIT-002 e 010: a união é só leitura sem consultar o banco, na própria página; o `edit-target` diz o mesmo.</summary>
    [Test]
    public async Task Page_OfAUnion_IsReadOnlyWithoutTheCatalog()
    {
        var session = await OpenSessionAsync();
        var page = Value(await _service.ExecuteAsync(session, $"SELECT {Q(Name("id"))} FROM {Quoted("pedido")} UNION SELECT {Q(Name("id"))} FROM {Quoted("pedido")}", QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;

        Assert.That(page.Editable, Is.EqualTo(ResultEditability.ReadOnly("união de consultas")));

        var target = await _service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None);
        Assert.That((target.Error.Kind, target.Error.Reason), Is.EqualTo((EDatabaseFailure.ResultNotEditable, "união de consultas")));
    }

    /// <summary>RN-EDIT-005: alteração, linha nova e exclusão num "Salvar" só, confirmado quando a resposta chega.</summary>
    [Test]
    public async Task Edits_UpdateInsertAndDelete_AreSavedTogether()
    {
        var session = await OpenSessionAsync();
        var page = await EditableRecordsAsync(session, "pedido");
        var (id, status, quantidade) = (Column(page, "id"), Column(page, "status"), Column(page, "quantidade"));

        var applied = await _service.ApplyEditsAsync(session, page.ResultID!.Value,
        [
            new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(status, "paga")]),
            new EditChange(EEditKind.Insert, 0, [], [new EditValue(id, "10"), new EditValue(status, "nova"), new EditValue(quantidade, "5")]),
            new EditChange(EEditKind.Delete, 0, ["3"], []),
            new EditChange(EEditKind.Update, 0, ["2"], [new EditValue(status, null)])
        ], CancellationToken.None);

        Assert.That(Value(applied), Is.EqualTo(4));
        Assert.That(await RowsAsync("pedido", "status"), Is.EqualTo(new[] { ("1", "paga"), ("2", (string?)null), ("10", "nova") }));
    }

    /// <summary>RN-EDIT-005: um comando que não afeta nenhuma linha desfaz o "Salvar" inteiro, e a recusa diz qual alteração e quantas linhas.</summary>
    [Test]
    public async Task Edits_ThatAffectNoRow_UndoTheWholeSave()
    {
        var session = await OpenSessionAsync();
        var page = await EditableRecordsAsync(session, "pedido");
        var status = Column(page, "status");

        var applied = await _service.ApplyEditsAsync(session, page.ResultID!.Value, [new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(status, "paga")]), new EditChange(EEditKind.Update, 0, ["999"], [new EditValue(status, "sumiu")])], CancellationToken.None);

        Assert.That(applied.IsFailure, Is.True);
        Assert.That((applied.Error.Kind, applied.Error.Change, applied.Error.RowsAffected, applied.Error.Applied), Is.EqualTo((EDatabaseFailure.EditRowMismatch, (int?)1, (long?)0, (int?)null)));
        Assert.That(await RowsAsync("pedido", "status"), Is.EqualTo(new[] { ("1", (string?)"aberta"), ("2", "aberta"), ("3", "fechada") }));
    }

    /// <summary>RN-EDIT-005 e RN-SQL-009: a recusa do banco desfaz o "Salvar" inteiro, e a mensagem é a dele, como veio, com a alteração que falhou.</summary>
    [Test]
    public async Task Edits_RefusedByTheDatabase_UndoTheWholeSave_WithItsMessage()
    {
        var session = await OpenSessionAsync();
        var page = await EditableRecordsAsync(session, "pedido");
        var (id, status) = (Column(page, "id"), Column(page, "status"));

        var applied = await _service.ApplyEditsAsync(session, page.ResultID!.Value, [new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(status, "paga")]), new EditChange(EEditKind.Insert, 0, [], [new EditValue(id, "2"), new EditValue(status, "repetida")])], CancellationToken.None);
        await TestContext.Out.WriteLineAsync($"{Engine}: {applied.Error.Kind}, SQLSTATE {applied.Error.SqlState}: {applied.Error.Message}");

        Assert.That((applied.Error.Kind, applied.Error.Change), Is.EqualTo((EDatabaseFailure.ExecutionFailed, (int?)1)));
        Assert.That(applied.Error.Message, Is.Not.Empty);
        Assert.That(await RowsAsync("pedido", "status"), Is.EqualTo(new[] { ("1", (string?)"aberta"), ("2", "aberta"), ("3", "fechada") }));
    }

    /// <summary>RN-EDIT-006 (S-IBM-4): cada tipo editável grava o texto digitado e volta à grade como foi escrito.</summary>
    [Test]
    public async Task Edits_OfEachEditableType_ReadBackAsWritten()
    {
        var session = await OpenSessionAsync();
        var page = await EditableRecordsAsync(session, "tipos");

        var applied = await _service.ApplyEditsAsync(session, page.ResultID!.Value, [new EditChange(EEditKind.Update, 0, ["1"], [.. TypeSamples.Select(sample => new EditValue(Column(page, sample.Column), sample.Written))])], CancellationToken.None);
        Assert.That(applied.IsSuccess, Is.True, applied.IsFailure ? $"{applied.Error.Kind} na coluna {applied.Error.Column}: {applied.Error.Message}" : null);

        var read = await RecordsAsync(session, "tipos");
        foreach (var sample in TypeSamples)
            await TestContext.Out.WriteLineAsync($"{Engine}: {sample.Column} = {read.Rows[0][Column(read, sample.Column)]}");

        Assert.That(TypeSamples.Select(sample => read.Rows[0][Column(read, sample.Column)]), Is.EqualTo(TypeSamples.Select(sample => sample.Read)));
    }

    /// <summary>RN-EDIT-002: o "Salvar" de um resultado que já não é o da sessão é recusado, sem ir ao banco.</summary>
    [Test]
    public async Task Edits_OfAResultThatIsNoLongerTheSessions_AreRefused()
    {
        var session = await OpenSessionAsync();
        var page = await EditableRecordsAsync(session, "pedido");
        await RecordsAsync(session, "pedido");

        var applied = await _service.ApplyEditsAsync(session, page.ResultID!.Value, [new EditChange(EEditKind.Delete, 0, ["1"], [])], CancellationToken.None);

        Assert.That(applied.Error.Kind, Is.EqualTo(EDatabaseFailure.ResultChanged));
        Assert.That(await RowsAsync("pedido", "status"), Has.Length.EqualTo(3));
    }

    /// <summary>
    /// RN-SQL-024 (seção 33): o resultado que o comando seguinte leva em `keep`, como as abas do script, continua se editando em cada banco: o
    /// "Salvar" dele grava pela chave, numa sessão em que outro comando já rodou, e o resultado atual continua o atual.
    /// </summary>
    [Test]
    public async Task Edits_OfAKeptResult_AreSavedAfterAnotherCommand()
    {
        var session = await OpenSessionAsync();
        var page = await EditableRecordsAsync(session, "pedido");
        var current = Value(await _service.ExecuteAsync(session, $"SELECT * FROM {Quoted("pedido")}\nORDER BY 1", null, QueryPaging.DefaultPageSize, false, [page.ResultID!.Value], CancellationToken.None)).Page!;

        var applied = await _service.ApplyEditsAsync(session, page.ResultID!.Value, [new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(Column(page, "status"), "guardada")])], CancellationToken.None);

        Assert.That(Value(applied), Is.EqualTo(1));
        Assert.That(await RowsAsync("pedido", "status"), Is.EqualTo(new[] { ("1", (string?)"guardada"), ("2", "aberta"), ("3", "fechada") }));
        Assert.That(Value(await _service.GetEditTargetAsync(session, current.ResultID!.Value, null, CancellationToken.None)).RowOperations, Is.True);
    }

    /// <summary>
    /// O pedido do dono (2026-10-14): o SELECT com junção de três tabelas que lê as colunas de uma só, sem apelido. Edita-se a tabela que
    /// tem a chave inteira no resultado (menos a coluna da chave); as outras duas ficam só leitura, com o motivo. Não há linha nova nem
    /// exclusão. O "Salvar" grava pela chave da tabela da coluna.
    /// </summary>
    [Test]
    public async Task Edits_OfTheOwnersJoin_SaveTheTableThatHasItsKeyInTheResult()
    {
        await ResetJoinTablesAsync();
        var session = await OpenSessionAsync();
        var page = Value(await _service.ExecuteAsync(session, $"""
            select {JoinQualifier("pallets_items")}.*
              from {JoinFrom("pallets")}
             inner join {JoinFrom("pallets_items")} on {JoinQualifier("pallets_items")}.pallet_id = {JoinQualifier("pallets")}.id
             inner join {JoinFrom("items")} on {JoinQualifier("pallets_items")}.item_id = {JoinQualifier("items")}.id
             where {JoinQualifier("pallets")}.is_integrated = 1 and {JoinQualifier("pallets")}.location_id = 6 and {JoinQualifier("items")}.code = '66903015'
             order by 1
            """, QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;
        Assert.That(page.Editable, Is.EqualTo(ResultEditability.Unknown));
        Assert.That(page.Rows.Select(row => row[Column(page, "id")]), Is.EqualTo(new[] { "100", "103" }));

        var target = Value(await _service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None));

        Assert.That(target.Tables.Select(table => (table.Name, table.Editable)), Is.EqualTo(new[] { (Table("pallets"), false), (Table("pallets_items"), true), (Table("items"), false) }));
        Assert.That(target.Tables[0].Reason, Is.EqualTo($"a chave de {Table("pallets")} não está inteira no resultado: faltam {Name("id")}"));
        Assert.That(target.Tables[1].Key, Is.EqualTo(new[] { Column(page, "id") }));
        Assert.That(target.Columns.Select(column => column.Table), Is.All.EqualTo(1));
        Assert.That((target.Columns[Column(page, "id")].Editable, target.Columns[Column(page, "id")].Reason), Is.EqualTo((false, (string?)"coluna da chave numa junção")));
        Assert.That(target.Columns[Column(page, "quantity")].Editable, Is.True);
        Assert.That(target.RowOperations, Is.False);

        var applied = await _service.ApplyEditsAsync(session, page.ResultID.Value, [new EditChange(EEditKind.Update, 1, ["100"], [new EditValue(Column(page, "quantity"), "50")])], CancellationToken.None);

        Assert.That(Value(applied), Is.EqualTo(1));
        Assert.That(await RowsAsync("pallets_items", "quantity"), Is.EqualTo(new[] { ("100", (string?)"50"), ("101", "7"), ("102", "9"), ("103", "3") }));
    }

    /// <summary>
    /// RN-EDIT-002, 005 e 008: numa junção, as alterações de uma linha da grade em duas tabelas são dois `UPDATE`, cada um pela chave da
    /// sua tabela, num "Salvar" só; a linha de uma tabela que aparece repetida no resultado muda em todas as linhas dele.
    /// </summary>
    [Test]
    public async Task Edits_OfTwoTablesInTheSameRowOfAJoin_AreTwoUpdatesByEachKey()
    {
        await ResetJoinTablesAsync();
        var session = await OpenSessionAsync();
        var sql = $"SELECT pi.id, pi.quantity, i.id AS item_key, i.description FROM {JoinFrom("pallets_items")} pi JOIN {JoinFrom("items")} i ON i.id = pi.item_id WHERE pi.pallet_id = 1 ORDER BY pi.id";
        var page = Value(await _service.ExecuteAsync(session, sql, QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;
        var (quantity, description) = (Column(page, "quantity"), Column(page, "description"));

        var target = Value(await _service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None));
        Assert.That(target.Tables.Select(table => table.Key.ToArray()), Is.EqualTo(new[] { new[] { Column(page, "id") }, new[] { Column(page, "item_key") } }));
        Assert.That(target.Columns.Select(column => (column.Table, column.Editable)), Is.EqualTo(new[] { ((int?)0, false), (0, true), (1, false), (1, true) }));

        EditChange[] changes = [new(EEditKind.Update, 0, ["100"], [new EditValue(quantity, "6")]), new(EEditKind.Update, 1, ["10"], [new EditValue(description, "parafuso sextavado")])];
        var preview = Value(await _service.PreviewEditsAsync(session, page.ResultID.Value, changes, CancellationToken.None));
        Assert.That(preview.Statements.Select(statement => statement.Sql), Is.EqualTo(new[]
        {
            $"UPDATE {Quoted("pallets_items")} SET {Q(Name("quantity"))} = 6 WHERE {Q(Name("id"))} = 100",
            $"UPDATE {Quoted("items")} SET {Q(Name("description"))} = 'parafuso sextavado' WHERE {Q(Name("id"))} = 10"
        }));

        Assert.That(Value(await _service.ApplyEditsAsync(session, page.ResultID.Value, changes, CancellationToken.None)), Is.EqualTo(2));

        var read = Value(await _service.ExecuteAsync(session, sql, QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;
        Assert.That(read.Rows.Select(row => (row[0], row[quantity], row[description])), Is.EqualTo(new[] { ("100", (string?)"6", (string?)"parafuso sextavado"), ("101", "7", "porca"), ("103", "3", "parafuso sextavado") }));
    }

    /// <summary>RN-EDIT-002: numa junção externa, a tabela que não tem linha ali veio com a chave nula, e a alteração dela é recusada antes do banco.</summary>
    [Test]
    public async Task Edits_OfTheMissingSideOfAnOuterJoin_AreRefusedBeforeTheDatabase()
    {
        await ResetJoinTablesAsync();
        var session = await OpenSessionAsync();
        var page = Value(await _service.ExecuteAsync(session, $"SELECT p.id, p.location_id, pi.id AS item_row, pi.quantity FROM {JoinFrom("pallets")} p LEFT JOIN {JoinFrom("pallets_items")} pi ON pi.pallet_id = p.id WHERE p.id = 4", QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;
        Assert.That(page.Rows.Single()[Column(page, "item_row")], Is.Null);

        var target = Value(await _service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None));
        Assert.That(target.Tables.Select(table => table.Editable), Is.All.True);

        var applied = await _service.ApplyEditsAsync(session, page.ResultID.Value, [new EditChange(EEditKind.Update, 1, [null], [new EditValue(Column(page, "quantity"), "1")])], CancellationToken.None);
        Assert.That((applied.Error.Kind, applied.Error.Change), Is.EqualTo((EDatabaseFailure.EditInvalid, (int?)0)));
    }

    /// <summary>RN-EDIT-002: a mesma tabela duas vezes no `FROM` fica só leitura, com o motivo; a junção não deixa o resultado inteiro só leitura.</summary>
    [Test]
    public async Task EditTarget_OfATableThatAppearsTwice_IsReadOnly()
    {
        var session = await OpenSessionAsync();
        var page = Value(await _service.ExecuteAsync(session, $"SELECT a.id, a.code, b.id AS other FROM {JoinFrom("items")} a JOIN {JoinFrom("items")} b ON b.id = a.id", QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;

        var target = Value(await _service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None));

        Assert.That(target.Tables.Select(table => table.Reason), Is.All.EqualTo($"{Table("items")} aparece mais de uma vez no comando"));
        Assert.That(target.Columns.Select(column => column.Editable), Is.All.False);
    }

    /// <summary>RN-EDIT-008: o "Ver SQL" mostra os comandos com os valores como literais, sem executar nada.</summary>
    [Test]
    public async Task Preview_WritesTheCommandsWithoutRunningThem()
    {
        var session = await OpenSessionAsync();
        var page = await EditableRecordsAsync(session, "pedido");

        var preview = Value(await _service.PreviewEditsAsync(session, page.ResultID!.Value, [new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(Column(page, "status"), "it's")])], CancellationToken.None));

        Assert.That(preview.Statements.Select(statement => statement.Sql), Is.EqualTo(new[] { $"UPDATE {Quoted("pedido")} SET {Q(Name("status"))} = 'it''s' WHERE {Q(Name("id"))} = 1" }));
        Assert.That(await RowsAsync("pedido", "status"), Does.Contain(("1", (string?)"aberta")));
    }

    /// <summary>
    /// RN-GRADE-011: o filtro junto aos Registros (com o `WHERE` e o `ORDER BY` deles) dá as linhas certas, na ordem do filtro, e o
    /// resultado continua editável: o catálogo diz o mesmo que sem o filtro, e o "Salvar" grava pela chave. O "contar total" conta o
    /// comando montado.
    /// </summary>
    [Test]
    public async Task Filter_MergedIntoTheCommand_GivesTheRightRows_AndStaysEditable()
    {
        var session = await OpenSessionAsync();
        var sql = $"SELECT * FROM {Quoted("pedido")} WHERE {Q(Name("quantidade"))} >= 1 ORDER BY 1";
        var page = Value(await _service.ExecuteAsync(session, sql, $"{Q(Name("status"))} = 'aberta' ORDER BY {Q(Name("id"))} DESC", QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;

        Assert.That((page.FilterApplied, page.Editable), Is.EqualTo((EFilterApplied.Merged, ResultEditability.Unknown)));
        Assert.That(page.Rows.Select(row => row[Column(page, "id")]), Is.EqualTo(new[] { "2", "1" }));
        Assert.That(Value(await _service.CountAsync(session, CancellationToken.None)), Is.EqualTo(2));

        var target = Value(await _service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None));
        Assert.That((target.Tables.Single().Editable, target.RowOperations, target.Columns[Column(page, "status")].Editable), Is.EqualTo((true, true, true)));

        var applied = await _service.ApplyEditsAsync(session, page.ResultID.Value, [new EditChange(EEditKind.Update, 0, ["2"], [new EditValue(Column(page, "status"), "paga")])], CancellationToken.None);
        Assert.That(Value(applied), Is.EqualTo(1));
        Assert.That(await RowsAsync("pedido", "status"), Is.EqualTo(new[] { ("1", (string?)"aberta"), ("2", "paga"), ("3", "fechada") }));
    }

    /// <summary>RN-GRADE-011: a ordem do filtro troca a do comando e entra antes do limite de linhas do banco: das abertas, a primeira na ordem nova.</summary>
    [Test]
    public async Task Filter_MergedIntoACommandWithARowLimit_OrdersBeforeTheLimit()
    {
        var session = await OpenSessionAsync();
        var sql = WithFirstRows($"SELECT * FROM {Quoted("pedido")} ORDER BY 1", 1);
        var page = Value(await _service.ExecuteAsync(session, sql, $"{Q(Name("status"))} = 'aberta' ORDER BY {Q(Name("id"))} DESC", QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;

        Assert.That((page.FilterApplied, page.Editable), Is.EqualTo((EFilterApplied.Merged, ResultEditability.Unknown)));
        Assert.That(page.Rows.Select(row => row[Column(page, "id")]), Is.EqualTo(new[] { "2" }));
    }

    /// <summary>
    /// RN-GRADE-011: o agrupamento vai por fora, como tabela derivada com o `ORDER BY` e o limite de linhas dentro (o fim de comando que
    /// ela não aceita, como o `FOR READ ONLY`, vai depois); as linhas são as certas, e o resultado é só leitura, com o motivo do comando.
    /// </summary>
    [Test]
    public async Task Filter_AroundAGroupedCommand_GivesTheRightRows_AndIsReadOnly()
    {
        var session = await OpenSessionAsync();
        var status = Q(Name("status"));
        var grouped = WithFirstRows($"SELECT {status}, COUNT(*) AS quantos FROM {Quoted("pedido")} GROUP BY {status} ORDER BY 2 DESC", 1) + (ReadOnlyClause is { } clause ? $" {clause}" : string.Empty);
        var page = Value(await _service.ExecuteAsync(session, grouped, $"quantos >= 1 ORDER BY {status}", QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;

        Assert.That((page.FilterApplied, page.Editable), Is.EqualTo((EFilterApplied.Wrapped, ResultEditability.ReadOnly("agrupamento"))));
        Assert.That(page.Rows.Select(row => (row[Column(page, "status")], row[Column(page, "quantos")])), Is.EqualTo(new[] { ((string?)"aberta", (string?)"2") }));

        var target = await _service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None);
        Assert.That((target.Error.Kind, target.Error.Reason), Is.EqualTo((EDatabaseFailure.ResultNotEditable, "agrupamento")));
    }

    /// <summary>RN-GRADE-011: a união vai por fora; a condição e a ordem do filtro valem para as linhas das duas partes, e o resultado é só leitura.</summary>
    [Test]
    public async Task Filter_AroundAUnion_GivesTheRightRows_AndIsReadOnly()
    {
        var session = await OpenSessionAsync();
        var (id, status) = (Q(Name("id")), Q(Name("status")));
        var union = $"SELECT {id}, {status} FROM {Quoted("pedido")} WHERE {id} = 1 UNION SELECT {id}, {status} FROM {Quoted("pedido")} WHERE {id} = 3";
        var page = Value(await _service.ExecuteAsync(session, union, $"{id} > 0 ORDER BY {id} DESC", QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;

        Assert.That((page.FilterApplied, page.Editable), Is.EqualTo((EFilterApplied.Wrapped, ResultEditability.ReadOnly("união de consultas"))));
        Assert.That(page.Rows.Select(row => (row[Column(page, "id")], row[Column(page, "status")])), Is.EqualTo(new[] { ((string?)"3", (string?)"fechada"), ("1", "aberta") }));
    }

    /// <summary>As tabelas das junções (o pedido do dono): paletes, itens e os itens de cada palete. Os tipos são os mesmos nos três bancos.</summary>
    private static readonly (string Name, string Columns)[] JoinTables =
    [
        ("pallets", "id INTEGER NOT NULL PRIMARY KEY, location_id INTEGER, is_integrated INTEGER"),
        ("items", "id INTEGER NOT NULL PRIMARY KEY, code VARCHAR(20), description VARCHAR(40)"),
        ("pallets_items", "id INTEGER NOT NULL PRIMARY KEY, pallet_id INTEGER NOT NULL, item_id INTEGER NOT NULL, quantity INTEGER")
    ];

    /// <summary>
    /// O palete 1 está no local 6, integrado, com o item 10 ('66903015') duas vezes e o 11 uma; o 2 não está integrado; o 3 está noutro
    /// local; o 4 não tem itens.
    /// </summary>
    protected Task ResetJoinTablesAsync()
        => RunAsync(Settings,
        [
            .. JoinTables.Select(table => $"DELETE FROM {Quoted(table.Name)}"),
            .. new[] { "1, 6, 1", "2, 6, 0", "3, 7, 1", "4, 8, 1" }.Select(values => $"INSERT INTO {Quoted("pallets")} VALUES ({values})"),
            .. new[] { "10, '66903015', 'parafuso'", "11, '11111111', 'porca'" }.Select(values => $"INSERT INTO {Quoted("items")} VALUES ({values})"),
            .. new[] { "100, 1, 10, 5", "101, 1, 11, 7", "102, 2, 10, 9", "103, 1, 10, 3" }.Select(values => $"INSERT INTO {Quoted("pallets_items")} VALUES ({values})")
        ]);

    protected static T Value<T>(Result<T, DatabaseFailure> result)
    {
        Assert.That(result.IsSuccess, Is.True, result.IsFailure ? $"{result.Error.Kind}: {result.Error.Message}" : null);

        return result.Value;
    }

    protected static string Q(string name)
        => $"\"{name.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    /// <summary>O nome de uma tabela do teste, qualificado e entre aspas, como os Registros o escrevem.</summary>
    protected string Quoted(string table)
        => $"{Q(Schema)}.{Q(Table(table))}";

    protected int Column(QueryPage page, string name)
        => page.Columns.Select(column => column.Name).ToList().IndexOf(Name(name)) is var index and >= 0 ? index : throw new AssertionException($"A coluna {name} não está no resultado.");

    protected async Task<Guid> OpenSessionAsync(ConnectionSettings? settings = null, Guid? connectionID = null)
        => Value(await _service.OpenAsync(connectionID ?? Guid.NewGuid(), settings ?? Settings, _vault.Generation, CancellationToken.None)).ID;

    /// <summary>O comando dos Registros (RN-TABELA-002), em ordem pela primeira coluna.</summary>
    protected async Task<QueryPage> RecordsAsync(Guid session, string table, int pageSize = QueryPaging.DefaultPageSize)
        => Value(await _service.ExecuteAsync(session, $"SELECT * FROM {Quoted(table)}\nORDER BY 1", pageSize, CancellationToken.None)).Page!;

    /// <summary>Os Registros, com o `edit-target` já respondido, como a tela faz na primeira tentativa de editar.</summary>
    protected async Task<QueryPage> EditableRecordsAsync(Guid session, string table)
    {
        var page = await RecordsAsync(session, table);
        Value(await _service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None));

        return page;
    }

    private async Task<(QueryPage Page, EditTarget Target)> TargetAsync(Guid session, string table)
    {
        var page = await RecordsAsync(session, table);

        return (page, Value(await _service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None)));
    }

    /// <summary>A chave e uma coluna de cada linha, por uma conexão à parte, em ordem pela chave.</summary>
    protected async Task<(string, string?)[]> RowsAsync(string table, string column, ConnectionSettings? settings = null)
    {
        await using var connection = Value(await _client.OpenAsync(settings ?? Settings, CancellationToken.None));
        var page = Value(await connection.ExecuteAsync($"SELECT {Q(Name("id"))}, {Q(Name(column))} FROM {Quoted(table)} ORDER BY 1", CancellationToken.None)).Page!;

        return [.. page.Rows.Select(row => (row[0]!, row[1]))];
    }

    protected async Task RunAsync(ConnectionSettings settings, params string[] commands)
    {
        await using var connection = Value(await _client.OpenAsync(settings, CancellationToken.None));

        foreach (var sql in commands)
        {
            var outcome = await connection.ExecuteAsync(sql, CancellationToken.None);
            Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? $"{sql}\n{outcome.Error.Message}" : null);
        }
    }
}
