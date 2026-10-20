using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.TestingCore.Extensions;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// RN-EDIT-019 a 023 contra o banco de verdade, pelo registro de sessões: a coluna inteira conta e grava as linhas que o comando do resultado devolve no
/// momento do "Salvar", nas três formas da RN-EDIT-020 (a direta, a pela chave e, no Informix, a por lotes), recusa o "Salvar" quando o resultado mudou desde
/// a contagem, e para no cancelamento e na trava de outra sessão sem gravar nada. Os testes marcados "sonda S-COL-1" decidem o que a especificação deixou
/// para provar no banco.
/// </summary>
public abstract partial class DatabaseEditContractTests
{
    /// <summary>A sonda S-COL-1: a tabela derivada aceita, na contagem e no `UPDATE`, o resultado com duas colunas de mesmo nome que não são da chave.</summary>
    protected virtual bool AcceptsRepeatedNamesInADerivedTable => true;

    /// <summary>RN-EDIT-021: o "Salvar" com a coluna inteira é de um retrato só (o Repeatable read do PostgreSQL), e a linha que outra sessão mudou depois dele é a recusa 40001.</summary>
    protected virtual bool SavesInASnapshot => false;

    /// <summary>O comando que faz a sessão esperar pela trava de outra, em vez de recusar na hora (o padrão do Informix); nulo onde ela já espera.</summary>
    protected virtual string? WaitForLocksSql => null;

    /// <summary>As frases da seção 38 que a tela mostra como vieram, escritas aqui de propósito: mudar uma delas é mudar o contrato.</summary>
    protected const string CountNote = "A contagem confere, antes do UPDATE, que o comando ainda devolve as linhas confirmadas.";
    protected const string BatchNote = "As chaves vão em lotes de até 1.000.";
    private const string JoinReason = "num resultado de junção, a coluna inteira não se altera: escolha as células da coluna (arraste, ou Shift+clique), e a edição vale para elas";
    private const string LimitReason = "o comando limita as linhas sem uma ordem, e o banco pode escolher outras linhas ao executar de novo: acrescente um ORDER BY, ou escolha as células da coluna";

    protected static string CountChanged(int counted, int confirmed)
        => $"O resultado mudou desde a contagem: o comando devolve agora {counted} linhas, e não as {confirmed} confirmadas. Nada foi gravado; salve de novo para contar outra vez.";

    private static string KeyReason(string column, string table)
        => $"{column} é da chave de {table}: na coluna inteira, todas as linhas ficariam com a mesma chave";

    protected IDatabaseClient Client => _client;

    private static EditChange All(int column, string? value, long? rows = null)
        => new(EEditKind.UpdateAll, 0, [], [new EditValue(column, value)], rows);

