using Prism.IntegrationTesting.Configurations;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.TestingCore.Extensions;
using System.Diagnostics;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// O driver do PostgreSQL contra um PostgreSQL de verdade: o contrato comum (`DatabaseClientContractTests`) e o que só existe neste
/// banco. O teste da tabela grande é daqui, e não do contrato, para o Db2 e o Informix não pagarem por uma carga de 200.000 linhas.
/// </summary>
[TestFixture]
[Category("Databases")]
public sealed class PostgresClientTests : DatabaseClientContractTests
{
    protected override EDatabaseEngine Engine => EDatabaseEngine.PostgreSql;

    protected override string WrongPasswordMessage => "password authentication failed";

    protected override string SyntaxErrorSqlState => "42601";

    protected override string SlowQuery => "SELECT pg_sleep(30)";

    // A leitura paginada roda numa transação só de leitura, que não aceita `nextval` de uma sequência comum; a de uma sequência temporária
    // ela aceita, e a sequência não volta atrás quando a transação é desfeita. Por isso o contador é da própria conexão.
    protected override string ExecutionCounterSetup => "CREATE TEMPORARY SEQUENCE execucoes";

    // A subconsulta sem relação com a linha é avaliada uma vez por execução do comando.
    protected override string CountedQuery => "SELECT pedido.numero, (SELECT nextval('execucoes')) AS execucao FROM loja.pedido ORDER BY pedido.numero";

    protected override string ExecutionCountQuery => "SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM execucoes";

    protected override string LargeReadQuery => "SELECT pedido.numero, repeat('x', 500) AS peso FROM loja.pedido CROSS JOIN generate_series(1, 20) AS copia";

    // Só conexões de clientes: o autovacuum também abre transação e trava a tabela. A transação abortada entra pelo estado: o banco zera o
    // `xact_start` dela.
    protected override string PendingWorkQuery => "SELECT (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid() AND (xact_start IS NOT NULL OR state LIKE 'idle in transaction%')) + (SELECT COUNT(*) FROM pg_locks JOIN pg_stat_activity ON pg_stat_activity.pid = pg_locks.pid WHERE pg_locks.relation = 'loja.pedido'::REGCLASS AND pg_stat_activity.backend_type = 'client backend' AND pg_locks.pid <> pg_backend_pid())";

    protected override string?[] FirstPedidoRow => ["1001", "1.50", "2026-01-01 00:01:00", "Pedido 1"];

    protected override string WriteReturningRows(string table)
        => $"UPDATE {table} SET versao = 1 RETURNING numero";

    /// <summary>400 linhas, com divisão por zero na linha 300: a primeira página sai inteira, e o erro fica no fim do que o banco já mandou.</summary>
    private const string ErrorAtRow300Query = "SELECT 1 / (CASE WHEN numero = 300 THEN 0 ELSE 1 END) AS valor FROM generate_series(1, 400) AS numero";

    protected override Task<ConnectionSettings> StartDatabaseAsync()
        => PostgresSingleton.GetSettingsAsync();

    /// <summary>Uma função que devolve o número recebido e, para os números acima de 1250 (da linha 251 em diante, na ordem da tabela), grava na tabela do teste.</summary>
    private static async Task<string> CreateFunctionThatWritesFromRow251Async(IDatabaseConnection connection, string table)
    {
        var function = $"loja.grava_depois_{Guid.NewGuid():N}";
        var created = await connection.ExecuteAsync($"CREATE FUNCTION {function}(alvo INTEGER) RETURNS INTEGER LANGUAGE plpgsql AS $$ BEGIN IF alvo > 1250 THEN UPDATE {table} SET versao = versao + 1 WHERE numero = alvo; END IF; RETURN alvo; END $$", CancellationToken.None);
        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);

