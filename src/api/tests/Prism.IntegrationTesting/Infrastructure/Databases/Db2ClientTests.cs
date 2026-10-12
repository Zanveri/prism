using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Extensions;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// O driver do Db2 contra um Db2 de verdade: o contrato comum (`DatabaseClientContractTests`), o que é do driver da IBM
/// (`IbmClientContractTests`) e o que só existe neste banco. A categoria `Db2` é a que a pipeline deixa de fora onde não há
/// contêiner privilegiado.
/// </summary>
[TestFixture]
[Category("Databases")]
[Category("Db2")]
public sealed class Db2ClientTests : IbmClientContractTests
{
    protected override EDatabaseEngine Engine => EDatabaseEngine.Db2;

    protected override string SyntaxErrorSqlState => "42601";

    // O valor seguinte de uma sequência só pode ser pedido uma vez por comando num `VALUES` de um `WITH`: é o que soma um por execução.
    protected override string ExecutionCounterSetup => "VALUES NEXT VALUE FOR loja.execucoes";

    protected override string CountedQuery => "WITH execucao (numero) AS (VALUES NEXT VALUE FOR loja.execucoes) SELECT pedido.numero, execucao.numero AS execucao FROM loja.pedido AS pedido, execucao ORDER BY pedido.numero";

    protected override string ExecutionCountQuery => "SELECT PREVIOUS VALUE FOR loja.execucoes FROM SYSIBM.SYSDUMMY1";

    // Sem `TABLE (...)` em volta do `VALUES`: no Db2 todo `SELECT` com `TABLE (` roda até o fim, e esta leitura tem de ficar paginada.
    protected override string LargeReadQuery => "SELECT pedido.numero, REPEAT('x', 500) AS peso FROM loja.pedido AS pedido, (VALUES 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20) AS copia (numero)";

    // Unidades de trabalho em andamento nas outras conexões, mais as travas delas em `LOJA.PEDIDO`. Com o cursor de uma leitura
    // aberto, o Db2 mantém a unidade de trabalho e uma trava de intenção na tabela; fechado o cursor, o driver confirma e as duas somem.
    protected override string PendingWorkQuery => "SELECT (SELECT COUNT(*) FROM TABLE(MON_GET_UNIT_OF_WORK(NULL, -1)) WHERE APPLICATION_HANDLE <> MON_GET_APPLICATION_HANDLE() AND UOW_START_TIME IS NOT NULL AND UOW_STOP_TIME IS NULL) + (SELECT COUNT(*) FROM TABLE(MON_GET_LOCKS(NULL, -1)) AS travas JOIN SYSCAT.TABLES ON SYSCAT.TABLES.TBSPACEID = travas.TBSP_ID AND SYSCAT.TABLES.TABLEID = travas.TAB_FILE_ID WHERE SYSCAT.TABLES.TABSCHEMA = 'LOJA' AND SYSCAT.TABLES.TABNAME = 'PEDIDO' AND travas.APPLICATION_HANDLE <> MON_GET_APPLICATION_HANDLE()) FROM SYSIBM.SYSDUMMY1";

    /// <summary>O Db2 guarda em maiúsculas o nome escrito sem aspas.</summary>
    protected override string Name(string name)
        => name.ToUpperInvariant();

    protected override string WriteReturningRows(string table)
        => $"SELECT numero FROM FINAL TABLE (UPDATE {table} SET versao = 1)";

    // Trezentos caracteres a mais por linha: a gravação é a mesma, e as linhas levam bem mais tempo para voltar.
    protected override string WriteReturningWideRows(string table)
        => $"SELECT numero, REPEAT('x', 300) AS peso FROM FINAL TABLE (UPDATE {table} SET versao = 1)";

    protected override string ForeignKey(string name, string columns, string referenced)
        => $"CONSTRAINT {name} FOREIGN KEY ({columns}) REFERENCES {referenced}";

    protected override string? UncommittedReadIsolation => "SET CURRENT ISOLATION = UR";

    protected override Task<ConnectionSettings> StartDatabaseAsync()
        => Db2Singleton.GetSettingsAsync();

    /// <summary>
    /// RN-CONN-013: a consulta de verificação do Db2 é `SELECT 1 FROM SYSIBM.SYSDUMMY1`. O banco conta as execuções de cada
    /// comando pelo texto, e a contagem deste sobe com o `Ping`.
    /// </summary>
    [Test]
    public async Task Db2_Ping_UsesSysdummy1()
    {
        const string executions = "SELECT COALESCE(SUM(NUM_EXECUTIONS), 0) FROM TABLE(MON_GET_PKG_CACHE_STMT('D', NULL, NULL, -2)) WHERE STMT_TEXT = 'SELECT 1 FROM SYSIBM.SYSDUMMY1'";
        await using var connection = await OpenAsync();
        var before = await ReadFromAnotherConnectionAsync(executions);

        var ping = await connection.PingAsync(CancellationToken.None);
        var after = await ReadFromAnotherConnectionAsync(executions);

        Assert.That(ping.IsSuccess, Is.True, ping.IsFailure ? ping.Error.Message : null);
        Assert.That(after, Is.EqualTo(before + 1));
    }

