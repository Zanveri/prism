using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Extensions;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// A edição de registros no Informix 14.10, pela porta DRDA. "Esquema" é o dono, e o nome de tabela é único no banco inteiro: as
/// tabelas do teste têm o nome sorteado. O banco sem log (`prism_sem_log`) grava uma alteração por vez (RN-EDIT-012).
/// </summary>
[TestFixture]
[Category("Databases")]
[Category("Informix")]
public sealed class InformixEditTests : DatabaseEditContractTests
{
    private readonly string _suffix = $"{Guid.NewGuid():N}"[..8];
    private readonly string _owner = $"edi_{Guid.NewGuid():N}"[..14];

    protected override EDatabaseEngine Engine => EDatabaseEngine.Informix;

    protected override string Schema => _owner;

    protected override string? GeneratedColumn => null;

    protected override IEnumerable<string> Setup =>
    [
        $"CREATE TABLE {_owner}.{Table("pedido")} (id INTEGER NOT NULL PRIMARY KEY, status VARCHAR(20), quantidade INTEGER DEFAULT 0 NOT NULL, anexo BYTE)",
        $"CREATE TABLE {_owner}.{Table("sem_chave")} (id INTEGER, status VARCHAR(20))",
        $"CREATE VIEW {_owner}.{Table("resumo")} AS SELECT id, status FROM {_owner}.{Table("pedido")}",
        $"CREATE TABLE {_owner}.{Table("unica")} (id INTEGER, status VARCHAR(20), codigo INTEGER NOT NULL, UNIQUE (codigo))",
        $"CREATE TABLE {_owner}.{Table("tipos")} (id INTEGER NOT NULL PRIMARY KEY, texto VARCHAR(40), inteiro SMALLINT, grande INT8, maior BIGINT, valor DECIMAL(16, 4), dinheiro MONEY(12, 2), flutuante FLOAT, pequeno SMALLFLOAT, dia DATE, hora DATETIME HOUR TO SECOND, momento DATETIME YEAR TO FRACTION(5), logico BOOLEAN, longo LVARCHAR(100))",
        $"INSERT INTO {_owner}.{Table("tipos")} (id) VALUES (1)"
    ];

    protected override IEnumerable<string> Teardown =>
    [
        $"DROP VIEW {_owner}.{Table("resumo")}",
        .. new[] { "pedido", "sem_chave", "unica", "tipos" }.Select(table => $"DROP TABLE {_owner}.{Table(table)}")
    ];

    protected override IReadOnlyList<(string Column, string Written, string Read)> TypeSamples =>
    [
        ("texto", "it's \\ ok", "it's \\ ok"),
        ("inteiro", "-12", "-12"),
        ("grande", "9007199254740993", "9007199254740993"),
        ("maior", "-9007199254740993", "-9007199254740993"),
        ("valor", "1234.5678", "1234.5678"),
        ("dinheiro", "12.50", "12.50"),
        ("flutuante", "0.1", "0.1"),
        ("pequeno", "0.5", "0.5"),
        ("dia", "2026-10-09", "2026-10-09"),
        ("hora", "13:05:07", "13:05:07"),
        ("momento", "2026-10-09 13:05:07.123450", "2026-10-09 13:05:07.123450"),
        ("logico", "1", "1"),
        ("longo", "um texto longo", "um texto longo")
    ];

    protected override Task<ConnectionSettings> StartDatabaseAsync()
        => InformixSingleton.GetSettingsAsync();

    protected override async Task ConfigureAsync(IServiceCollection services)
        => services.UseDriverSource(directory: await IbmDriverSingleton.GetDirectoryAsync());

    /// <summary>O limite de linhas do Informix vai na cabeça do `SELECT`.</summary>
    protected override string WithFirstRows(string select, int rows)
        => $"SELECT FIRST {rows} {select["SELECT ".Length..]}";

    protected override string? ReadOnlyClause => "FOR READ ONLY";

    /// <summary>O padrão do Informix não espera pela trava de outra sessão: recusa na hora ("record is locked").</summary>
    protected override string? WaitForLocksSql => "SET LOCK MODE TO WAIT";

    protected override string Name(string name)
        => name;

    protected override string Table(string name)
        => $"{name}_{_suffix}";

    /// <summary>Sem o dono, como o comando do dono escreve: num banco que não é ANSI o nome da tabela é único no banco inteiro.</summary>
    protected override string JoinFrom(string table)
        => Table(table);