        return function;
    }

    [Test]
    public async Task Open_OnClosedPort_ReturnsConnectionFailed()
    {
        var opened = await Client.OpenAsync(Settings with { Port = 1 }, CancellationToken.None);

        Assert.That(opened.IsFailure, Is.True);
        Assert.That(opened.Error.Kind, Is.EqualTo(EDatabaseFailure.ConnectionFailed));
        Assert.That(opened.Error.Message, Is.Not.Empty);
    }

    [Test]
    public async Task Open_UnknownDatabase_ReturnsConnectionFailedWithSqlState()
    {
        var opened = await Client.OpenAsync(Settings with { Database = "banco_que_nao_existe" }, CancellationToken.None);

        Assert.That(opened.IsFailure, Is.True);
        Assert.That(opened.Error.Kind, Is.EqualTo(EDatabaseFailure.ConnectionFailed));
        Assert.That(opened.Error.Message, Is.EqualTo("database \"banco_que_nao_existe\" does not exist"));
        Assert.That(opened.Error.SqlState, Is.EqualTo("3D000"));
    }

    /// <summary>RN-SQL-009: o PostgreSQL informa a posição, e a mensagem é a do servidor, sem o SQLSTATE nem o aviso do driver na frente.</summary>
    [Test]
    public async Task Execute_SyntaxError_ReportsTheServerMessageAndThePosition()
    {
        await using var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync("SELECT numero FORM loja.pedido", CancellationToken.None);

        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Message, Is.EqualTo("syntax error at or near \"loja\""));
        Assert.That(outcome.Error.SqlState, Is.EqualTo("42601"));
        Assert.That(outcome.Error.Position, Is.EqualTo(20));
    }

    /// <summary>RN-SQL-009: a mensagem chega inteira, com o detalhe do banco na linha dele: sem ele a pessoa não sabe qual chave se repetiu.</summary>
    [Test]
    public async Task Execute_ConstraintViolation_ReportsTheMessageAndTheDetail()
    {
        await using var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync("INSERT INTO loja.cliente (id, nome) VALUES (1, 'Repetido')", CancellationToken.None);

        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Message, Is.EqualTo("duplicate key value violates unique constraint \"pk_cliente\"\nDETAIL: Key (id)=(1) already exists."));
        Assert.That(outcome.Error.SqlState, Is.EqualTo("23505"));
        Assert.That(outcome.Error.Position, Is.Null);
    }

    /// <summary>RN-SQL-009: a dica do banco também chega, na linha dela.</summary>
    [Test]
    public async Task Execute_UnknownColumn_ReportsTheMessageAndTheHint()
    {
        await using var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync("SELECT numer FROM loja.pedido", CancellationToken.None);

        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Message, Is.EqualTo("column \"numer\" does not exist\nHINT: Perhaps you meant to reference the column \"pedido.numero\"."));
        Assert.That(outcome.Error.SqlState, Is.EqualTo("42703"));
        Assert.That(outcome.Error.Position, Is.EqualTo(8));
    }

    /// <summary>
    /// RN-SQL-003: o comando vai ao banco como está, sem ser dividido pelo `;`. O corpo desta função tem dois, e ela é um comando só;
    /// também é a prova de que um `BEGIN` no meio do comando não é controle de transação.
    /// </summary>
    [Test]
    public async Task Execute_FunctionWithSemicolonsInTheBody_Works()
    {
        await using var connection = await OpenAsync();
        var function = $"loja.soma_{Guid.NewGuid():N}";

        var created = await connection.ExecuteAsync($"CREATE FUNCTION {function}(x INTEGER) RETURNS INTEGER LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT x + 1; END", CancellationToken.None);
        var called = await connection.ExecuteAsync($"SELECT {function}(41)", CancellationToken.None);
        var block = await connection.ExecuteAsync("DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;", CancellationToken.None);
        await connection.ExecuteAsync($"DROP FUNCTION {function}", CancellationToken.None);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(called.IsSuccess, Is.True, called.IsFailure ? called.Error.Message : null);
        Assert.That(called.Value.Page!.Rows[0][0], Is.EqualTo("42"));
        Assert.That(block.IsSuccess, Is.True, block.IsFailure ? block.Error.Message : null);
    }

    /// <summary>RN-SQL-001 e 003: mais de um comando por envio é recusa do próprio PostgreSQL, que não executa nenhum deles.</summary>
    [Test]
    public async Task Execute_TwoStatements_IsRefusedByTheDatabase()
    {
        await using var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync("SELECT 1; SELECT 2", CancellationToken.None);

        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Message, Is.EqualTo("cannot insert multiple commands into a prepared statement"));
        Assert.That(outcome.Error.SqlState, Is.EqualTo("42601"));
    }

    /// <summary>
    /// RN-SQL-013: quem sabe que o comando grava é o banco. Uma leitura que chama uma função que grava é recusada na tentativa só de
    /// leitura, desfeita e executada de novo até o fim: a função valeu uma vez só, e a gravação está confirmada na resposta.
    /// </summary>
    [Test]
    public async Task Execute_SelectCallingAFunctionThatWrites_RunsToTheEndAndCommitsOnce()
    {
        var table = await CreateWriteTableAsync();
        var function = $"loja.grava_{Guid.NewGuid():N}";
        var connection = await OpenAsync();
        await connection.ExecuteAsync($"CREATE FUNCTION {function}() RETURNS BIGINT LANGUAGE sql AS 'WITH gravadas AS (UPDATE {table} SET versao = versao + 1 RETURNING 1) SELECT COUNT(*) FROM gravadas'", CancellationToken.None);

        var outcome = await connection.ExecuteAsync($"SELECT {function}() AS gravadas", CancellationToken.None);
        var seenWhenTheResponseArrives = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        await connection.DisposeAsync();
        var seenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        await using (var cleaner = await OpenAsync())
            await cleaner.ExecuteAsync($"DROP FUNCTION {function}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);
        Assert.That(outcome.Value.Page!.Rows[0][0], Is.EqualTo("1000"));
        Assert.That(outcome.Value.Page.HasMore, Is.False);
        Assert.That(outcome.Value.Page.TotalRows, Is.EqualTo(1));
        Assert.That(seenWhenTheResponseArrives, Is.EqualTo(1000));
        Assert.That(seenAfterClosing, Is.EqualTo(1000));
    }

    /// <summary>
    /// RN-SQL-013, no caso em que o banco só descobre a gravação depois da primeira página: a função chamada pela leitura grava da linha
    /// 251 em diante. "Carregar mais" recebe a recusa do banco e nada é gravado; a mesma leitura, executada de novo, já não é tentada
    /// como leitura: roda até o fim e confirma.
    /// </summary>
    [Test]
    public async Task FetchNext_WhenTheReadWritesAfterTheFirstPage_IsRefused_AndRunningItAgainGoesToTheEnd()
    {
        var table = await CreateWriteTableAsync();
        var connection = await OpenAsync();
        var function = await CreateFunctionThatWritesFromRow251Async(connection, table);
        var sql = $"SELECT {function}(numero) AS gravado FROM {table} ORDER BY numero";

        var first = await connection.ExecuteAsync(sql, CancellationToken.None);
        var next = await connection.FetchNextAsync(CancellationToken.None);
        var writtenAfterTheRefusal = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao <> 0");
        var again = await connection.ExecuteAsync(sql, CancellationToken.None);
        var writtenAfterRunningAgain = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        await connection.ExecuteAsync($"DROP FUNCTION {function}", CancellationToken.None);
        await connection.DisposeAsync();
        await DropAsync(table);

        Assert.That(first.IsSuccess, Is.True, first.IsFailure ? first.Error.Message : null);
        Assert.That(first.Value.Page!.HasMore, Is.True);
        Assert.That(next.IsFailure, Is.True);
        Assert.That(next.Error.SqlState, Is.EqualTo("25006"));
        Assert.That(next.Error.Message, Does.StartWith("cannot execute UPDATE in a read-only transaction").And.Contain("Execute-o de novo"));
        Assert.That(writtenAfterTheRefusal, Is.Zero);
        Assert.That(again.IsSuccess, Is.True, again.IsFailure ? again.Error.Message : null);
        Assert.That(again.Value.Page!.Rows, Has.Count.EqualTo(200));
        Assert.That(again.Value.Page.HasMore, Is.False);
        Assert.That(again.Value.Page.TotalRows, Is.EqualTo(1000));
        Assert.That(writtenAfterRunningAgain, Is.EqualTo(750));
    }

    /// <summary>
    /// Um erro que o banco só entrega depois da primeira página (aqui, divisão por zero na linha 300) é do cursor que o produziu: aparece
    /// no "carregar mais" que chega até ele, e a transação da tentativa termina.
    /// </summary>
    [Test]
    public async Task FetchNext_ReachingAnErrorLaterInTheResult_ReportsIt_AndLeavesNothingPending()
    {
        await using var connection = await OpenAsync();

        var first = await ExecutePageAsync(connection, ErrorAtRow300Query);
        var next = await connection.FetchNextAsync(CancellationToken.None);
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        var ping = await connection.PingAsync(CancellationToken.None);

        Assert.That(first.HasMore, Is.True);
        Assert.That(next.IsFailure, Is.True);
        Assert.That(next.Error.Message, Is.EqualTo("division by zero"));
        Assert.That(next.Error.SqlState, Is.EqualTo("22012"));
        Assert.That(pending, Is.Zero);
        Assert.That(ping.IsSuccess, Is.True);
    }

    /// <summary>
    /// O erro que ficou no fim de um resultado é descartado com o cursor, quando ele fecha antes de chegar lá. O comando seguinte é
    /// enviado e responde por si: não herda o erro do anterior.
    /// </summary>
    [Test]
    public async Task Execute_AfterACursorWithAnErrorStillToCome_IsNotAffectedByIt()
    {
        var table = await CreateWriteTableAsync();
        await using var connection = await OpenAsync();
        await ExecutePageAsync(connection, ErrorAtRow300Query);

        var written = await connection.ExecuteAsync($"UPDATE {table} SET versao = 7", CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 7");
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        await DropAsync(table);

        Assert.That(written.IsSuccess, Is.True, written.IsFailure ? written.Error.Message : null);
        Assert.That(written.Value.RowsAffected, Is.EqualTo(1000));
        Assert.That(seen, Is.EqualTo(1000));
        Assert.That(pending, Is.Zero);
    }

    /// <summary>
    /// A recusa de gravação que ficou no fim de um resultado (a função grava da linha 251 em diante) também é do cursor que a produziu:
    /// a leitura seguinte não pode ser tomada por comando que grava e rodar até o fim.
    /// </summary>
    [Test]
    public async Task Execute_AfterACursorWhoseWriteRefusalIsStillToCome_StillPagesTheNextRead()
    {
        var table = await CreateWriteTableAsync();
        await using var connection = await OpenAsync();
        var function = await CreateFunctionThatWritesFromRow251Async(connection, table);
        await ExecutePageAsync(connection, $"SELECT {function}(numero) AS gravado FROM {table} ORDER BY numero");

        var next = await ExecutePageAsync(connection, PedidoQuery);
        var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao <> 0");
        await connection.ExecuteAsync($"DROP FUNCTION {function}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(next.Rows, Has.Count.EqualTo(200));
        Assert.That(next.HasMore, Is.True);
        Assert.That(next.TotalRows, Is.Null);
        Assert.That(written, Is.Zero);
    }

    /// <summary>Fechar um cursor com erro pendente termina a transação da tentativa: a conexão volta a ficar parada, e não presa numa transação abortada.</summary>
    [Test]
    public async Task CloseCursor_WithAnErrorStillToCome_EndsTheTransaction()
    {
        await using var connection = await OpenAsync();
        await ExecutePageAsync(connection, ErrorAtRow300Query);

        await connection.CloseCursorAsync();
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        var ping = await connection.PingAsync(CancellationToken.None);

        Assert.That(pending, Is.Zero);
        Assert.That(ping.IsSuccess, Is.True);
    }

    /// <summary>
    /// RN-SESSAO-005: o banco só confirma o comando depois de entregar a última linha, e é ali que ele confere uma chave estrangeira
    /// adiada. A recusa que vem nesse ponto é a do comando: responder sucesso seria mostrar linhas que o banco não gravou. Depois dela a
    /// sessão continua servindo, e o mesmo comando, com a linha mãe no lugar, grava.
    /// </summary>
    [TestCase("INSERT INTO {0} VALUES (2, 999) RETURNING id", 1)]
    [TestCase("INSERT INTO {0} SELECT numero, 999 FROM generate_series(1, 491) AS numero RETURNING id", 491)]
    [TestCase("WITH novas AS (INSERT INTO {0} VALUES (2, 999) RETURNING id) SELECT id FROM novas", 1)]
    [TestCase("WITH novas AS (INSERT INTO {0} SELECT numero, 999 FROM generate_series(1, 491) AS numero RETURNING id) SELECT id FROM novas", 491)]
    public async Task Execute_WriteReturningRows_ThatTheDatabaseRefusesWhenConfirming_FailsAndWritesNothing(string command, int rows)
    {
        var suffix = Guid.NewGuid().ToString("N");
        var sql = string.Format(command, $"loja.filha_{suffix}");
        await using var connection = await OpenAsync();
        var parent = await connection.ExecuteAsync($"CREATE TABLE loja.mae_{suffix} (id INTEGER PRIMARY KEY)", CancellationToken.None);
        var child = await connection.ExecuteAsync($"CREATE TABLE loja.filha_{suffix} (id INTEGER, mae_id INTEGER REFERENCES loja.mae_{suffix} (id) DEFERRABLE INITIALLY DEFERRED)", CancellationToken.None);

        var refused = await connection.ExecuteAsync(sql, CancellationToken.None);
        var seenAfterTheRefusal = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM loja.filha_{suffix}");
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        var mother = await connection.ExecuteAsync($"INSERT INTO loja.mae_{suffix} VALUES (999)", CancellationToken.None);
        var written = await connection.ExecuteAsync(sql, CancellationToken.None);
        var seenAfterWriting = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM loja.filha_{suffix}");
        await connection.ExecuteAsync($"DROP TABLE loja.filha_{suffix}", CancellationToken.None);
        await connection.ExecuteAsync($"DROP TABLE loja.mae_{suffix}", CancellationToken.None);

        Assert.That(parent.IsSuccess && child.IsSuccess, Is.True);
        Assert.That(refused.IsFailure, Is.True);
        Assert.That(refused.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(refused.Error.SqlState, Is.EqualTo("23503"));
        Assert.That(refused.Error.Message, Does.StartWith("insert or update on table"));
        Assert.That(seenAfterTheRefusal, Is.Zero);
        Assert.That(pending, Is.Zero);
        Assert.That(mother.IsSuccess, Is.True, mother.IsFailure ? mother.Error.Message : null);
        Assert.That(written.IsSuccess, Is.True, written.IsFailure ? written.Error.Message : null);
        Assert.That(written.Value.Page!.TotalRows, Is.EqualTo(rows));
        Assert.That(seenAfterWriting, Is.EqualTo(rows));
    }

    /// <summary>
    /// O mesmo na leitura paginada. A transação só de leitura deixa gravar em tabela temporária, e a chave estrangeira adiada dela é
    /// conferida no `COMMIT` que fecha a tentativa quando a leitura chega ao fim: na primeira página, ou no "carregar mais" que traz a
    /// última. A recusa é a resposta, nada fica gravado, e a conexão continua aberta: depois de um `COMMIT` recusado o PostgreSQL já
    /// desfez a transação, e o `ROLLBACK` da limpeza é só um aviso.
    /// </summary>
    [Test]
    public async Task Execute_ReadWhoseCommitTheDatabaseRefuses_Fails_AndKeepsTheConnection()
    {
        await using var connection = await OpenAsync();
        var mother = await connection.ExecuteAsync("CREATE TEMPORARY TABLE mae (id INTEGER PRIMARY KEY)", CancellationToken.None);
        var child = await connection.ExecuteAsync("CREATE TEMPORARY TABLE filha (mae_id INTEGER REFERENCES mae (id) DEFERRABLE INITIALLY DEFERRED)", CancellationToken.None);
        var function = await connection.ExecuteAsync("CREATE FUNCTION pg_temp.grava_filha(alvo INTEGER) RETURNS INTEGER LANGUAGE plpgsql AS $$ BEGIN INSERT INTO filha VALUES (alvo); RETURN alvo; END $$", CancellationToken.None);

        var onePage = await connection.ExecuteAsync("SELECT pg_temp.grava_filha(999) AS gravado", CancellationToken.None);
        var openAfterOnePage = connection.IsOpen;
        var firstPage = await connection.ExecuteAsync("SELECT pg_temp.grava_filha(numero) AS gravado FROM generate_series(1, 250) AS numero", CancellationToken.None);
        var lastPage = await connection.FetchNextAsync(CancellationToken.None);
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        var kept = await ExecutePageAsync(connection, "SELECT COUNT(*) FROM filha");

        Assert.That(mother.IsSuccess && child.IsSuccess && function.IsSuccess, Is.True);
        Assert.That(onePage.IsFailure, Is.True);
        Assert.That(onePage.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(onePage.Error.SqlState, Is.EqualTo("23503"));
        Assert.That(openAfterOnePage, Is.True);
        Assert.That(firstPage.IsSuccess, Is.True, firstPage.IsFailure ? firstPage.Error.Message : null);
        Assert.That(firstPage.Value.Page!.HasMore, Is.True);
        Assert.That(lastPage.IsFailure, Is.True);
        Assert.That(lastPage.Error.SqlState, Is.EqualTo("23503"));
        Assert.That(pending, Is.Zero);
        Assert.That(kept.Rows[0][0], Is.EqualTo("0"));
        Assert.That(connection.IsOpen, Is.True);
    }

    /// <summary>
    /// RN-SQL-013: um `WITH` que grava vai direto ao modo completo. Em tabela temporária a transação só de leitura não recusaria a
    /// gravação, e ela seria desfeita quando o cursor fechasse antes do fim: aqui as 500 linhas ficam, e a resposta traz 200 e o total.
    /// </summary>
    [Test]
    public async Task Execute_WithThatWritesToATemporaryTable_RunsToTheEndAndKeepsEveryRow()
    {
        await using var connection = await OpenAsync();
        await connection.ExecuteAsync("CREATE TEMPORARY TABLE rascunho (id INTEGER)", CancellationToken.None);

        var outcome = await connection.ExecuteAsync("WITH gravadas AS (INSERT INTO rascunho SELECT numero FROM generate_series(1, 500) AS numero RETURNING id) SELECT id FROM gravadas", CancellationToken.None);
        var next = await connection.FetchNextAsync(CancellationToken.None);
        var kept = await ExecutePageAsync(connection, "SELECT COUNT(*) FROM rascunho");

        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);
        Assert.That(outcome.Value.Page!.Rows, Has.Count.EqualTo(200));
        Assert.That(outcome.Value.Page.HasMore, Is.False);
        Assert.That(outcome.Value.Page.TotalRows, Is.EqualTo(500));
        Assert.That(next.Error.Kind, Is.EqualTo(EDatabaseFailure.NoOpenCursor));
        Assert.That(kept.Rows[0][0], Is.EqualTo("500"));
    }

    /// <summary>
    /// RN-SQL-013: o `WITH` que grava pode vir entre parênteses, e vai direto ao modo completo do mesmo jeito: as 500 linhas ficam na
    /// tabela temporária depois de o cursor fechar. A leitura entre parênteses, com ou sem `UNION`, continua paginada.
    /// </summary>
    [Test]
    public async Task Execute_ParenthesizedWithThatWrites_RunsToTheEnd_AndParenthesizedReadsStayPaged()
    {
        await using var connection = await OpenAsync();
        await connection.ExecuteAsync("CREATE TEMPORARY TABLE rascunho (id INTEGER)", CancellationToken.None);

        var written = await connection.ExecuteAsync("(WITH g AS (INSERT INTO rascunho SELECT numero FROM generate_series(1, 500) AS numero RETURNING id) SELECT id FROM g)", CancellationToken.None);
        await connection.CloseCursorAsync();
        var kept = await ExecutePageAsync(connection, "SELECT COUNT(*) FROM rascunho");
        var read = await ExecutePageAsync(connection, "(SELECT numero FROM loja.pedido ORDER BY numero)");
        var union = await ExecutePageAsync(connection, "((SELECT numero FROM loja.pedido) UNION ALL (SELECT numero FROM loja.pedido))");

        Assert.That(written.IsSuccess, Is.True, written.IsFailure ? written.Error.Message : null);
        Assert.That(written.Value.Page!.Rows, Has.Count.EqualTo(200));
        Assert.That(written.Value.Page.HasMore, Is.False);
        Assert.That(written.Value.Page.TotalRows, Is.EqualTo(500));
        Assert.That(kept.Rows[0][0], Is.EqualTo("500"));
        Assert.That(read.Rows, Has.Count.EqualTo(200));
        Assert.That(read.HasMore, Is.True);
        Assert.That(read.TotalRows, Is.Null);
        Assert.That(union.Rows, Has.Count.EqualTo(200));
        Assert.That(union.HasMore, Is.True);
        Assert.That(union.TotalRows, Is.Null);
    }

    /// <summary>
    /// RN-SQL-013: para o PostgreSQL todo caractere a partir de U+0080 é letra de identificador e de marca de `$marca$`. Uma coluna
    /// `é$a$` não abre texto, e `$é$ ' $é$` é um texto: nos dois casos a gravação que vem depois é vista, o comando vai direto ao modo
    /// completo, e as 500 linhas ficam na tabela temporária depois de o cursor fechar.
    /// </summary>
    [TestCase("WITH a AS (SELECT 1 AS é$a$), g AS (INSERT INTO rascunho SELECT numero FROM generate_series(1, 500) AS numero RETURNING id) SELECT 2 AS ç$a$ FROM g")]
    [TestCase("WITH a AS (SELECT $é$ ' $é$ AS t), g AS (INSERT INTO rascunho SELECT numero FROM generate_series(1, 500) AS numero RETURNING id) SELECT id FROM g")]
    public async Task Execute_WithThatWritesAfterNamesAndTagsBeyondAscii_RunsToTheEndAndKeepsEveryRow(string command)
    {
        await using var connection = await OpenAsync();
        await connection.ExecuteAsync("CREATE TEMPORARY TABLE rascunho (id INTEGER)", CancellationToken.None);

        var written = await connection.ExecuteAsync(command, CancellationToken.None);
        await connection.CloseCursorAsync();
        var kept = await ExecutePageAsync(connection, "SELECT COUNT(*) FROM rascunho");

        Assert.That(written.IsSuccess, Is.True, written.IsFailure ? written.Error.Message : null);
        Assert.That(written.Value.Page!.Rows, Has.Count.EqualTo(200));
        Assert.That(written.Value.Page.HasMore, Is.False);
        Assert.That(written.Value.Page.TotalRows, Is.EqualTo(500));
        Assert.That(kept.Rows[0][0], Is.EqualTo("500"));
    }

    /// <summary>
    /// Colunas chamadas `updated_at` e `deleted_at` e um texto com `insert into` não fazem de um `WITH` um comando que grava: ele continua
    /// uma leitura paginada, com o cursor aberto e sem total.
    /// </summary>
    [Test]
    public async Task Execute_WithThatOnlyMentionsTheWords_StaysAPagedRead()
    {
        await using var connection = await OpenAsync();
        await connection.ExecuteAsync("CREATE TEMPORARY TABLE auditoria AS SELECT numero AS id, now() AS updated_at, NULL::TIMESTAMP AS deleted_at FROM generate_series(1, 1000) AS numero", CancellationToken.None);

        var byColumns = await ExecutePageAsync(connection, "WITH x AS (SELECT id, updated_at, deleted_at FROM auditoria) SELECT * FROM x");
        var byText = await ExecutePageAsync(connection, "WITH x AS (SELECT 'insert into t' AS texto, id FROM auditoria) SELECT * FROM x");

        Assert.That(byColumns.Rows, Has.Count.EqualTo(200));
        Assert.That(byColumns.HasMore, Is.True);
        Assert.That(byColumns.TotalRows, Is.Null);
        Assert.That(byText.Rows, Has.Count.EqualTo(200));
        Assert.That(byText.HasMore, Is.True);
        Assert.That(byText.TotalRows, Is.Null);
    }

    /// <summary>RN-SQL-013: a gravação pode estar dentro de um `WITH`, num comando que começa como leitura. Ele nem passa pela tentativa só de leitura.</summary>
    [Test]
    public async Task Execute_SelectOverAModifyingWith_RunsToTheEndAndCommits()
    {
        var table = await CreateWriteTableAsync();
        var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync($"WITH gravadas AS (UPDATE {table} SET versao = 3 RETURNING numero) SELECT numero FROM gravadas", CancellationToken.None);
        var seenWhenTheResponseArrives = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 3");
        await connection.DisposeAsync();
        var seenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 3");
        await DropAsync(table);

        Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? outcome.Error.Message : null);
        Assert.That(outcome.Value.Page!.Rows, Has.Count.EqualTo(200));
        Assert.That(outcome.Value.Page.HasMore, Is.False);
        Assert.That(outcome.Value.Page.TotalRows, Is.EqualTo(1000));
        Assert.That(seenWhenTheResponseArrives, Is.EqualTo(1000));
        Assert.That(seenAfterClosing, Is.EqualTo(1000));
    }

    /// <summary>
    /// A transação só de leitura aceita gravação em tabela temporária, e um `WITH ... INSERT` em tabela temporária começa como leitura.
    /// Ele não devolve linhas, e o que gravou fica: a transação da tentativa é confirmada quando o comando chega ao fim.
    /// </summary>
    [Test]
    public async Task Execute_WithInsertIntoATemporaryTable_KeepsWhatItWrote()
    {
        await using var connection = await OpenAsync();
        await connection.ExecuteAsync("CREATE TEMPORARY TABLE rascunho (id INTEGER)", CancellationToken.None);

        var inserted = await connection.ExecuteAsync("WITH origem AS (SELECT id FROM loja.cliente) INSERT INTO rascunho SELECT id FROM origem", CancellationToken.None);
        var kept = await ExecutePageAsync(connection, "SELECT COUNT(*) FROM rascunho");

        Assert.That(inserted.IsSuccess, Is.True, inserted.IsFailure ? inserted.Error.Message : null);
        Assert.That(inserted.Value.RowsAffected, Is.EqualTo(10));
        Assert.That(kept.Rows[0][0], Is.EqualTo("10"));
    }

    /// <summary>
    /// RN-SESSAO-005, a rede de segurança. A recusa da RN-SQL-003 conhece as formas de abrir transação que existem; se uma que ela não
    /// conhece chegar ao banco, a conexão não pode seguir dentro da transação. O teste chega ao banco com um `BEGIN` pulando a recusa de
    /// propósito: a resposta é a mesma recusa, a transação já foi desfeita, e a gravação seguinte é confirmada como qualquer outra.
    /// </summary>
    [Test]
    public async Task Execute_BeginThatGetsPastTheRefusal_IsRolledBackAndRefused()
    {
        var table = await CreateWriteTableAsync();
        var connection = await OpenAsync();
        var pid = (await ExecutePageAsync(connection, "SELECT pg_backend_pid()")).Rows[0][0];

        var begun = await connection.ExecutePastTheTransactionControlRefusalAsync("BEGIN", CancellationToken.None);
        var idle = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM pg_stat_activity WHERE pid = {pid} AND state = 'idle'");
        var written = await connection.ExecuteAsync($"UPDATE {table} SET versao = 9 WHERE numero = 1001", CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        var idleAfterwards = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM pg_stat_activity WHERE pid = {pid} AND state = 'idle'");

        // A conexão fecha antes de a tabela ser apagada: se a transação tivesse ficado aberta, ela seguraria a tabela.
        await connection.DisposeAsync();
        await DropAsync(table);

        Assert.That(begun.IsFailure, Is.True);
        Assert.That(begun.Error.Kind, Is.EqualTo(EDatabaseFailure.TransactionControlNotSupported));
        // RN-SESSAO-005 (Ruling 135): o comando rodou, e a transação que ele abriu foi desfeita.
        Assert.That(begun.Error.Executed, Is.True);
        Assert.That(idle, Is.EqualTo(1));
        Assert.That(written.IsSuccess, Is.True, written.IsFailure ? written.Error.Message : null);
        Assert.That(written.Value.RowsAffected, Is.EqualTo(1));
        Assert.That(seen, Is.EqualTo(1));
        Assert.That(idleAfterwards, Is.EqualTo(1));
    }

    /// <summary>
    /// A conferência de transação que vem depois de cada comando utilitário não os estraga: criar tabela, `VACUUM` (que não roda dentro
    /// de transação) e `SET` continuam respondendo sucesso, e o `SET` continua valendo no comando seguinte.
    /// </summary>
    [Test]
    public async Task Execute_UtilityCommands_StillSucceed_AndASessionSettingStillHolds()
    {
        await using var connection = await OpenAsync();
        var table = $"utilitario_{Guid.NewGuid():N}";

        var created = await connection.ExecuteAsync($"CREATE TABLE loja.{table} (id INTEGER)", CancellationToken.None);
        var vacuumed = await connection.ExecuteAsync($"VACUUM loja.{table}", CancellationToken.None);
        var set = await connection.ExecuteAsync("SET search_path = loja", CancellationToken.None);
        var found = await connection.ExecuteAsync($"SELECT COUNT(*) FROM {table}", CancellationToken.None);
        var shown = await ExecutePageAsync(connection, "SHOW search_path");
        var dropped = await connection.ExecuteAsync($"DROP TABLE {table}", CancellationToken.None);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(vacuumed.IsSuccess, Is.True, vacuumed.IsFailure ? vacuumed.Error.Message : null);
        Assert.That(set.IsSuccess, Is.True, set.IsFailure ? set.Error.Message : null);
        Assert.That(found.IsSuccess, Is.True, found.IsFailure ? found.Error.Message : null);
        Assert.That(found.Value.Page!.Rows[0][0], Is.EqualTo("0"));
        Assert.That(shown.Rows[0][0], Is.EqualTo("loja"));
        Assert.That(dropped.IsSuccess, Is.True, dropped.IsFailure ? dropped.Error.Message : null);
    }

    /// <summary>
    /// A conferência não depende de aviso do servidor. Com `client_min_messages = error` na sessão o PostgreSQL deixa de mandar o aviso
    /// "there is no transaction in progress", e uma conferência que contasse com ele passaria a recusar todo comando utilitário.
    /// </summary>
    [Test]
    public async Task Execute_UtilityCommand_WithServerWarningsSilencedInTheSession_StillSucceeds()
    {
        await using var connection = await OpenAsync();
        var table = $"utilitario_{Guid.NewGuid():N}";

        var silenced = await connection.ExecuteAsync("SET client_min_messages = error", CancellationToken.None);
        var created = await connection.ExecuteAsync($"CREATE TABLE loja.{table} (id INTEGER)", CancellationToken.None);
        var dropped = await connection.ExecuteAsync($"DROP TABLE loja.{table}", CancellationToken.None);

        Assert.That(silenced.IsSuccess, Is.True, silenced.IsFailure ? silenced.Error.Message : null);
        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(dropped.IsSuccess, Is.True, dropped.IsFailure ? dropped.Error.Message : null);
    }

    /// <summary>Um comando que não é leitura roda fora da transação da tentativa, como no auto-commit: o que ele ajusta na sessão fica.</summary>
    [Test]
    public async Task Execute_SetCommand_KeepsTheSessionSetting()
    {
        await using var connection = await OpenAsync();

        var set = await connection.ExecuteAsync("SET application_name = 'prism-teste'", CancellationToken.None);
        var shown = await ExecutePageAsync(connection, "SHOW application_name");

        Assert.That(set.IsSuccess, Is.True, set.IsFailure ? set.Error.Message : null);
        Assert.That(shown.Rows[0][0], Is.EqualTo("prism-teste"));
    }

    /// <summary>
    /// RN-SQL-006: "contar total" executa o comando de novo, como subconsulta. Se o comando grava, contar gravaria outra vez: a contagem
    /// roda numa transação só de leitura, e o banco a recusa sem gravar nada.
    /// </summary>
    [Test]
    public async Task Count_OfQueryThatWrites_IsRefusedAndWritesNothing()
    {
        var table = await CreateWriteTableAsync();
        var function = $"loja.grava_{Guid.NewGuid():N}";
        await using var connection = await OpenAsync();
        await connection.ExecuteAsync($"CREATE FUNCTION {function}() RETURNS BIGINT LANGUAGE sql AS 'WITH gravadas AS (UPDATE {table} SET versao = versao + 1 RETURNING 1) SELECT COUNT(*) FROM gravadas'", CancellationToken.None);

        var total = await connection.CountAsync($"SELECT {function}()", CancellationToken.None);
        var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao <> 0");
        var ping = await connection.PingAsync(CancellationToken.None);
        await connection.ExecuteAsync($"DROP FUNCTION {function}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(total.IsFailure, Is.True);
        Assert.That(total.Error.SqlState, Is.EqualTo("25006"));
        Assert.That(written, Is.Zero);
        Assert.That(ping.IsSuccess, Is.True);
    }

    /// <summary>
    /// Uma chave estrangeira para tabela particionada aparece no catálogo uma vez para a tabela e mais uma para cada partição dela. A
    /// árvore mostra a que a pessoa declarou, uma vez; e a partição de uma tabela que tem a chave mostra a chave herdada.
    /// </summary>
    [Test]
    public async Task GetForeignKeys_ToPartitionedTable_ReportsItOnce()
    {
        await using var connection = await OpenAsync();

        var ofTheTable = await connection.GetForeignKeysAsync("loja", "entrega", CancellationToken.None);
        var ofItsPartition = await connection.GetForeignKeysAsync("loja", "entrega_1", CancellationToken.None);

        Assert.That(ofTheTable.IsSuccess && ofItsPartition.IsSuccess, Is.True);
        Assert.That(ofTheTable.Value.Select(foreignKey => (foreignKey.Name, foreignKey.ReferencedTable)), Is.EqualTo(new[] { ("fk_entrega_regiao", "regiao") }));
        Assert.That(ofTheTable.Value.Single().Columns, Is.EqualTo(new[] { "regiao_id" }));
        Assert.That(ofTheTable.Value.Single().ReferencedColumns, Is.EqualTo(new[] { "id" }));
        Assert.That(ofItsPartition.Value.Select(foreignKey => (foreignKey.Name, foreignKey.ReferencedTable)), Is.EqualTo(new[] { ("fk_entrega_regiao", "regiao") }));
    }

    [Test]
    public async Task Cancel_ReportsTheServerMessageAndSqlState()
    {
        await using var connection = await OpenAsync();

        var running = connection.ExecuteAsync(SlowQuery, CancellationToken.None);
        while (await Task.WhenAny(running, Task.Delay(250)) != running)
            connection.Cancel();

        var outcome = await running;

        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Message, Is.EqualTo("canceling statement due to user request"));
        Assert.That(outcome.Error.SqlState, Is.EqualTo("57014"));
        Assert.That(outcome.Error.Outcome, Is.EqualTo(ECancelOutcome.Canceled));
    }

    /// <summary>
    /// RN-SQL-010: o Npgsql espera dois segundos pela resposta do banco a um cancelamento e, sem ela, derruba a conexão. O comando pode
    /// ter sido concluído (aqui ele é: a função engole o cancelamento e segue por mais três segundos, e o `UPDATE` é confirmado). A
    /// resposta não pode dizer que ele foi cancelado: diz que o Prism não sabe, e a conexão não serve mais.
    /// </summary>
    [Test]
    public async Task Cancel_WhenTheDatabaseDoesNotAnswerInTime_SaysTheOutcomeIsUnknown()
    {
        var table = await CreateWriteTableAsync();
        var function = $"loja.teimosa_{Guid.NewGuid():N}";
        var connection = await OpenAsync();
        var created = await connection.ExecuteAsync($"CREATE FUNCTION {function}() RETURNS INTEGER LANGUAGE plpgsql AS $$ BEGIN BEGIN PERFORM pg_sleep(30); EXCEPTION WHEN query_canceled THEN PERFORM pg_sleep(3); END; RETURN 8; END $$", CancellationToken.None);

        var running = connection.ExecuteAsync($"UPDATE {table} SET versao = {function}() WHERE numero = 1001", CancellationToken.None);
        var watch = Stopwatch.StartNew();
        while (await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active' AND query LIKE 'UPDATE {table}%'") == 0 && watch.Elapsed < TimeSpan.FromSeconds(10))
            await Task.Delay(25);

        connection.Cancel();
        var outcome = await running;
        var openAfterwards = connection.IsOpen;

        // O banco conclui o comando depois de a conexão cair, e leva alguns segundos para isso.
        watch.Restart();
        long written;
        while ((written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 8")) == 0 && watch.Elapsed < TimeSpan.FromSeconds(15))
            await Task.Delay(100);

        await connection.DisposeAsync();
        await using (var cleaner = await OpenAsync())
            await cleaner.ExecuteAsync($"DROP FUNCTION {function}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(outcome.Error.Message, Is.EqualTo("O banco não respondeu ao cancelamento a tempo, e a sessão foi encerrada. O Prism não sabe se o comando foi concluído: confira no banco antes de executá-lo de novo."));
        Assert.That(outcome.Error.Outcome, Is.EqualTo(ECancelOutcome.Unknown));
        Assert.That(openAfterwards, Is.False);
        Assert.That(written, Is.EqualTo(1));
    }

    /// <summary>
    /// RN-SQL-010 e Ruling 135: a prova de que, no PostgreSQL, o desfecho `canceled` nunca sai de um comando que gravou. O caso que a
    /// Tarefa 42 levantou: no modo completo (RN-SQL-013) a API lê as linhas com o `ReadAsync` recebendo o pedido de cancelamento, e o
    /// servidor pode já ter terminado de executar, com as linhas ainda vindo. Um `UPDATE ... RETURNING` de 100.000 linhas largas (cerca
    /// de 50 MB de resposta) é cancelado em instantes espalhados: logo ao enviar; com o executor em 10, 50 e 90% das linhas; com o
    /// executor terminado e o servidor só devolvendo as linhas, em frações do tempo que isso leva; e depois do fim. Quem diz a fase é
    /// uma sequência que o `RETURNING` avança a cada linha, lida por outra conexão: sequência não é transacional, e o valor aparece na
    /// hora. A resposta de cada vez é uma de três: `canceled`, e nada gravado; `unknown`, com a sessão encerrada; ou sucesso, com tudo
    /// gravado e o total inteiro. Nunca `canceled` com linhas gravadas, nunca falha sem desfecho, e o cancelamento com o servidor
    /// devolvendo as linhas é exercitado. A saída do teste mostra cada tentativa. A tabela fica em `public`: `loja` tem as tabelas
    /// contadas pelo teste das rotas, que roda ao mesmo tempo.
    /// </summary>
    [Test]
    public async Task Cancel_WhileAWriteReturnsItsRows_IsCanceledOnlyWhenNothingWasWritten()
    {
        const int rows = 100000;
        var suffix = Guid.NewGuid().ToString("N");
        var table = $"public.retorno_{suffix}";
        var progress = $"public.progresso_{suffix}";
        await using var observer = await OpenAsync();
        var connection = await OpenAsync();
        var created = await connection.ExecuteAsync($"CREATE TABLE {table} AS SELECT numero, 0 AS versao FROM generate_series(1, {rows}) AS numero", CancellationToken.None);
        var sequence = await connection.ExecuteAsync($"CREATE SEQUENCE {progress}", CancellationToken.None);

        // Um valor já tirado: daqui em diante cada linha soma exatamente um ao que outra conexão lê.
        await connection.ExecuteAsync($"SELECT nextval('{progress}')", CancellationToken.None);

        // A execução inteira, sem cancelamento, mede as duas fases: até o executor passar pela última linha, e dali ao fim.
        var clock = Stopwatch.StartNew();
        var before = await ProgressAsync();
        var wholeRunning = connection.ExecuteAsync(Command(1), CancellationToken.None);
        var executorEnded = await WaitForProgressAsync(wholeRunning, before + rows) ? clock.ElapsedMilliseconds : -1;
        var whole = await wholeRunning;
        var ended = clock.ElapsedMilliseconds;
        await TestContext.Out.WriteLineAsync($"sem cancelamento: o executor passou pela última linha aos {executorEnded} ms, e a resposta chegou aos {ended} ms");

        var returningMs = Math.Max(ended - executorEnded, 1);
        (string Phase, int Rows, long Delay)[] moments =
        [
            ("ao enviar", 0, 0),
            ("executando", rows / 10, 0), ("executando", rows / 2, 0), ("executando", rows * 9 / 10, 0),
            ("devolvendo as linhas", rows, 0), ("devolvendo as linhas", rows, returningMs / 4), ("devolvendo as linhas", rows, returningMs / 2),
            ("devolvendo as linhas", rows, returningMs * 3 / 4), ("devolvendo as linhas", rows, returningMs * 9 / 10),
            ("depois do fim", rows, returningMs * 3)
        ];
        var crossed = new List<string>();
        var answers = new List<(string Phase, bool ReachedARunningCommand, string Answer)>();

        for (var attempt = 0; attempt < moments.Length; attempt++)
        {
            var (phase, threshold, delay) = moments[attempt];
            var version = attempt + 10;
            if (!connection.IsOpen)
            {
                await connection.DisposeAsync();
                connection = await OpenAsync();
            }

            before = await ProgressAsync();
            var running = connection.ExecuteAsync(Command(version), CancellationToken.None);
            var reached = threshold == 0 || await WaitForProgressAsync(running, before + threshold);
            await Task.Delay((int)delay);
            var reachedARunningCommand = reached && !running.IsCompleted;
            connection.Cancel();
            var outcome = await running;
            var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = {version}");
            var answer = outcome.IsSuccess ? $"sucesso, total {outcome.Value.Page!.TotalRows}" : $"{outcome.Error.Outcome?.ToString() ?? "sem desfecho"} ({outcome.Error.SqlState ?? "sem SQLSTATE"}: {outcome.Error.Message.Split('\n')[0]})";
            answers.Add((phase, reachedARunningCommand, answer));
            await TestContext.Out.WriteLineAsync($"cancelado {phase} ({threshold} linhas), mais {delay} ms{(reachedARunningCommand ? string.Empty : ", com o comando já terminado")}: {answer}; {written} gravadas");

            var consistent = outcome.IsSuccess
                ? written == rows && outcome.Value.Page!.TotalRows == rows
                : outcome.Error.Outcome switch
                {
                    ECancelOutcome.Canceled => written == 0,
                    ECancelOutcome.Unknown => !connection.IsOpen,
                    _ => false
                };
            if (!consistent)
                crossed.Add($"{phase}, mais {delay} ms: {answer} e {written} gravadas");
        }

        await connection.DisposeAsync();
        await using (var cleaner = await OpenAsync())
        {
            await cleaner.ExecuteAsync($"DROP TABLE {table}", CancellationToken.None);
            await cleaner.ExecuteAsync($"DROP SEQUENCE {progress}", CancellationToken.None);
        }

        Assert.That(created.IsSuccess && sequence.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : sequence.IsFailure ? sequence.Error.Message : null);
        Assert.That(whole.IsSuccess, Is.True, whole.IsFailure ? whole.Error.Message : null);
        Assert.That(whole.Value.Page!.TotalRows, Is.EqualTo(rows));
        Assert.That(executorEnded, Is.GreaterThan(0), "a sequência não mostrou o executor passando pela última linha");
        Assert.That(crossed, Is.Empty);
        Assert.That(answers.Where(answer => answer.Phase == "executando").Select(answer => answer.Answer), Has.Some.StartsWith("Canceled (57014"), "nenhum cancelamento interrompeu a execução: o `canceled` pelo banco não foi exercitado");
        Assert.That(answers.Count(answer => answer.Phase == "devolvendo as linhas" && answer.ReachedARunningCommand), Is.GreaterThan(0), "nenhum cancelamento chegou com o servidor devolvendo as linhas: o caso do `ReadAsync` não foi exercitado");

        string Command(int version)
            => $"UPDATE {table} SET versao = {version} RETURNING numero, repeat(md5(numero::TEXT), 16) AS peso, nextval('{progress}') AS ordem";

        async Task<long> ProgressAsync()
            => long.Parse((await ExecutePageAsync(observer, $"SELECT last_value FROM {progress}")).Rows[0][0]!);

        // Espera a sequência chegar ao valor (o executor passou por tantas linhas), ou o comando acabar.
        async Task<bool> WaitForProgressAsync(Task running, long value)
        {
            while (!running.IsCompleted)
            {
                if (await ProgressAsync() >= value)
                    return true;
            }

            return false;
        }
    }

    /// <summary>O `CancellationToken` da requisição também interrompe o comando no banco.</summary>
    [Test]
    public async Task Execute_WhenTheRequestIsAborted_StopsTheQuery()
    {
        await using var connection = await OpenAsync();
        using var aborted = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
        var watch = Stopwatch.StartNew();

        var outcome = await connection.ExecuteAsync(SlowQuery, aborted.Token);
        watch.Stop();
        var ping = await connection.PingAsync(CancellationToken.None);

        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(outcome.Error.Outcome, Is.EqualTo(ECancelOutcome.Canceled));
        Assert.That(watch.Elapsed, Is.LessThan(TimeSpan.FromSeconds(5)));
        Assert.That(ping.IsSuccess, Is.True);
    }

    [Test]
    public async Task GetSchemas_MarksThePgSchemasAndInformationSchemaAsSystem()
    {
        await using var connection = await OpenAsync();

        var schemas = await connection.GetSchemasAsync(CancellationToken.None);

        Assert.That(schemas.IsSuccess, Is.True);
        Assert.That(schemas.Value.Select(schema => (schema.Name, schema.IsSystem)), Is.SupersetOf(new[] { ("public", false), ("pg_catalog", true), ("information_schema", true), ("pg_toast", true) }));
        Assert.That(schemas.Value.TakeWhile(schema => !schema.IsSystem).Select(schema => schema.Name), Is.Ordered.Ascending);
    }

    [Test]
    public async Task GetColumns_ReportsThePostgresTypeNames()
    {
        await using var connection = await OpenAsync();

        var columns = await connection.GetColumnsAsync("loja", "pedido", CancellationToken.None);

        Assert.That(columns.IsSuccess, Is.True);
        Assert.That(columns.Value.Select(column => column.Type), Is.EqualTo(new[] { "integer", "integer", "integer", "numeric(12,2)", "timestamp without time zone", "text" }));
    }

    /// <summary>Uma visão também tem colunas; sem chave primária nem índice.</summary>
    [Test]
    public async Task GetColumns_OfView_ReturnsItsColumns()
    {
        await using var connection = await OpenAsync();

        var columns = await connection.GetColumnsAsync("loja", "pedido_resumo", CancellationToken.None);

        Assert.That(columns.IsSuccess, Is.True);
        Assert.That(columns.Value.Select(column => column.Name), Is.EqualTo(new[] { "cliente_id", "pedidos", "total" }));
        Assert.That(columns.Value.Select(column => column.IsPrimaryKey), Is.All.False);
    }

    /// <summary>
    /// Chave de duas colunas declarada em ordem diferente da tabela: os pares saem na ordem da restrição, cada coluna com a que ela
    /// referencia, e a chave primária marca as duas colunas.
    /// </summary>
    [Test]
    public async Task GetForeignKeys_OfCompositeKey_PairsTheColumnsInConstraintOrder()
    {
        await using var connection = await OpenAsync();
        var suffix = Guid.NewGuid().ToString("N");
        var parent = await connection.ExecuteAsync($"CREATE TABLE loja.mae_{suffix} (a INTEGER NOT NULL, b INTEGER NOT NULL, c INTEGER, PRIMARY KEY (b, a))", CancellationToken.None);
        var child = await connection.ExecuteAsync($"CREATE TABLE loja.filha_{suffix} (x INTEGER, y INTEGER, CONSTRAINT fk_filha_mae FOREIGN KEY (y, x) REFERENCES loja.mae_{suffix} (b, a))", CancellationToken.None);

        var foreignKeys = await connection.GetForeignKeysAsync("loja", $"filha_{suffix}", CancellationToken.None);
        var columns = await connection.GetColumnsAsync("loja", $"mae_{suffix}", CancellationToken.None);
        var indexes = await connection.GetIndexesAsync("loja", $"mae_{suffix}", CancellationToken.None);
        await connection.ExecuteAsync($"DROP TABLE loja.filha_{suffix}", CancellationToken.None);
        await connection.ExecuteAsync($"DROP TABLE loja.mae_{suffix}", CancellationToken.None);

        Assert.That(parent.IsSuccess, Is.True, parent.IsFailure ? parent.Error.Message : null);
        Assert.That(child.IsSuccess, Is.True, child.IsFailure ? child.Error.Message : null);

        var foreignKey = foreignKeys.Value.Single();
        Assert.That(foreignKey.Columns, Is.EqualTo(new[] { "y", "x" }));
        Assert.That(foreignKey.ReferencedTable, Is.EqualTo($"mae_{suffix}"));
        Assert.That(foreignKey.ReferencedColumns, Is.EqualTo(new[] { "b", "a" }));
        Assert.That(columns.Value.Select(column => column.IsPrimaryKey), Is.EqualTo(new[] { true, true, false }));
        Assert.That(indexes.Value.Single().Columns, Is.EqualTo(new[] { "b", "a" }));
    }

    /// <summary>
    /// O resultado vem do servidor em texto, como no psql. Lidos nos tipos do C#, estes valores derrubavam o comando inteiro: o driver
    /// não tem tipo para `numeric` deste tamanho ou NaN, `interval` com meses, data antes de Cristo e `regclass`.
    /// </summary>
    [Test]
    public async Task Execute_ShowsTheValuesTheDriverHasNoTypeFor()
    {
        await using var connection = await OpenAsync();

        var page = await ExecutePageAsync(connection, "SELECT 2::NUMERIC ^ 100 AS potencia, 'NaN'::NUMERIC AS indefinido, age(TIMESTAMP '2026-10-09', TIMESTAMP '2020-01-01') AS idade, DATE '0044-03-15 BC' AS antiga, 'pg_class'::REGCLASS AS relacao, ARRAY[ARRAY[1, 2], ARRAY[3, 4]] AS matriz, INTERVAL '90 minutes' AS duracao");

        Assert.That(page.Rows[0], Is.EqualTo(new[] { "1267650600228229401496703205376", "NaN", "6 years 9 mons 8 days", "0044-03-15 BC", "pg_class", "{{1,2},{3,4}}", "01:30:00" }));
        Assert.That(page.Columns.Select(column => column.Kind), Is.EqualTo(new[] { "number", "number", "text", "datetime", "text", "text", "text" }));
    }

    /// <summary>As tabelas do catálogo têm colunas de tipos que o driver não conhece (`aclitem[]`, `pg_node_tree`, `regproc`): em texto elas abrem.</summary>
    [Test]
    public async Task Execute_SelectFromTheSystemCatalog_Succeeds()
    {
        await using var connection = await OpenAsync();

        var classes = await connection.ExecuteAsync("SELECT * FROM pg_class", CancellationToken.None);
        var procedures = await connection.ExecuteAsync("SELECT * FROM pg_proc", CancellationToken.None);
        var constraints = await connection.ExecuteAsync("SELECT * FROM pg_constraint", CancellationToken.None);

        Assert.That(classes.IsSuccess, Is.True, classes.IsFailure ? classes.Error.Message : null);
        Assert.That(procedures.IsSuccess, Is.True, procedures.IsFailure ? procedures.Error.Message : null);
        Assert.That(constraints.IsSuccess, Is.True, constraints.IsFailure ? constraints.Error.Message : null);
        Assert.That(classes.Value.Page!.Rows, Has.Count.EqualTo(200));
    }

    /// <summary>O modificador do tipo (`numeric(12,2)`, `timestamp(3)`) não muda como a tela alinha a coluna, e um tipo que só começa igual (`daterange`) não é data.</summary>
    [Test]
    public async Task Execute_ClassifiesTheColumnByItsTypeName()
    {
        await using var connection = await OpenAsync();

        var page = await ExecutePageAsync(connection, "SELECT 1.5::NUMERIC(12, 2) AS a, now()::TIMESTAMP(3) AS b, now()::TIMESTAMPTZ(0) AS c, 'x'::VARCHAR(3) AS d, daterange(DATE '2026-01-01', DATE '2026-02-01') AS e, 1::SMALLINT AS f, 1.5::REAL AS g, TIME '12:00' AS h, ARRAY[TRUE] AS i");

        Assert.That(page.Columns.Select(column => column.Type), Is.EqualTo(new[] { "numeric(12, 2)", "timestamp(3) without time zone", "timestamp(0) with time zone", "character varying(3)", "daterange", "smallint", "real", "time without time zone", "boolean[]" }));
        Assert.That(page.Columns.Select(column => column.Kind), Is.EqualTo(new[] { "number", "datetime", "datetime", "text", "text", "number", "number", "datetime", "text" }));
        Assert.That(page.Rows[0][4], Is.EqualTo("[2026-01-01,2026-02-01)"));
        Assert.That(page.Rows[0][8], Is.EqualTo("{t}"));
    }

    /// <summary>RN-SQL-011, pelo driver de verdade: cada célula como texto, sem perder precisão, e o corte marcado em `[linha, coluna]`.</summary>
    [Test]
    public async Task Execute_ReturnsEveryCellAsText_AndMarksTheCutOnes()
    {
        await using var connection = await OpenAsync();

        var page = await ExecutePageAsync(connection, "SELECT 9223372036854775807::BIGINT AS inteiro, 12345678901234567890.1234567890::NUMERIC AS exato, 0.1::FLOAT8 AS aproximado, TRUE AS logico, DATE '2026-10-09' AS dia, TIMESTAMP '2026-10-09 13:05:07.123456' AS instante, NULL::TEXT AS nulo, '\\xDEADBEEF'::BYTEA AS binario, ARRAY[1, 2, 3] AS vetor, repeat('x', 20000) AS longo, decode(repeat('00', 100), 'hex') AS binario_longo UNION ALL SELECT 1, 2, 3, FALSE, DATE '2026-01-01', TIMESTAMP '2026-01-01 00:00:00', 'a', '\\x00'::BYTEA, ARRAY[4], repeat('y', 10001), '\\x01'::BYTEA");

        Assert.That(page.Columns.Select(column => column.Kind), Is.EqualTo(new[] { "number", "number", "number", "boolean", "datetime", "datetime", "text", "binary", "text", "text", "binary" }));
        Assert.That(page.Columns.Select(column => column.Type), Is.EqualTo(new[] { "bigint", "numeric", "double precision", "boolean", "date", "timestamp without time zone", "text", "bytea", "integer[]", "text", "bytea" }));
        Assert.That(page.Rows[0].Take(9), Is.EqualTo(new[] { "9223372036854775807", "12345678901234567890.1234567890", "0.1", "true", "2026-10-09", "2026-10-09 13:05:07.123456", null, "0xDEADBEEF", "{1,2,3}" }));
        Assert.That(page.Rows[1].Take(9), Is.EqualTo(new[] { "1", "2", "3", "false", "2026-01-01", "2026-01-01 00:00:00", "a", "0x00", "{4}" }));
        Assert.That(page.Rows[0][9], Is.EqualTo(new string('x', 10000)));
        Assert.That(page.Rows[0][10], Is.EqualTo("0x" + new string('0', 64)));
        Assert.That(page.Rows[1][9], Is.EqualTo(new string('y', 10000)));
        Assert.That(page.TruncatedCells, Is.EqualTo(new[] { new[] { 0, 9 }, new[] { 0, 10 }, new[] { 1, 9 } }));
    }

    /// <summary>
    /// RN-SQL-004 e 005, com o que mede o produto: a primeira página de uma tabela de 200.000 linhas largas (cerca de 120 MB) chega sem
    /// o driver ler o resultado inteiro, e fechar o cursor no meio não espera o resto das linhas atravessar a rede. O limite de tempo é
    /// folgado de propósito (a medida real fica em dezenas de milissegundos); o de memória é o que prova que nada foi lido além da página.
    /// </summary>
    [Test]
    public async Task Execute_OnHugeTable_ReturnsFirstPageQuickly()
    {
        await using var connection = await OpenAsync();
        var created = await connection.ExecuteAsync("CREATE TABLE IF NOT EXISTS loja.grande AS SELECT numero AS id, repeat(md5(numero::TEXT), 4) AS a, repeat(md5((numero + 1)::TEXT), 4) AS b, repeat(md5((numero + 2)::TEXT), 4) AS c, repeat(md5((numero + 3)::TEXT), 4) AS d, (numero * 1.5)::NUMERIC(18, 4) AS valor FROM generate_series(1, 200000) AS numero", CancellationToken.None);
        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);

        var memoryBefore = GC.GetTotalMemory(forceFullCollection: true);
        var watch = Stopwatch.StartNew();
        var page = await ExecutePageAsync(connection, "SELECT * FROM loja.grande");
        var firstPage = watch.Elapsed;
        var memoryAfter = GC.GetTotalMemory(forceFullCollection: true);

        watch.Restart();
        var next = await connection.FetchNextAsync(CancellationToken.None);
        var nextPage = watch.Elapsed;

        watch.Restart();
        await connection.CloseCursorAsync();
        var closing = watch.Elapsed;
        var ping = await connection.PingAsync(CancellationToken.None);

        Assert.That(page.Rows, Has.Count.EqualTo(200));
        Assert.That(page.HasMore, Is.True);
        Assert.That(next.IsSuccess, Is.True);
        Assert.That(next.Value.Rows, Has.Count.EqualTo(200));
        Assert.That(firstPage, Is.LessThan(TimeSpan.FromSeconds(2)));
        Assert.That(nextPage, Is.LessThan(TimeSpan.FromSeconds(2)));
        Assert.That(closing, Is.LessThan(TimeSpan.FromSeconds(2)));
        Assert.That(memoryAfter - memoryBefore, Is.LessThan(16 * 1024 * 1024));
        Assert.That(ping.IsSuccess, Is.True);
    }

    /// <summary>
    /// RN-SQL-003: o PostgreSQL encerra o comentário `--` também no retorno de carro, e o `BEGIN` que vem depois dele é o comando que
    /// o banco executaria. No Db2 e no Informix o comentário segue até a quebra de linha, e por isso o caso é só daqui.
    /// </summary>
    [Test]
    public async Task Execute_TransactionControlAfterALineCommentEndedByACarriageReturn_IsRefused()
    {
        await using var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync("-- abre\rBEGIN", CancellationToken.None);
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);

        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Kind, Is.EqualTo(EDatabaseFailure.TransactionControlNotSupported));
        Assert.That(pending, Is.Zero);
    }
}
