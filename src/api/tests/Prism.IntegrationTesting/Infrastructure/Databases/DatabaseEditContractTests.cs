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

        await RunAsync(Settings, [.. Setup]);
    }

    [OneTimeTearDown]
    public async Task StopAsync()
    {
        await using (var connection = Value(await _client.OpenAsync(Settings, CancellationToken.None)))
        {
            foreach (var sql in Teardown)
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