    /// <summary>RN-EDIT-002 e 003: a junção `, OUTER tabela` do Informix se edita como as outras, cada coluna na tabela de onde veio.</summary>
    [Test]
    public async Task Edits_OfTheInformixOuterJoin_SaveEachTableByItsKey()
    {
        await ResetJoinTablesAsync();
        var session = await OpenSessionAsync();
        var page = Value(await Service.ExecuteAsync(session, $"SELECT p.id, p.location_id, pi.id AS item_row, pi.quantity FROM {Table("pallets")} p, OUTER {Table("pallets_items")} pi WHERE pi.pallet_id = p.id AND p.id IN (1, 4) ORDER BY 1, 3", QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;
        Assert.That(page.Rows, Has.Count.EqualTo(4));

        var target = Value(await Service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None));
        Assert.That(target.Tables.Select(table => (table.Name, table.Editable, table.Key.Single())), Is.EqualTo(new[] { (Table("pallets"), true, 0), (Table("pallets_items"), true, 2) }));
        Assert.That(target.Columns.Select(column => column.Editable), Is.EqualTo(new[] { false, true, false, true }));

        var applied = await Service.ApplyEditsAsync(session, page.ResultID.Value, [new EditChange(EEditKind.Update, 0, ["4"], [new EditValue(Column(page, "location_id"), "9")]), new EditChange(EEditKind.Update, 1, ["101"], [new EditValue(Column(page, "quantity"), "70")])], CancellationToken.None);

        Assert.That(Value(applied), Is.EqualTo(2));
        Assert.That(await RowsAsync("pallets", "location_id"), Does.Contain(("4", (string?)"9")));
        Assert.That(await RowsAsync("pallets_items", "quantity"), Does.Contain(("101", (string?)"70")));
    }

    /// <summary>
    /// RN-EDIT-006: o texto de mais de 16.350 caracteres num `LVARCHAR`, que o driver da IBM mandaria como `CLOB` e o Informix recusaria ("No cast from
    /// text to lvarchar"), é gravado inteiro.
    /// </summary>
    [Test]
    public async Task Edits_OfALongLvarchar_SaveTheWholeText()
    {
        var table = Table("longo");
        await RunAsync(Settings, $"CREATE TABLE {_owner}.{table} (id INTEGER NOT NULL PRIMARY KEY, texto LVARCHAR(20000))", $"INSERT INTO {_owner}.{table} (id) VALUES (1)");

        try
        {
            var session = await OpenSessionAsync();
            var page = await EditableRecordsAsync(session, "longo");

            var applied = await Service.ApplyEditsAsync(session, page.ResultID!.Value, [new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(Column(page, "texto"), new string('x', 20_000))])], CancellationToken.None);

            Assert.That(applied.IsSuccess, Is.True, applied.IsFailure ? applied.Error.Message : null);
            var read = Value(await Service.ExecuteAsync(session, $"SELECT LENGTH(texto) FROM {Quoted("longo")}", QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;
            Assert.That(read.Rows[0][0], Is.EqualTo("20000"));
        }
        finally
        {
            await RunAsync(Settings, $"DROP TABLE {_owner}.{table}");
        }
    }

    /// <summary>
    /// RN-EDIT-012: sem log de transação, o "Salvar" grava uma alteração por vez, cada uma confirmada sozinha, e para na primeira que
    /// falha: as anteriores ficam gravadas, e a recusa diz quantas (`Applied`).
    /// </summary>
    [Test]
    public async Task Edits_InADatabaseWithoutLog_AreSavedOneAtATime()
    {
        var unlogged = Settings with { Database = InformixSingleton.UnloggedDatabase };
        var table = $"semlog_{_suffix}";
        await RunAsync(unlogged, [$"CREATE TABLE {_owner}.{table} (id INTEGER NOT NULL PRIMARY KEY, status VARCHAR(20))", .. Enumerable.Range(1, 3).Select(id => $"INSERT INTO {_owner}.{table} VALUES ({id}, 'aberta')")]);

        try
        {
            var session = await OpenSessionAsync(unlogged);
            var page = Value(await Service.ExecuteAsync(session, $"SELECT * FROM {Q(_owner)}.{Q(table)} ORDER BY 1", QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;
            var target = Value(await Service.GetEditTargetAsync(session, page.ResultID!.Value, null, CancellationToken.None));
            Assert.That(target.OneAtATime, Is.True);

            var status = Column(page, "status");
            var applied = await Service.ApplyEditsAsync(session, page.ResultID.Value, [new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(status, "gravada")]), new EditChange(EEditKind.Update, 0, ["999"], [new EditValue(status, "sumiu")]), new EditChange(EEditKind.Update, 0, ["2"], [new EditValue(status, "pendente")])], CancellationToken.None);

            Assert.That((applied.Error.Kind, applied.Error.Change, applied.Error.RowsAffected, applied.Error.Applied), Is.EqualTo((EDatabaseFailure.EditRowMismatch, (int?)1, (long?)0, (int?)1)));

            var read = Value(await Service.ExecuteAsync(session, $"SELECT * FROM {Q(_owner)}.{Q(table)} ORDER BY 1", QueryPaging.DefaultPageSize, CancellationToken.None)).Page!;
            Assert.That(read.Rows.Select(row => row[status]), Is.EqualTo(new[] { "gravada", "aberta", "aberta" }));
        }
        finally
        {
            await RunAsync(unlogged, $"DROP TABLE {_owner}.{table}");
        }
    }
    /// <summary>
    /// RN-EDIT-020: no Informix, o comando com `LIMIT` (ou `OFFSET`, `FETCH`) no fim, no nível de fora, não cabe numa tabela derivada; a contagem lê as
    /// chaves do próprio comando, e o "Salvar" altera em lotes, pelas chaves lidas de novo dentro da transação.
    /// </summary>
    [Test]
    public async Task WholeColumn_WithALimitAtTheEnd_GoesThroughTheKeys()
    {
        foreach (var sql in new[] { $"SELECT * FROM {Quoted("pedido")} ORDER BY 1 LIMIT 2" })
        {
            var session = await OpenSessionAsync();
            var page = await EditableAsync(session, sql);
            var status = Column(page, "status");
            EditChange change = new(EEditKind.UpdateAll, 0, [], [new EditValue(status, "lote")]);

            var preview = Value(await Service.PreviewEditsAsync(session, page.ResultID!.Value, [change], CancellationToken.None));
            Assert.That(preview.Statements.Select(statement => (statement.Sql, statement.Note)), Is.EqualTo(new[] { (sql, (string?)CountNote), ($"UPDATE {Quoted("pedido")} SET \"status\" = 'lote' WHERE \"id\" IN (?, ?, …)", BatchNote) }), sql);

            var counted = Value(await Service.CountWholeColumnAsync(session, page.ResultID.Value, [change], CancellationToken.None));
            Assert.That(counted, Is.EqualTo(2), sql);
            Assert.That(Value(await Service.ApplyEditsAsync(session, page.ResultID.Value, [change with { Rows = counted }], CancellationToken.None)), Is.EqualTo(1), sql);
            Assert.That(await RowsAsync("pedido", "status"), Is.EqualTo(new[] { ("1", (string?)"lote"), ("2", "lote"), ("3", "fechada") }), sql);
        }
    }

    /// <summary>
    /// A sonda S-COL-1 no Informix: dentro de uma tabela derivada, o `LIMIT`, o `OFFSET` e o `FETCH` do fim são recusados pelo banco; o `LIMIT` logo depois
    /// do `SELECT`, como o `SKIP` e o `FIRST`, não (a especificação o mandava para o caminho por lotes até a sonda decidir).
    /// </summary>
    [Test]
    public async Task Probe_TheLimitAtTheEndInsideADerivedTable_IsRefused_AndTheOneAtTheHeadIsNot()
    {
        await using var connection = Value(await Client.OpenAsync(Settings, CancellationToken.None));

        foreach (var inner in new[] { $"SELECT * FROM {Quoted("pedido")} ORDER BY 1 LIMIT 2", $"SELECT * FROM {Quoted("pedido")} ORDER BY 1 OFFSET 1", $"SELECT * FROM {Quoted("pedido")} ORDER BY 1 FETCH FIRST 2 ROWS ONLY" })
        {
            var counted = await connection.ExecuteAsync($"SELECT COUNT(*) FROM (\n{inner}\n) AS \"q\"", CancellationToken.None);
            TestContext.Out.WriteLine($"{inner}: {(counted.IsSuccess ? counted.Value.Page!.Rows[0][0] : counted.Error.Message)}");
            Assert.That(counted.IsFailure, Is.True, inner);
        }

        foreach (var (inner, rows) in new[] { ($"SELECT LIMIT 2 * FROM {Quoted("pedido")} ORDER BY 1", "2"), ($"SELECT SKIP 1 LIMIT 5 * FROM {Quoted("pedido")} ORDER BY 1", "2"), ($"SELECT SKIP 1 FIRST 5 * FROM {Quoted("pedido")} ORDER BY 1", "2") })
        {
            var counted = Value(await connection.ExecuteAsync($"SELECT COUNT(*) FROM (\n{inner}\n) AS \"q\"", CancellationToken.None));
            Assert.That(counted.Page!.Rows[0][0], Is.EqualTo(rows), inner);
        }
    }

    /// <summary>RN-EDIT-020 e a sonda S-COL-1: o `LIMIT` logo depois do `SELECT` vai pela forma pela chave, como o `FIRST`, e o `UPDATE` altera só as linhas do comando.</summary>
    [Test]
    public async Task WholeColumn_WithALimitAtTheHead_IsSavedByTheKey()
    {
        var session = await OpenSessionAsync();
        var sql = $"SELECT LIMIT 2 * FROM {Quoted("pedido")} ORDER BY 1";
        var page = await EditableAsync(session, sql);
        EditChange change = new(EEditKind.UpdateAll, 0, [], [new EditValue(Column(page, "status"), "cabeça")]);

        var preview = Value(await Service.PreviewEditsAsync(session, page.ResultID!.Value, [change], CancellationToken.None));
        Assert.That(preview.Statements[0].Sql, Is.EqualTo($"SELECT COUNT(*) FROM (\n{sql}\n) AS \"q\""));

        var counted = Value(await Service.CountWholeColumnAsync(session, page.ResultID.Value, [change], CancellationToken.None));
        Assert.That(counted, Is.EqualTo(2));
        Assert.That(Value(await Service.ApplyEditsAsync(session, page.ResultID.Value, [change with { Rows = counted }], CancellationToken.None)), Is.EqualTo(1));
        Assert.That(await RowsAsync("pedido", "status"), Is.EqualTo(new[] { ("1", (string?)"cabeça"), ("2", "cabeça"), ("3", "fechada") }));
    }

    /// <summary>
    /// RN-EDIT-012 e 021: sem log de transação, a contagem e o `UPDATE` da coluna inteira são comandos separados, e o `UPDATE` é gravado sozinho; a contagem
    /// que mudou desde a pergunta não grava nada; a chave de várias colunas vai por `EXISTS`, também ali.
    /// </summary>
    [Test]
    public async Task WholeColumn_InADatabaseWithoutLog_IsSavedAlone_AndTheChangedCountWritesNothing()
    {
        var unlogged = Settings with { Database = InformixSingleton.UnloggedDatabase };
        var table = $"todas_{_suffix}";
        await RunAsync(unlogged, [$"CREATE TABLE {_owner}.{table} (loja INTEGER NOT NULL, numero INTEGER NOT NULL, status VARCHAR(20), PRIMARY KEY (loja, numero))", .. new[] { "1, 1", "1, 2", "2, 1" }.Select(key => $"INSERT INTO {_owner}.{table} VALUES ({key}, 'aberta')")]);

        try
        {
            var session = await OpenSessionAsync(unlogged);
            var page = await EditableAsync(session, $"SELECT * FROM {Q(_owner)}.{Q(table)} WHERE loja = 1");
            EditChange change = new(EEditKind.UpdateAll, 0, [], [new EditValue(Column(page, "status"), "sem log")]);

            var counted = Value(await Service.CountWholeColumnAsync(session, page.ResultID!.Value, [change], CancellationToken.None));
            Assert.That(counted, Is.EqualTo(2));

            await RunAsync(unlogged, $"INSERT INTO {_owner}.{table} VALUES (1, 3, 'nova')");
            var refused = await Service.ApplyEditsAsync(session, page.ResultID.Value, [change with { Rows = counted }], CancellationToken.None);
            Assert.That((refused.Error.Kind, refused.Error.Message, refused.Error.Applied), Is.EqualTo((EDatabaseFailure.ResultChanged, CountChanged(3, 2), (int?)0)));

            Assert.That(Value(await Service.ApplyEditsAsync(session, page.ResultID.Value, [change with { Rows = 3 }], CancellationToken.None)), Is.EqualTo(1));
            var rows = await ReadAsync($"SELECT loja, numero, status FROM {_owner}.{table} ORDER BY 1, 2", unlogged);
            Assert.That(rows.Select(row => string.Join(",", row)), Is.EqualTo(new[] { "1,1,sem log", "1,2,sem log", "1,3,sem log", "2,1,aberta" }));
        }
        finally
        {
            await RunAsync(unlogged, $"DROP TABLE {_owner}.{table}");
        }
    }
}