    /// <summary>Executa o comando na sessão e responde o alvo da edição dele, como a tela faz antes de editar.</summary>
    protected async Task<QueryPage> EditableAsync(Guid session, string sql)
    {
        var page = Value(await Service.ExecuteAsync(session, sql, QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;
        Value(await Service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None));

        return page;
    }

    /// <summary>As linhas de um comando, por uma conexão à parte.</summary>
    protected async Task<string?[][]> ReadAsync(string sql, ConnectionSettings? settings = null)
    {
        await using var connection = Value(await _client.OpenAsync(settings ?? Settings, CancellationToken.None));

        return [.. Value(await connection.ExecuteAsync(sql, CancellationToken.None)).Page!.Rows];
    }

    /// <summary>
    /// RN-EDIT-020, forma direta, e a sonda S-COL-1: o `UPDATE` que altera a coluna que a condição usa (`WHERE quantidade > 1` com `SET quantidade = 0`)
    /// altera as linhas que a condição achava antes dele, e só elas.
    /// </summary>
    [Test]
    public async Task WholeColumn_OfTheRecords_ChangesTheRowsTheConditionFoundBeforeTheUpdate()
    {
        var session = await OpenSessionAsync();
        var quantidade = Q(Name("quantidade"));
        var page = await EditableAsync(session, $"SELECT * FROM {Quoted("pedido")}\nWHERE {quantidade} > 1\nORDER BY 1");
        var column = Column(page, "quantidade");

        var preview = Value(await Service.PreviewEditsAsync(session, page.ResultID!.Value, [All(column, "0")], CancellationToken.None));
        Assert.That(preview.Statements.Select(statement => (statement.Sql, statement.Note)), Is.EqualTo(new[] { ($"SELECT COUNT(*) FROM {Quoted("pedido")} WHERE {quantidade} > 1\n", (string?)CountNote), ($"UPDATE {Quoted("pedido")} SET {quantidade} = 0 WHERE {quantidade} > 1\n", null) }));

        var counted = Value(await Service.CountWholeColumnAsync(session, page.ResultID.Value, [All(column, "0")], CancellationToken.None));
        Assert.That(counted, Is.EqualTo(2));

        Assert.That(Value(await Service.ApplyEditsAsync(session, page.ResultID.Value, [All(column, "0", counted)], CancellationToken.None)), Is.EqualTo(1));
        Assert.That(await RowsAsync("pedido", "quantidade"), Is.EqualTo(new[] { ("1", (string?)"1"), ("2", "0"), ("3", "0") }));
    }

    /// <summary>RN-EDIT-020: sem filtro, a forma direta é o `UPDATE` sem `WHERE`, e altera todas as linhas; a coluna inteira e uma alteração por linha vão juntas, a coluna inteira primeiro.</summary>
    [Test]
    public async Task WholeColumn_WithoutAFilter_ChangesEveryRow_BeforeTheRowEdits()
    {
        var session = await OpenSessionAsync();
        var page = await EditableAsync(session, $"SELECT * FROM {Quoted("pedido")}");
        var status = Column(page, "status");

        var counted = Value(await Service.CountWholeColumnAsync(session, page.ResultID!.Value, [All(status, "todas")], CancellationToken.None));
        var applied = await Service.ApplyEditsAsync(session, page.ResultID.Value, [new EditChange(EEditKind.Update, 0, ["2"], [new EditValue(status, "a dois")]), All(status, "todas", counted)], CancellationToken.None);

        Assert.That((counted, Value(applied)), Is.EqualTo((3L, 2)));
        Assert.That(await RowsAsync("pedido", "status"), Is.EqualTo(new[] { ("1", (string?)"todas"), ("2", "a dois"), ("3", "todas") }));
    }

    /// <summary>
    /// RN-EDIT-020, forma pela chave: a coluna da chave vai pelo nome que ela tem no resultado (`AS codigo`), com `"q".` na frente, e o `UPDATE` altera só
    /// as linhas do comando. O limite de linhas com `ORDER BY` fica dentro da tabela derivada (`LIMIT`, `FETCH FIRST`, o `FIRST` da cabeça do Informix).
    /// </summary>
    [Test]
    public async Task WholeColumn_ByTheKey_FindsTheRowsByTheKeyAsTheResultNamesIt()
    {
        var session = await OpenSessionAsync();
        var (id, status, quantidade, codigo) = (Q(Name("id")), Q(Name("status")), Q(Name("quantidade")), Q(Name("codigo")));
        var page = await EditableAsync(session, WithFirstRows($"SELECT p.{id} AS {codigo}, p.{status}, p.{quantidade} FROM {Quoted("pedido")} p WHERE p.{quantidade} > 1 ORDER BY 1", 10));
        var column = Column(page, "status");

        var preview = Value(await Service.PreviewEditsAsync(session, page.ResultID!.Value, [All(column, "q")], CancellationToken.None));
        Assert.That(preview.Statements[1].Sql, Does.Contain($"WHERE {id} IN (SELECT \"q\".{codigo} FROM (\n"));

        var counted = Value(await Service.CountWholeColumnAsync(session, page.ResultID.Value, [All(column, "q")], CancellationToken.None));
        Assert.That(counted, Is.EqualTo(2));
        Assert.That(Value(await Service.ApplyEditsAsync(session, page.ResultID.Value, [All(column, "q", counted)], CancellationToken.None)), Is.EqualTo(1));
        Assert.That(await RowsAsync("pedido", "status"), Is.EqualTo(new[] { ("1", (string?)"aberta"), ("2", "q"), ("3", "q") }));

        // A sonda S-COL-1: o `UPDATE` pela chave que altera a coluna que a condição do comando usa (`quantidade > 1` com `SET quantidade = 0`), com a
        // tabela derivada sobre a mesma tabela, altera as linhas que o comando devolvia antes dele.
        var again = await EditableAsync(session, WithFirstRows($"SELECT p.{id} AS {codigo}, p.{status}, p.{quantidade} FROM {Quoted("pedido")} p WHERE p.{quantidade} > 1 ORDER BY 1", 10));
        var zero = All(Column(again, "quantidade"), "0");
        var recounted = Value(await Service.CountWholeColumnAsync(session, again.ResultID!.Value, [zero], CancellationToken.None));
        Assert.That(Value(await Service.ApplyEditsAsync(session, again.ResultID.Value, [zero with { Rows = recounted }], CancellationToken.None)), Is.EqualTo(1));
        Assert.That(await RowsAsync("pedido", "quantidade"), Is.EqualTo(new[] { ("1", (string?)"1"), ("2", "0"), ("3", "0") }));
    }

    /// <summary>
    /// A sonda da RN-EDIT-020, refeita em cada banco: numa tabela derivada, a coluna sem qualificação que o comando não devolve é procurada na tabela do
    /// `UPDATE`, sem erro, e o `IN` casa com TODAS as linhas; com `"q".`, a mesma coluna é a recusa do banco, e nada muda. É por isso que o Prism sempre
    /// escreve `"q".` (e o nome da chave no resultado).
    /// </summary>
    [Test]
    public async Task Probe_TheUnqualifiedKeyInTheDerivedTable_MatchesEveryRow_AndTheQualifiedOneIsRefused()
    {
        var (id, status, quantidade, codigo) = (Q(Name("id")), Q(Name("status")), Q(Name("quantidade")), Q(Name("codigo")));
        var derived = $"(SELECT {id} AS {codigo} FROM {Quoted("pedido")} WHERE {quantidade} > 1) AS \"q\"";

        await using (var connection = Value(await _client.OpenAsync(Settings, CancellationToken.None)))
        {
            var qualified = await connection.ExecuteAsync($"UPDATE {Quoted("pedido")} SET {status} = 'qualificada' WHERE {id} IN (SELECT \"q\".{id} FROM {derived})", CancellationToken.None);
            Assert.That(qualified.IsFailure, Is.True, "a coluna que o comando não devolve, com \"q\"., é erro do banco");

            var unqualified = Value(await connection.ExecuteAsync($"UPDATE {Quoted("pedido")} SET {status} = 'todas' WHERE {id} IN (SELECT {id} FROM {derived})", CancellationToken.None));
            Assert.That(unqualified.RowsAffected, Is.EqualTo(3), "sem \"q\"., o IN casa com todas as linhas da tabela, e não com as 2 do comando");
        }

        Assert.That((await RowsAsync("pedido", "status")).Select(row => row.Item2), Is.All.EqualTo("todas"));
    }

    /// <summary>RN-EDIT-020 e a sonda S-COL-1: a chave de várias colunas vai por `EXISTS`, com a tabela (com o esquema, ou o dono) como `"u"`, nos três bancos.</summary>
    [Test]
    public async Task WholeColumn_WithACompositeKey_UsesExistsWithTheTableAsU()
    {
        await RunAsync(Settings, [$"DELETE FROM {Quoted("composta")}", .. new[] { "1, 1, 0", "1, 2, 0", "2, 1, 0" }.Select(values => $"INSERT INTO {Quoted("composta")} VALUES ({values})")]);
        var session = await OpenSessionAsync();
        var page = await EditableAsync(session, WithFirstRows($"SELECT * FROM {Quoted("composta")} ORDER BY 1, 2", 2));
        var total = Column(page, "total");

        var preview = Value(await Service.PreviewEditsAsync(session, page.ResultID!.Value, [All(total, "9")], CancellationToken.None));
        Assert.That(preview.Statements[1].Sql, Does.StartWith($"UPDATE {Quoted("composta")} AS \"u\" SET {Q(Name("total"))} = 9\nWHERE EXISTS (SELECT 1 FROM (\n"));

        var counted = Value(await Service.CountWholeColumnAsync(session, page.ResultID.Value, [All(total, "9")], CancellationToken.None));
        Assert.That(counted, Is.EqualTo(2));
        Assert.That(Value(await Service.ApplyEditsAsync(session, page.ResultID.Value, [All(total, "9", counted)], CancellationToken.None)), Is.EqualTo(1));

        var rows = await ReadAsync($"SELECT {Q(Name("loja"))}, {Q(Name("numero"))}, {Q(Name("total"))} FROM {Quoted("composta")} ORDER BY 1, 2");
        Assert.That(rows.Select(row => string.Join(",", row)), Is.EqualTo(new[] { "1,1,9", "1,2,9", "2,1,0" }));
    }

    /// <summary>
    /// RN-EDIT-021: outra sessão gravou entre a contagem da pergunta e o "Salvar": a contagem de dentro do "Salvar" não dá as linhas confirmadas, a API
    /// responde `RESULT_CHANGED` com o detalhe da regra, e nada é executado. A contagem seguinte já vê a linha nova.
    /// </summary>
    [Test]
    public async Task WholeColumn_WhenTheResultChangedSinceTheCount_IsRefused_AndWritesNothing()
    {
        var session = await OpenSessionAsync();
        var page = await EditableAsync(session, $"SELECT * FROM {Quoted("pedido")}\nORDER BY 1");
        var status = Column(page, "status");
        var counted = Value(await Service.CountWholeColumnAsync(session, page.ResultID!.Value, [All(status, "paga")], CancellationToken.None));

        await RunAsync(Settings, $"INSERT INTO {Quoted("pedido")} ({Q(Name("id"))}, {Q(Name("status"))}) VALUES (4, 'nova')");
        var saved = await Service.ApplyEditsAsync(session, page.ResultID.Value, [All(status, "paga", counted)], CancellationToken.None);
        var again = Value(await Service.CountWholeColumnAsync(session, page.ResultID.Value, [All(status, "paga")], CancellationToken.None));

        Assert.That((saved.Error.Kind, saved.Error.Message), Is.EqualTo((EDatabaseFailure.ResultChanged, CountChanged(4, 3))));
        Assert.That(again, Is.EqualTo(4));
        Assert.That((await RowsAsync("pedido", "status")).Select(row => row.Item2), Is.EqualTo(new[] { "aberta", "aberta", "fechada", "nova" }));
    }

    /// <summary>RN-EDIT-018 e 023: a API confere de novo o que a tela confere, antes de qualquer comando ir ao banco: a junção, a coluna da chave e o limite sem ordem.</summary>
    [Test]
    public async Task WholeColumn_IsRefused_WhereTheRuleSaysSo()
    {
        await ResetJoinTablesAsync();
        var session = await OpenSessionAsync();
        var join = await EditableAsync(session, $"SELECT pi.id, pi.quantity, p.location_id FROM {JoinFrom("pallets_items")} pi JOIN {JoinFrom("pallets")} p ON p.id = pi.pallet_id ORDER BY 1");
        var joined = await Service.CountWholeColumnAsync(session, join.ResultID!.Value, [All(1, "1")], CancellationToken.None);

        var records = await EditableAsync(session, $"SELECT * FROM {Quoted("pedido")}");
        var key = await Service.CountWholeColumnAsync(session, records.ResultID!.Value, [All(Column(records, "id"), "1")], CancellationToken.None);

        var limited = await EditableAsync(session, WithFirstRows($"SELECT * FROM {Quoted("pedido")}", 2));
        var unordered = await Service.ApplyEditsAsync(session, limited.ResultID!.Value, [All(Column(limited, "status"), "x", 2)], CancellationToken.None);

        Assert.That(new[] { joined.Error, key.Error, unordered.Error }.Select(failure => (failure.Kind, failure.Reason)), Is.EqualTo(new[] { (EDatabaseFailure.EditAllRowsNotSupported, (string?)JoinReason), (EDatabaseFailure.EditAllRowsNotSupported, KeyReason(Name("id"), Table("pedido"))), (EDatabaseFailure.EditAllRowsNotSupported, LimitReason) }));
        Assert.That(key.Error.Column, Is.EqualTo(Column(records, "id")));
        Assert.That((await RowsAsync("pedido", "status")).Select(row => row.Item2), Is.EqualTo(new[] { "aberta", "aberta", "fechada" }));
    }

    /// <summary>
    /// A sonda S-COL-1: o comando com duas colunas de mesmo nome que não são da chave (`SELECT id, status, status`) numa tabela derivada, na contagem e no
    /// `UPDATE`. Onde o banco aceita, grava; onde recusa, a recusa é a dele (nada é gravado).
    /// </summary>
    [Test]
    public async Task Probe_RepeatedNamesThatAreNotTheKey_InTheDerivedTable()
    {
        var session = await OpenSessionAsync();
        var (id, status) = (Q(Name("id")), Q(Name("status")));
        var page = await EditableAsync(session, WithFirstRows($"SELECT {id}, {status}, {status} FROM {Quoted("pedido")} ORDER BY 1", 10));

        var counted = await Service.CountWholeColumnAsync(session, page.ResultID!.Value, [All(1, "repetida")], CancellationToken.None);
        TestContext.Out.WriteLine(counted.IsSuccess ? $"{Engine}: a contagem deu {counted.Value}" : $"{Engine}: a contagem foi recusada: {counted.Error.Message}");
        Assert.That(counted.IsSuccess, Is.EqualTo(AcceptsRepeatedNamesInADerivedTable), counted.IsFailure ? counted.Error.Message : null);

        if (!AcceptsRepeatedNamesInADerivedTable)
        {
            Assert.That(counted.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
            return;
        }

        Assert.That(Value(await Service.ApplyEditsAsync(session, page.ResultID.Value, [All(1, "repetida", counted.Value)], CancellationToken.None)), Is.EqualTo(1));
        Assert.That((await RowsAsync("pedido", "status")).Select(row => row.Item2), Is.All.EqualTo("repetida"));
    }

    /// <summary>RN-SQL-024 e RN-EDIT-023: a coluna inteira de um resultado guardado do script conta e grava depois de outro comando, pelo comando dele.</summary>
    [Test]
    public async Task WholeColumn_OfAKeptResult_IsSavedAfterAnotherCommand()
    {
        var session = await OpenSessionAsync();
        var first = await EditableAsync(session, $"SELECT * FROM {Quoted("pedido")}\nWHERE {Q(Name("id"))} < 3");
        Value(await Service.ExecuteAsync(session, $"SELECT * FROM {Quoted("pedido")}", null, QueryPaging.DefaultPageSize, false, [first.ResultID!.Value], CancellationToken.None));
        var status = Column(first, "status");

        var counted = Value(await Service.CountWholeColumnAsync(session, first.ResultID.Value, [All(status, "guardada")], CancellationToken.None));
        Assert.That(Value(await Service.ApplyEditsAsync(session, first.ResultID.Value, [All(status, "guardada", counted)], CancellationToken.None)), Is.EqualTo(1));

        Assert.That(counted, Is.EqualTo(2));
        Assert.That((await RowsAsync("pedido", "status")).Select(row => row.Item2), Is.EqualTo(new[] { "guardada", "guardada", "fechada" }));
    }

    /// <summary>
    /// RN-EDIT-021: o `UPDATE` da coluna inteira espera pela linha que outra sessão travou, como o banco espera (o Prism não muda o prazo da sessão), e o
    /// "Cancelar" (`queries/cancel`) o interrompe: `SQL_EXECUTION_FAILED` com `outcome: canceled`, nada gravado, e a sessão segue servindo.
    /// </summary>
    [Test]
    public async Task WholeColumn_WaitingForALock_IsCanceled_AndWritesNothing()
    {
        var session = await OpenSessionAsync();
        if (WaitForLocksSql is { } wait)
            Value(await Service.ExecuteAsync(session, wait, QueryPaging.DefaultPageSize, CancellationToken.None));

        var page = await EditableAsync(session, $"SELECT * FROM {Quoted("pedido")}");
        var status = Column(page, "status");
        var counted = Value(await Service.CountWholeColumnAsync(session, page.ResultID!.Value, [All(status, "travada")], CancellationToken.None));

        await using (var holder = Value(await _client.OpenAsync(Settings, CancellationToken.None)))
        {
            Assert.That((await holder.BeginLoadTransactionAsync(CancellationToken.None)).IsSuccess, Is.True);
            Assert.That((await holder.EmptyTableAsync(Schema, Table("pedido"), CancellationToken.None)).IsSuccess, Is.True);

            var saving = Service.ApplyEditsAsync(session, page.ResultID.Value, [All(status, "travada", counted)], CancellationToken.None);
            await Task.WhenAny(saving, Task.Delay(TimeSpan.FromSeconds(2)));
            Assert.That(saving.IsCompleted, Is.False, saving.IsCompleted ? $"o Salvar não esperou pela trava: {(saving.Result.IsSuccess ? "gravou" : saving.Result.Error.Message)}" : null);

            Assert.That(Service.Cancel(session).IsSuccess, Is.True);
            var saved = await saving.WaitAsync(TimeSpan.FromSeconds(30));

            Assert.That((saved.Error.Kind, saved.Error.Outcome), Is.EqualTo((EDatabaseFailure.ExecutionFailed, (ECancelOutcome?)ECancelOutcome.Canceled)), saved.Error.Message);
        }

        Assert.That((await RowsAsync("pedido", "status")).Select(row => row.Item2), Is.EqualTo(new[] { "aberta", "aberta", "fechada" }));
        Assert.That(Value(await Service.CountWholeColumnAsync(session, page.ResultID.Value, [All(status, "travada")], CancellationToken.None)), Is.EqualTo(3));
    }

    /// <summary>
    /// RN-EDIT-021: outra sessão muda as linhas enquanto o `UPDATE` da coluna inteira espera pela trava dela. No PostgreSQL o "Salvar" é de um retrato só
    /// (Repeatable read): a linha que mudou depois dele é a recusa 40001 do banco, como veio. No Db2 e no Informix, que ficam no nível do banco, o `UPDATE`
    /// não altera as linhas confirmadas, e a resposta é `RESULT_CHANGED`. Nos dois, nada da coluna inteira fica.
    /// </summary>
    [Test]
    public async Task WholeColumn_WhenAnotherSessionChangesTheRowsDuringTheWait_WritesNothing()
    {
        var session = await OpenSessionAsync();
        if (WaitForLocksSql is { } wait)
            Value(await Service.ExecuteAsync(session, wait, QueryPaging.DefaultPageSize, CancellationToken.None));

        var page = await EditableAsync(session, $"SELECT * FROM {Quoted("pedido")}");
        var status = Column(page, "status");
        var counted = Value(await Service.CountWholeColumnAsync(session, page.ResultID!.Value, [All(status, "retrato")], CancellationToken.None));

        Result<int, DatabaseFailure> saved;
        await using (var holder = Value(await _client.OpenAsync(Settings, CancellationToken.None)))
        {
            Assert.That((await holder.BeginLoadTransactionAsync(CancellationToken.None)).IsSuccess, Is.True);
            Assert.That((await holder.EmptyTableAsync(Schema, Table("pedido"), CancellationToken.None)).IsSuccess, Is.True);

            var saving = Service.ApplyEditsAsync(session, page.ResultID.Value, [All(status, "retrato", counted)], CancellationToken.None);
            await Task.WhenAny(saving, Task.Delay(TimeSpan.FromSeconds(2)));
            Assert.That(saving.IsCompleted, Is.False, "o Salvar não esperou pela trava");

            Assert.That((await holder.CommitLoadAsync()).IsSuccess, Is.True);
            saved = await saving.WaitAsync(TimeSpan.FromSeconds(30));
        }

        TestContext.Out.WriteLine($"{Engine}: {saved.Error.Kind} {saved.Error.SqlState} {saved.Error.Message}");
        if (SavesInASnapshot)
            Assert.That((saved.Error.Kind, saved.Error.SqlState), Is.EqualTo((EDatabaseFailure.ExecutionFailed, "40001")));
        else
        {
            Assert.That(saved.Error.Kind, Is.EqualTo(EDatabaseFailure.ResultChanged));
            Assert.That(saved.Error.Message, Does.StartWith("O resultado mudou desde a contagem:"));
        }

        Assert.That(await ReadAsync($"SELECT * FROM {Quoted("pedido")}"), Is.Empty);
    }
}