    [Test]
    public async Task Open_UnknownDatabase_ReturnsConnectionFailedWithSqlState()
    {
        var opened = await Client.OpenAsync(Settings with { Database = "naoexist" }, CancellationToken.None);

        Assert.That(opened.IsFailure, Is.True);
        Assert.That(opened.Error.Kind, Is.EqualTo(EDatabaseFailure.ConnectionFailed));
        Assert.That(opened.Error.Message, Does.Contain("SQL1001N").Or.Contain("SQL30061N"));
        Assert.That(opened.Error.SqlState, Is.Not.Empty);
    }

    [Test]
    public async Task GetSchemas_MarksTheSysSchemasAsSystem()
    {
        await using var connection = await OpenAsync();

        var schemas = await connection.GetSchemasAsync(CancellationToken.None);

        Assert.That(schemas.IsSuccess, Is.True);
        Assert.That(schemas.Value.Select(schema => (schema.Name, schema.IsSystem)), Is.SupersetOf(new[] { ("LOJA", false), ("SYSCAT", true), ("SYSIBM", true), ("SYSPROC", true), ("NULLID", true), ("SQLJ", true) }));
        Assert.That(schemas.Value.TakeWhile(schema => !schema.IsSystem).Select(schema => schema.Name), Is.Ordered.Ascending);
    }

    [Test]
    public async Task GetColumns_ReportsTheDb2TypeNames()
    {
        await using var connection = await OpenAsync();

        var columns = await connection.GetColumnsAsync("LOJA", "PEDIDO", CancellationToken.None);

        Assert.That(columns.IsSuccess, Is.True);
        Assert.That(columns.Value.Select(column => column.Type), Is.EqualTo(new[] { "INTEGER", "INTEGER", "INTEGER", "DECIMAL(12,2)", "TIMESTAMP", "VARCHAR(200)" }));
    }

    /// <summary>RN-SQL-009: a mensagem é a do Db2, com o código dele, e o SQLSTATE vem. O driver da IBM não informa a posição.</summary>
    [Test]
    public async Task Execute_Errors_ReportTheDatabaseMessageAndSqlState()
    {
        await using var connection = await OpenAsync();

        var syntax = await connection.ExecuteAsync("SELECT numero FORM loja.pedido", CancellationToken.None);
        var missing = await connection.ExecuteAsync("SELECT * FROM loja.tabela_que_nao_existe", CancellationToken.None);
        var duplicate = await connection.ExecuteAsync("INSERT INTO loja.cliente (id, nome) VALUES (1, 'Repetido')", CancellationToken.None);

        Assert.That(syntax.Error.Message, Does.Contain("SQL0104N").And.Contain("FORM"));
        Assert.That(syntax.Error.SqlState, Is.EqualTo("42601"));
        Assert.That(syntax.Error.Position, Is.Null);
        Assert.That(missing.Error.Message, Does.Contain("SQL0204N").And.Contain("LOJA.TABELA_QUE_NAO_EXISTE"));
        Assert.That(missing.Error.SqlState, Is.EqualTo("42704"));
        Assert.That(duplicate.Error.Message, Does.Contain("SQL0803N"));
        Assert.That(duplicate.Error.SqlState, Is.EqualTo("23505"));
    }

    /// <summary>
    /// RN-SQL-013: no Db2 quem diz se o comando grava é o texto. Toda forma de `SELECT` sobre uma tabela de mudança de dados
    /// (`FINAL`, `NEW` e `OLD TABLE`, com `UPDATE`, `INSERT` e `DELETE`, direto ou dentro de um `WITH`) roda até o fim: a resposta traz
    /// o total, não há cursor, e a gravação está confirmada.
    /// </summary>
    [TestCase("SELECT numero FROM OLD TABLE (UPDATE {0} SET versao = 2)")]
    [TestCase("SELECT numero FROM NEW TABLE (INSERT INTO {0} (numero, versao) SELECT numero + 5000, 2 FROM loja.pedido)")]
    [TestCase("SELECT numero FROM OLD TABLE (DELETE FROM {0} WHERE numero > 0)")]
    [TestCase("WITH gravadas AS (SELECT numero FROM FINAL TABLE (UPDATE {0} SET versao = 2)) SELECT numero FROM gravadas")]
    [TestCase("select numero from final table (update {0} set versao = 2) -- em minúsculas")]
    public async Task Execute_DataChangeTableReference_RunsToTheEndAndCommits(string command)
    {
        var table = await CreateWriteTableAsync();
        var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync(string.Format(command, table), CancellationToken.None);
        var untouched = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 0 AND numero <= 2000");
        await connection.DisposeAsync();
        await DropAsync(table);

        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);
        Assert.That(outcome.Value.Page!.Rows, Has.Count.EqualTo(200));
        Assert.That(outcome.Value.Page.HasMore, Is.False);
        Assert.That(outcome.Value.Page.TotalRows, Is.EqualTo(1000));
        Assert.That(untouched, Is.EqualTo(command.Contains("INSERT", StringComparison.Ordinal) ? 1000 : 0));
    }

    /// <summary>
    /// Colunas chamadas `updated_at` e `deleted_at`, um texto e um identificador entre aspas com as palavras não fazem de uma leitura
    /// um comando que grava: ela continua paginada.
    /// </summary>
    [Test]
    public async Task Execute_ReadThatOnlyMentionsTheWords_StaysPaged()
    {
        await using var connection = await OpenAsync();

        var page = await ExecutePageAsync(connection, "SELECT numero AS updated_at, 'insert into t; delete' AS texto, numero AS \"update\", numero AS deleted_at /* merge */ FROM loja.pedido -- delete\nORDER BY numero");

        Assert.That(page.Rows, Has.Count.EqualTo(200));
        Assert.That(page.HasMore, Is.True);
        Assert.That(page.TotalRows, Is.Null);
    }

    /// <summary>
    /// RN-SQL-003: no Db2 um comando que começa por `BEGIN` e continua é um bloco composto, e não controle de transação: o banco o
    /// executa e confirma inteiro. `COMMIT`, `ROLLBACK`, `SAVEPOINT` e `RELEASE SAVEPOINT` continuam recusados.
    /// </summary>
    [Test]
    public async Task Execute_CompoundBlock_IsAccepted_AndTransactionControlIsRefused()
    {
        var table = await CreateWriteTableAsync();
        await using var connection = await OpenAsync();

        var atomic = await connection.ExecuteAsync($"BEGIN ATOMIC UPDATE {table} SET versao = 3 WHERE numero = 1001; UPDATE {table} SET versao = 3 WHERE numero = 1002; END", CancellationToken.None);
        var block = await connection.ExecuteAsync($"BEGIN\n  DECLARE alvo INTEGER DEFAULT 1003;\n  UPDATE {table} SET versao = 3 WHERE numero = alvo;\nEND", CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 3");

        var refused = new List<EDatabaseFailure>();
        foreach (var sql in new[] { "COMMIT", "ROLLBACK", "COMMIT WORK", "SAVEPOINT ponto ON ROLLBACK RETAIN CURSORS", "RELEASE SAVEPOINT ponto", "RELEASE TO SAVEPOINT ponto", "ROLLBACK TO SAVEPOINT ponto", "BEGIN", "BEGIN WORK", "/* abre /* de novo */ */ BEGIN TRANSACTION" })
            refused.Add((await connection.ExecuteAsync(sql, CancellationToken.None)).Error.Kind);

        var afterwards = await connection.ExecuteAsync($"UPDATE {table} SET versao = 4 WHERE numero = 1004", CancellationToken.None);
        var seenAfterwards = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 4");
        await DropAsync(table);

        Assert.That(atomic.IsSuccess, Is.True, atomic.IsFailure ? atomic.Error.Message : null);
        Assert.That(block.IsSuccess, Is.True, block.IsFailure ? block.Error.Message : null);
        Assert.That(seen, Is.EqualTo(3));
        Assert.That(refused, Is.All.EqualTo(EDatabaseFailure.TransactionControlNotSupported));
        Assert.That(afterwards.IsSuccess, Is.True, afterwards.IsFailure ? afterwards.Error.Message : null);
        Assert.That(seenAfterwards, Is.EqualTo(1));
    }

    /// <summary>
    /// RN-SESSAO-005: um `CALL` que grava e devolve dois conjuntos de resultados. A resposta traz o primeiro, o segundo é lido e
    /// descartado, e tudo o que o procedimento gravou está confirmado quando ela chega.
    /// </summary>
    [Test]
    public async Task Execute_CallWithTwoResultSets_ReturnsTheFirst_AndCommitsEverything()
    {
        var table = await CreateWriteTableAsync();
        var procedure = $"loja.dois_{Guid.NewGuid():N}";
        await using var connection = await OpenAsync();
        var created = await connection.ExecuteAsync($"CREATE PROCEDURE {procedure} () DYNAMIC RESULT SETS 2 LANGUAGE SQL BEGIN DECLARE primeiro CURSOR WITH RETURN FOR SELECT numero FROM {table} ORDER BY numero; DECLARE segundo CURSOR WITH RETURN FOR SELECT versao FROM {table} WHERE numero <= 1010; UPDATE {table} SET versao = 7; OPEN primeiro; OPEN segundo; END", CancellationToken.None);

        var called = await connection.ExecuteAsync($"CALL {procedure}()", CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 7");
        var ping = await connection.PingAsync(CancellationToken.None);
        await connection.ExecuteAsync($"DROP PROCEDURE {procedure}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(called.IsSuccess, Is.True, called.IsFailure ? called.Error.Message : null);
        Assert.That(called.Value.Page!.Columns.Select(column => column.Name), Is.EqualTo(new[] { "NUMERO" }));
        Assert.That(called.Value.Page.Rows, Has.Count.EqualTo(200));
        Assert.That(called.Value.Page.HasMore, Is.False);
        Assert.That(called.Value.Page.TotalRows, Is.EqualTo(1000));
        Assert.That(seen, Is.EqualTo(1000));
        Assert.That(ping.IsSuccess, Is.True);
    }

    /// <summary>
    /// RN-SQL-006: "contar total" executa o comando de novo, como subconsulta, e nada pode ser gravado outra vez. O `SELECT` com
    /// `TABLE (` não é uma leitura só, e a contagem dele é recusada sem ir ao banco (que também a recusaria: o Db2 não deixa uma
    /// função de tabela que grava ser chamada de dentro de uma subconsulta).
    /// </summary>
    [Test]
    public async Task Count_OfReadThroughATableFunctionThatWrites_IsRefusedAndWritesNothing()
    {
        var table = await CreateWriteTableAsync();
        var function = $"loja.grava_{Guid.NewGuid():N}";
        await using var connection = await OpenAsync();
        var created = await connection.ExecuteAsync($"CREATE FUNCTION {function} () RETURNS TABLE (gravadas INTEGER) LANGUAGE SQL MODIFIES SQL DATA BEGIN ATOMIC UPDATE {table} SET versao = versao + 1; RETURN SELECT 1 FROM SYSIBM.SYSDUMMY1; END", CancellationToken.None);

        var total = await connection.CountAsync($"SELECT gravadas FROM TABLE({function}()) AS gravacao", CancellationToken.None);
        var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao <> 0");
        await connection.ExecuteAsync($"DROP FUNCTION {function}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(total.IsFailure, Is.True);
        Assert.That(total.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(written, Is.Zero);
    }

    /// <summary>
    /// RN-SQL-011, pelo driver de verdade: cada célula como texto, sem perder precisão. `DECIMAL(31)` e `DECFLOAT` não cabem no decimal
    /// do C#, e `TIMESTAMP(12)` não cabe na data dele: lidos pelo tipo do C#, derrubavam o resultado ou perdiam as casas.
    /// </summary>
    [Test]
    public async Task Execute_ReturnsEveryCellAsText_WithoutLosingPrecision()
    {
        await using var connection = await OpenAsync();

        var page = await ExecutePageAsync(connection, "SELECT CAST(99999999999999999999999999999.99 AS DECIMAL(31, 2)) AS exato, CAST(-1234567.50 AS DECIMAL(12, 2)) AS negativo, CAST('1.234567890123456789012345678901234E+100' AS DECFLOAT(34)) AS flutuante, CAST('2026-10-09-13.05.07.123456789012' AS TIMESTAMP(12)) AS instante, CAST('2026-10-09-13.05.07' AS TIMESTAMP(0)) AS segundo, DATE('2026-10-09') AS dia, TIME('13.05.07') AS hora, CAST(9223372036854775807 AS BIGINT) AS inteiro, CAST(0.1 AS DOUBLE) AS aproximado, TRUE AS logico, CAST(NULL AS VARCHAR(10)) AS nulo, CAST('São Paulo ação ç ã é ü €' AS VARCHAR(40)) AS acento, BLOB(X'DEADBEEF') AS binario, CAST(REPEAT('x', 20000) AS CLOB(1M)) AS longo, BLOB(REPEAT(X'00', 100)) AS binario_longo FROM SYSIBM.SYSDUMMY1");

        Assert.That(page.Columns.Select(column => column.Kind), Is.EqualTo(new[] { "number", "number", "number", "datetime", "datetime", "datetime", "datetime", "number", "number", "boolean", "text", "text", "binary", "text", "binary" }));
        Assert.That(page.Columns.Select(column => column.Type), Is.EqualTo(new[] { "DECIMAL", "DECIMAL", "DECFLOAT", "TIMESTAMP", "TIMESTAMP", "DATE", "TIME", "BIGINT", "DOUBLE PRECISION", "BOOLEAN", "VARCHAR", "VARCHAR", "BLOB", "CLOB", "BLOB" }));
        Assert.That(page.Rows[0].Take(13), Is.EqualTo(new[] { "99999999999999999999999999999.99", "-1234567.50", "1.234567890123456789012345678901234E+100", "2026-10-09 13:05:07.123456789012", "2026-10-09 13:05:07", "2026-10-09", "13:05:07", "9223372036854775807", "0.1", "true", null, "São Paulo ação ç ã é ü €", "0xDEADBEEF" }));
        Assert.That(page.Rows[0][13], Is.EqualTo(new string('x', 10000)));
        Assert.That(page.Rows[0][14], Is.EqualTo("0x" + new string('0', 64)));
        Assert.That(page.TruncatedCells, Is.EqualTo(new[] { new[] { 0, 13 }, new[] { 0, 14 } }));
    }

    /// <summary>
    /// RN-SQL-001: o bloco que tem `;` no corpo é um comando só. Um procedimento, uma função e um gatilho de verdade, com comentário
    /// na frente e `;` no fim, passam pela recusa de mais de um comando, são criados e funcionam. O texto que continua depois do fim
    /// do bloco também passa por ela, e quem o recusa é o banco, inteiro: o driver manda o que começa por um bloco como um comando
    /// só, e o Db2 não executa dois comandos num envio. Nada é executado.
    /// </summary>
    [Test]
    public async Task Execute_BlocksWithSemicolonsInTheBody_AreOneStatement_AndAreCreated()
    {
        var table = await CreateWriteTableAsync();
        var suffix = Guid.NewGuid().ToString("N");
        await using var connection = await OpenAsync();

        var procedure = await connection.ExecuteAsync($"-- o procedimento\nCREATE OR REPLACE PROCEDURE loja.p_{suffix} ()\nLANGUAGE SQL\nBEGIN\n  UPDATE {table} SET versao = 1 WHERE numero = 1001;\n  UPDATE {table} SET versao = 1 WHERE numero = 1002;\nEND;", CancellationToken.None);
        var function = await connection.ExecuteAsync($"CREATE FUNCTION loja.f_{suffix} (x INTEGER) RETURNS INTEGER LANGUAGE SQL BEGIN DECLARE dobro INTEGER; SET dobro = x * 2; RETURN dobro; END", CancellationToken.None);
        var trigger = await connection.ExecuteAsync($"CREATE TRIGGER loja.g_{suffix} AFTER INSERT ON {table} FOR EACH ROW BEGIN ATOMIC UPDATE {table} SET versao = 3 WHERE numero = 1003; UPDATE {table} SET versao = 3 WHERE numero = 1004; END -- fim", CancellationToken.None);

        var called = await connection.ExecuteAsync($"CALL loja.p_{suffix}()", CancellationToken.None);
        var computed = await ExecutePageAsync(connection, $"VALUES loja.f_{suffix}(21)");
        var inserted = await connection.ExecuteAsync($"INSERT INTO {table} (numero, versao) VALUES (9001, 0)", CancellationToken.None);
        var byTheProcedure = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        var byTheTrigger = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 3");

        var followed = new List<EDatabaseFailure?>();
        foreach (var sql in new[] { $"BEGIN UPDATE {table} SET versao = 8 WHERE numero = 1008; END; UPDATE {table} SET versao = 8 WHERE numero = 1009", $"CREATE PROCEDURE loja.q_{suffix} () LANGUAGE SQL BEGIN UPDATE {table} SET versao = 8 WHERE numero = 1008; END; UPDATE {table} SET versao = 8 WHERE numero = 1009", $"CREATE PROCEDURE loja.q_{suffix} () LANGUAGE SQL UPDATE {table} SET versao = 8 WHERE numero = 1008; UPDATE {table} SET versao = 8 WHERE numero = 1009" })
        {
            var outcome = await connection.ExecuteAsync(sql, CancellationToken.None);
            followed.Add(outcome.IsFailure ? outcome.Error.Kind : null);
        }

        var afterTheBlocks = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 8");
        var routines = await connection.GetObjectsAsync("LOJA", "routines", CancellationToken.None);
        await connection.ExecuteAsync($"DROP TRIGGER loja.g_{suffix}", CancellationToken.None);
        await connection.ExecuteAsync($"DROP FUNCTION loja.f_{suffix}", CancellationToken.None);
        await connection.ExecuteAsync($"DROP PROCEDURE loja.p_{suffix}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(procedure.IsSuccess, Is.True, procedure.IsFailure ? procedure.Error.Message : null);
        Assert.That(function.IsSuccess, Is.True, function.IsFailure ? function.Error.Message : null);
        Assert.That(trigger.IsSuccess, Is.True, trigger.IsFailure ? trigger.Error.Message : null);
        Assert.That(called.IsSuccess, Is.True, called.IsFailure ? called.Error.Message : null);
        Assert.That(computed.Rows[0][0], Is.EqualTo("42"));
        Assert.That(inserted.IsSuccess, Is.True, inserted.IsFailure ? inserted.Error.Message : null);
        Assert.That(byTheProcedure, Is.EqualTo(2));
        Assert.That(byTheTrigger, Is.EqualTo(2));
        Assert.That(followed, Is.All.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(afterTheBlocks, Is.Zero);
        Assert.That(routines.Value.Select(routine => routine.Name), Has.Member($"P_{suffix}".ToUpperInvariant()));
        Assert.That(routines.Value.Select(routine => routine.Name), Has.Member($"F_{suffix}".ToUpperInvariant()));
        Assert.That(routines.Value.Select(routine => routine.Name), Has.No.Member($"Q_{suffix}".ToUpperInvariant()));
    }

    /// <summary>
    /// RN-SQL-013: uma função de tabela criada com `MODIFIES SQL DATA` grava de dentro de um `SELECT`, e o texto do `SELECT` não tem
    /// nenhuma palavra de gravação. Paginada, a primeira página respondia sucesso com a gravação por confirmar: as outras conexões
    /// viam zero, e o que foi gravado sumia se o cursor não fechasse. Todo `SELECT` com `TABLE (` roda até o fim: a resposta traz o
    /// total, não há cursor, e a gravação está confirmada quando ela chega.
    /// </summary>
    [TestCase("SELECT numero FROM TABLE({0}()) AS gravacao")]
    [TestCase("select numero from table  (\n  {0}()\n) as gravacao")]
    [TestCase("SELECT numero FROM TABLE /* a função */ ({0}()) AS gravacao")]
    public async Task Execute_ReadThroughATableFunctionThatWrites_RunsToTheEndAndCommits(string query)
    {
        var table = await CreateWriteTableAsync();
        var function = $"loja.grava_{Guid.NewGuid():N}";
        var connection = await OpenAsync();
        var created = await connection.ExecuteAsync($"CREATE FUNCTION {function} () RETURNS TABLE (numero INTEGER) LANGUAGE SQL MODIFIES SQL DATA BEGIN ATOMIC UPDATE {table} SET versao = versao + 1; RETURN SELECT numero FROM {table}; END", CancellationToken.None);

        var outcome = await connection.ExecuteAsync(string.Format(query, function), CancellationToken.None);
        var seenWhenTheResponseArrives = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        var committedWhenTheResponseArrives = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        var next = await connection.FetchNextAsync(CancellationToken.None);
        await connection.DisposeAsync();
        var seenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        await using (var cleaner = await OpenAsync())
            await cleaner.ExecuteAsync($"DROP FUNCTION {function}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);
        Assert.That(outcome.Value.Page!.Rows, Has.Count.EqualTo(200));
        Assert.That(outcome.Value.Page.HasMore, Is.False);
        Assert.That(outcome.Value.Page.TotalRows, Is.EqualTo(1000));
        Assert.That(seenWhenTheResponseArrives, Is.EqualTo(1000));
        Assert.That(committedWhenTheResponseArrives, Is.Zero);
        Assert.That(next.Error.Kind, Is.EqualTo(EDatabaseFailure.NoOpenCursor));
        Assert.That(seenAfterClosing, Is.EqualTo(1000));
    }

    /// <summary>A palavra `table` num nome, num texto ou num comentário, e o parêntese longe dela, não tiram a paginação de uma leitura.</summary>
    [Test]
    public async Task Execute_ReadThatOnlyMentionsTable_StaysPaged()
    {
        await using var connection = await OpenAsync();

        var page = await ExecutePageAsync(connection, "SELECT numero AS table_id, 'table (x)' AS texto, numero AS \"TABLE (\" /* table ( */ FROM loja.pedido -- table (\nORDER BY numero");

        Assert.That(page.Rows, Has.Count.EqualTo(200));
        Assert.That(page.HasMore, Is.True);
        Assert.That(page.TotalRows, Is.Null);
    }

    /// <summary>RN-SQL-011: as células saem iguais seja qual for a cultura do processo. Com a da Arábia Saudita a data saía no calendário islâmico, e o `DECFLOAT` com a vírgula e os sinais dela.</summary>
    [Test]
    [SetCulture("ar-SA")]
    public Task Execute_ReturnsEveryCellAsText_WhateverTheCultureOfTheProcess()
        => Execute_ReturnsEveryCellAsText_WithoutLosingPrecision();

    /// <summary>
    /// O Db2 aceita um comentário de bloco dentro de outro, e o de fora só acaba no fecho dele: é assim que a API lê o comando. O
    /// `COMMIT` depois de um comentário aninhado é o comando que o banco executaria, e é recusado; lido sem aninhamento, o comentário
    /// acabaria no primeiro `*/`, e o `COMMIT` passaria. A leitura com comentário aninhado vai ao banco e funciona.
    /// </summary>
    [Test]
    public async Task Execute_NestedBlockComments_AreReadAsTheDatabaseReadsThem()
    {
        await using var connection = await OpenAsync();

        var read = await connection.ExecuteAsync("SELECT /* um /* dentro */ do outro */ COUNT(*) FROM loja.cliente", CancellationToken.None);
        var unbalanced = await connection.ExecuteAsync("SELECT /* um /* dentro */ COUNT(*) FROM loja.cliente", CancellationToken.None);
        var commit = await connection.ExecuteAsync("/* um /* dentro */ do outro */ COMMIT", CancellationToken.None);

        Assert.That(read.IsSuccess, Is.True, read.IsFailure ? read.Error.Message : null);
        Assert.That(read.Value.Page!.Rows[0][0], Is.EqualTo("10"));
        Assert.That(unbalanced.IsFailure, Is.True);
        Assert.That(unbalanced.Error.SqlState, Is.EqualTo("42601"));
        Assert.That(commit.Error.Kind, Is.EqualTo(EDatabaseFailure.TransactionControlNotSupported));
    }

    /// <summary>
    /// RN-SQL-001: a rotina acrescentada a um módulo (`ALTER MODULE ... ADD` ou `PUBLISH PROCEDURE` ou `FUNCTION`) tem `;` no corpo
    /// e é um comando só. A API a recusava como envio de mais de um comando, e o banco a aceita. O procedimento e a função de um
    /// módulo de verdade são criados e funcionam; o texto que continua depois do fim do bloco passa pela contagem, e quem o recusa
    /// é o banco, inteiro, sem executar nada (como nos outros blocos do Db2). As formas de `ALTER MODULE` sem corpo seguem a regra
    /// comum: com outro comando depois do `;`, o envio é recusado antes de ir ao banco.
    /// </summary>
    [Test]
    public async Task Execute_ModuleRoutinesWithSemicolonsInTheBody_AreOneStatement_AndAreCreated()
    {
        var table = await CreateWriteTableAsync();
        var module = $"loja.m_{Guid.NewGuid():N}";
        await using var connection = await OpenAsync();
        var moduleCreated = await connection.ExecuteAsync($"CREATE MODULE {module}", CancellationToken.None);

        var procedure = await connection.ExecuteAsync($"ALTER MODULE {module} PUBLISH PROCEDURE grava ()\nBEGIN\n  UPDATE {table} SET versao = 1 WHERE numero = 1001;\n  UPDATE {table} SET versao = 1 WHERE numero = 1002;\nEND;", CancellationToken.None);
        var function = await connection.ExecuteAsync($"-- a função\nALTER MODULE {module} ADD FUNCTION dobro (x INTEGER) RETURNS INTEGER BEGIN DECLARE resultado INTEGER; SET resultado = x * 2; RETURN resultado; END", CancellationToken.None);
        var called = await connection.ExecuteAsync($"CALL {module}.grava()", CancellationToken.None);
        var byTheProcedure = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");

        var followed = await connection.ExecuteAsync($"ALTER MODULE {module} PUBLISH PROCEDURE outra () BEGIN UPDATE {table} SET versao = 8 WHERE numero = 1008; END; UPDATE {table} SET versao = 8 WHERE numero = 1009", CancellationToken.None);
        var withoutBody = await connection.ExecuteAsync($"ALTER MODULE {module} PUBLISH VARIABLE contador INTEGER; UPDATE {table} SET versao = 8 WHERE numero = 1009", CancellationToken.None);
        var afterTheBlocks = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 8");
        var routines = await ExecutePageAsync(connection, $"SELECT ROUTINENAME FROM SYSCAT.ROUTINES WHERE ROUTINESCHEMA = 'LOJA' AND ROUTINEMODULENAME = '{module[5..].ToUpperInvariant()}' ORDER BY ROUTINENAME");
        await connection.ExecuteAsync($"DROP MODULE {module}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(moduleCreated.IsSuccess, Is.True, moduleCreated.IsFailure ? moduleCreated.Error.Message : null);
        Assert.That(procedure.IsSuccess, Is.True, procedure.IsFailure ? procedure.Error.Message : null);
        Assert.That(function.IsSuccess, Is.True, function.IsFailure ? function.Error.Message : null);
        Assert.That(called.IsSuccess, Is.True, called.IsFailure ? called.Error.Message : null);
        Assert.That(byTheProcedure, Is.EqualTo(2));
        Assert.That(followed.IsFailure, Is.True);
        Assert.That(followed.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(followed.Error.SqlState, Is.EqualTo("42601"));
        Assert.That(withoutBody.Error.Kind, Is.EqualTo(EDatabaseFailure.MultipleStatementsNotSupported));
        Assert.That(afterTheBlocks, Is.Zero);
        Assert.That(routines.Rows.Select(row => row[0]), Is.EqualTo(new[] { "DOBRO", "GRAVA" }));
    }

    /// <summary>
    /// RN-SQL-001: o Db2 lê um comentário de bloco dentro de outro, e o driver, que é quem divide o envio, encerra o comentário no
    /// primeiro `*/`. Com um comentário aninhado antes das palavras do bloco (ou entre `CREATE` e `PROCEDURE`), a API via o bloco,
    /// um comando só, e o driver, que não o via, dividia no `;` e executava os pedaços um por um: a resposta era sucesso com o
    /// protótipo publicado e o `UPDATE` gravado, ou o erro do meio com a função criada e o `UPDATE` do fim gravado. O envio só é
    /// bloco quando as duas leituras começam pelas palavras dele: estes são recusados sem ir ao banco, e nada é criado nem gravado.
    /// Com o comentário depois da palavra `PROCEDURE` ou de `ALTER MODULE` as duas leituras veem o bloco, o driver manda inteiro, e
    /// quem recusa é o banco. O bloco sem nada depois continua indo ao banco.
    /// </summary>
    [Test]
    public async Task Execute_NestedCommentBeforeTheBlockWords_IsRefused_AndNothingIsWrittenOrCreated()
    {
        const string nested = "/* a /* b */ c */";
        var table = await CreateWriteTableAsync();
        var suffix = Guid.NewGuid().ToString("N");
        var module = $"loja.m_{suffix}";
        var body = $"UPDATE {table} SET versao = 8 WHERE numero = 1008";
        var update = $"UPDATE {table} SET versao = 8 WHERE numero = 1009";
        await using var connection = await OpenAsync();
        var moduleCreated = await connection.ExecuteAsync($"CREATE MODULE {module}", CancellationToken.None);

        var refused = new List<EDatabaseFailure?>();
        foreach (var sql in new[]
        {
            $"{nested} ALTER MODULE {module} PUBLISH PROCEDURE q (); {update}",
            $"{nested} CREATE PROCEDURE loja.p1_{suffix} () LANGUAGE SQL {body}; {update}",
            $"{nested} CREATE FUNCTION loja.f1_{suffix} () RETURNS INTEGER RETURN 1; {update}",
            $"{nested} CREATE FUNCTION loja.f2_{suffix} () RETURNS INTEGER RETURN 1; SELEC 1; {update}",
            $"{nested} CREATE TRIGGER loja.g_{suffix} AFTER INSERT ON {table} FOR EACH ROW {body}; {update}",
            $"CREATE {nested} PROCEDURE loja.p2_{suffix} () LANGUAGE SQL {body}; {update}",
            $"CREATE OR {nested} REPLACE PROCEDURE loja.p3_{suffix} () LANGUAGE SQL {body}; {update}",
            $"CREATE OR REPLACE {nested} PROCEDURE loja.p4_{suffix} () LANGUAGE SQL {body}; {update}",
            $"{update} /* a /* b */ ; {body} ; */",
            $"/* a /* b */ ; */ {update}"
        })
        {
            var outcome = await connection.ExecuteAsync(sql, CancellationToken.None);
            refused.Add(outcome.IsFailure ? outcome.Error.Kind : null);
        }

        var byTheDatabase = new List<EDatabaseFailure?>();
        foreach (var sql in new[] { $"CREATE PROCEDURE {nested} loja.p5_{suffix} () LANGUAGE SQL {body}; {update}", $"ALTER MODULE {nested} {module} PUBLISH PROCEDURE q (); {update}" })
        {
            var outcome = await connection.ExecuteAsync(sql, CancellationToken.None);
            byTheDatabase.Add(outcome.IsFailure ? outcome.Error.Kind : null);
        }

        var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 8");
        var created = await ExecutePageAsync(connection, $"SELECT (SELECT COUNT(*) FROM SYSCAT.ROUTINES WHERE ROUTINESCHEMA = 'LOJA' AND (ROUTINENAME LIKE '%{suffix.ToUpperInvariant()}' OR ROUTINEMODULENAME = 'M_{suffix.ToUpperInvariant()}')) + (SELECT COUNT(*) FROM SYSCAT.TRIGGERS WHERE TRIGSCHEMA = 'LOJA' AND TRIGNAME LIKE '%{suffix.ToUpperInvariant()}') FROM SYSIBM.SYSDUMMY1");
        var alone = await connection.ExecuteAsync($"{nested} CREATE PROCEDURE loja.p_{suffix} () LANGUAGE SQL {body};", CancellationToken.None);
        var afterwards = await connection.ExecuteAsync(update, CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 8");
        await connection.ExecuteAsync($"DROP PROCEDURE loja.p_{suffix}", CancellationToken.None);
        await connection.ExecuteAsync($"DROP MODULE {module}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(moduleCreated.IsSuccess, Is.True, moduleCreated.IsFailure ? moduleCreated.Error.Message : null);
        Assert.That(refused, Is.All.EqualTo(EDatabaseFailure.MultipleStatementsNotSupported));
        Assert.That(byTheDatabase, Is.All.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(written, Is.Zero);
        Assert.That(created.Rows[0][0], Is.EqualTo("0"));
        Assert.That(alone.IsSuccess, Is.True, alone.IsFailure ? alone.Error.Message : null);
        Assert.That(afterwards.IsSuccess, Is.True, afterwards.IsFailure ? afterwards.Error.Message : null);
        Assert.That(seen, Is.EqualTo(1));
    }

    /// <summary>
    /// RN-SQL-013, com o mesmo comentário aninhado: o comando só fica paginado, e só é contado, quando o banco e o driver o leem
    /// como leitura. A gravação que o driver toma por texto entre aspas (para o banco é um `FINAL TABLE (UPDATE ...)`) roda até o
    /// fim e é confirmada antes de a resposta sair, e a contagem dela é recusada sem ir ao banco. A leitura com comentário aninhado
    /// que não esconde nada continua paginada.
    /// </summary>
    [Test]
    public async Task Execute_WriteThatOnlyTheDatabaseSeesThroughANestedComment_RunsToTheEndAndCommits()
    {
        var table = await CreateWriteTableAsync();
        var hidden = $"SELECT numero /* a /* b */ ' */ FROM FINAL TABLE (UPDATE {table} SET versao = 1) -- '";
        var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync(hidden, CancellationToken.None);
        var seenWhenTheResponseArrives = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        var next = await connection.FetchNextAsync(CancellationToken.None);
        var counted = await connection.CountAsync(hidden, CancellationToken.None);
        var read = await connection.ExecuteAsync($"SELECT /* a /* b */ c */ numero FROM {table} ORDER BY numero", CancellationToken.None);
        await connection.DisposeAsync();
        await DropAsync(table);

        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);
        Assert.That(outcome.Value.Page!.TotalRows, Is.EqualTo(1000));
        Assert.That(outcome.Value.Page.HasMore, Is.False);
        Assert.That(seenWhenTheResponseArrives, Is.EqualTo(1000));
        Assert.That(next.Error.Kind, Is.EqualTo(EDatabaseFailure.NoOpenCursor));
        Assert.That(counted.IsFailure, Is.True);
        Assert.That(counted.Error.Message, Does.StartWith("Só uma leitura pode ser contada"));
        Assert.That(read.IsSuccess, Is.True, read.IsFailure ? read.Error.Message : null);
        Assert.That(read.Value.Page!.HasMore, Is.True);
        Assert.That(read.Value.Page.TotalRows, Is.Null);
    }
}
