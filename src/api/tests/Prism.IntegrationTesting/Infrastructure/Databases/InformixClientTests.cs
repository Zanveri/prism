using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Extensions;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// O driver do Informix contra um Informix de verdade, pela porta DRDA: o contrato comum (`DatabaseClientContractTests`), o que é do
/// driver da IBM (`IbmClientContractTests`) e o que só existe neste banco: o dono como esquema, o comentário entre chaves, a
/// transação que um `BEGIN WORK` abre mesmo em auto-commit, e o banco sem log.
/// </summary>
[TestFixture]
[Category("Databases")]
[Category("Informix")]
public sealed class InformixClientTests : IbmClientContractTests
{
    /// <summary>O que as conexões deste fixture escrevem no log: é onde os testes da sonda de transação leem o que ela disse (RN-LOG-001).</summary>
    private readonly CollectingSink _log = new();

    protected override EDatabaseEngine Engine => EDatabaseEngine.Informix;

    protected override string SyntaxErrorSqlState => "42000";

    protected override string ExecutionCounterSetup => "SELECT loja.execucoes.NEXTVAL FROM systables WHERE tabid = 1";

    // Numa tabela derivada lida primeiro (a diretiva fixa a ordem da junção), o valor seguinte da sequência é pedido uma vez por
    // execução; na lista de colunas, ou com a tabela derivada por dentro do laço, seria uma vez por linha.
    protected override string CountedQuery => "SELECT /*+ ORDERED */ pedido.numero, execucao.numero AS execucao FROM (SELECT loja.execucoes.NEXTVAL AS numero FROM systables WHERE tabid = 1) AS execucao, loja.pedido AS pedido ORDER BY pedido.numero";

    protected override string ExecutionCountQuery => "SELECT loja.execucoes.CURRVAL FROM systables WHERE tabid = 1";

    protected override string LargeReadQuery => "SELECT pedido.numero, LPAD('x', 500, 'x') AS peso FROM loja.pedido AS pedido, (SELECT tabid FROM systables WHERE tabid <= 20) AS copia";

    // As travas das outras sessões em `pedido`, mais as transações delas que já gravaram. Uma leitura com o cursor aberto não aparece
    // aqui: no Informix ela fica em auto-commit, sem transação nem trava. Só contam as sessões com o banco `prism` aberto: nos
    // primeiros segundos depois de subir, o servidor grava nos bancos dele mesmo, e a contagem saía diferente de zero sem ninguém
    // ter tocado no banco do teste.
    protected override string PendingWorkQuery => "SELECT (SELECT COUNT(*) FROM sysmaster:syslocks AS travas WHERE travas.dbsname = 'prism' AND travas.tabname = 'pedido' AND travas.owner <> DBINFO('sessionid'))::INTEGER + (SELECT COUNT(*) FROM sysmaster:sysrstcb AS sessoes, sysmaster:systxptab AS transacoes WHERE transacoes.address = sessoes.txp AND sessoes.sid <> DBINFO('sessionid') AND transacoes.logbeg > 0 AND sessoes.sid IN (SELECT abertos.odb_sessionid FROM sysmaster:sysopendb AS abertos WHERE abertos.odb_dbname = 'prism'))::INTEGER FROM systables WHERE tabid = 1";

    protected override bool OpenReadCursorHoldsWork => false;

    /// <summary>O Informix guarda em minúsculas o nome escrito sem aspas.</summary>
    protected override string Name(string name)
        => name.ToLowerInvariant();

    protected override string WriteReturningRows(string table)
        => $"EXECUTE FUNCTION teste.grava_versao('{table}')";

    protected override string ForeignKey(string name, string columns, string referenced)
        => $"FOREIGN KEY ({columns}) REFERENCES {referenced} CONSTRAINT {name}";

    protected override Task<ConnectionSettings> StartDatabaseAsync()
        => InformixSingleton.GetSettingsAsync();

    /// <summary>Além do driver instalado, o log das conexões vai para <see cref="_log"/>, com todos os níveis.</summary>
    protected override async Task ConfigureAsync(IServiceCollection services)
    {
        await base.ConfigureAsync(services);
        services.AddSingleton<ILogger>(new LoggerConfiguration().MinimumLevel.Verbose().WriteTo.Sink(_log).CreateLogger());
    }

    /// <summary>As linhas de log escritas depois da marca, do nível pedido para cima.</summary>
    private string[] Logged(int mark, LogEventLevel from)
        => [.. _log.Events.Skip(mark).Where(logged => logged.Level >= from).Select(logged => logged.RenderMessage())];

    /// <summary>
    /// RN-CONN-013: a consulta de verificação do Informix é `SELECT 1 FROM systables WHERE tabid = 1`. O servidor guarda o último
    /// comando de cada sessão, e o da sessão que fez o `Ping` é esse.
    /// </summary>
    [Test]
    public async Task Informix_Ping_UsesSystablesQuery()
    {
        await using var connection = await OpenAsync();
        var session = (await ExecutePageAsync(connection, "SELECT DBINFO('sessionid') FROM systables WHERE tabid = 1")).Rows[0][0];

        var ping = await connection.PingAsync(CancellationToken.None);
        await using var observer = await OpenAsync();
        var last = await ExecutePageAsync(observer, $"SELECT sqs_statement FROM sysmaster:syssqlstat WHERE sqs_sessionid = {session}");

        Assert.That(ping.IsSuccess, Is.True, ping.IsFailure ? ping.Error.Message : null);
        Assert.That(last.Rows.Select(row => row[0]!.Trim()), Has.Member("SELECT 1 FROM systables WHERE tabid = 1"));
    }

    /// <summary>RN-TX-013: o banco com log tem transação, e o sem log (`prism_sem_log`), não: nele o Commit manual não existe.</summary>
    [Test]
    public async Task Informix_TransactionsAvailable_OnlyInTheLoggedDatabase()
    {
        await using var logged = await OpenAsync();
        var unloggedOpened = await Client.OpenAsync(await InformixSingleton.GetUnloggedSettingsAsync(), CancellationToken.None);
        Assert.That(unloggedOpened.IsSuccess, Is.True, unloggedOpened.IsFailure ? unloggedOpened.Error.Message : null);
        await using var unlogged = unloggedOpened.Value;

        var inLogged = await logged.TransactionsAvailableAsync(CancellationToken.None);
        var inUnlogged = await unlogged.TransactionsAvailableAsync(CancellationToken.None);

        Assert.That((inLogged.IsSuccess, inLogged.IsSuccess && inLogged.Value), Is.EqualTo((true, true)));
        Assert.That((inUnlogged.IsSuccess, inUnlogged.IsSuccess && inUnlogged.Value), Is.EqualTo((true, false)));
    }

    /// <summary>RN-ARVORE-004: no Informix "esquema" é o dono do objeto. De sistema é o `informix`, dono do catálogo, que vem por último.</summary>
    [Test]
    public async Task Informix_Schemas_AreObjectOwners()
    {
        await using var connection = await OpenAsync();

        var schemas = await connection.GetSchemasAsync(CancellationToken.None);
        var catalog = await connection.GetObjectsAsync("informix", "tables", CancellationToken.None);

        Assert.That(schemas.IsSuccess, Is.True, schemas.IsFailure ? schemas.Error.Message : null);
        Assert.That(schemas.Value.Select(schema => (schema.Name, schema.IsSystem)), Is.EqualTo(new[] { ("loja", false), ("teste", false), ("informix", true) }));
        Assert.That(catalog.Value.Select(table => (table.Name, table.Kind)), Has.Member(("systables", "table")));
    }

    /// <summary>RN-SQL-006: `SELECT COUNT(*) FROM (comando) AS t` funciona no Informix, inclusive com `ORDER BY` e `FIRST` dentro.</summary>
    [Test]
    public async Task Informix_Count_Works()
    {
        await using var connection = await OpenAsync();

        var ordered = await connection.CountAsync("SELECT numero FROM loja.pedido WHERE numero <= 1500 ORDER BY numero DESC;", CancellationToken.None);
        var first = await connection.CountAsync("SELECT FIRST 5 * FROM loja.pedido", CancellationToken.None);
        var joined = await connection.CountAsync("SELECT * FROM loja.pedido, loja.cliente WHERE cliente.id = pedido.cliente_id", CancellationToken.None);

        Assert.That(ordered.IsSuccess, Is.True, ordered.IsFailure ? ordered.Error.Message : null);
        Assert.That(ordered.Value, Is.EqualTo(500));
        Assert.That(first.Value, Is.EqualTo(5));
        Assert.That(joined.Value, Is.EqualTo(1000));
    }

    [Test]
    public async Task Open_UnknownDatabase_ReturnsConnectionFailedWithSqlState()
    {
        var opened = await Client.OpenAsync(Settings with { Database = "nao_existe" }, CancellationToken.None);

        Assert.That(opened.IsFailure, Is.True);
        Assert.That(opened.Error.Kind, Is.EqualTo(EDatabaseFailure.ConnectionFailed));
        Assert.That(opened.Error.Message, Does.Contain("SQL30061N"));
        Assert.That(opened.Error.SqlState, Is.EqualTo("08004"));
    }

    [Test]
    public async Task GetColumns_ReportsTheInformixTypeNames()
    {
        await using var connection = await OpenAsync();
        var table = $"tipos_{Guid.NewGuid():N}";
        var created = await connection.ExecuteAsync($"CREATE TABLE loja.{table} (a SERIAL NOT NULL, b CHAR(5), c VARCHAR(30), d LVARCHAR(500), e DECIMAL(31, 4), f MONEY(16, 2), g DATETIME YEAR TO FRACTION(5), h DATETIME HOUR TO MINUTE, i INTERVAL DAY(3) TO SECOND, j DATE, k BOOLEAN, l BIGINT, m FLOAT, n DECIMAL(16), o TEXT, p BYTE)", CancellationToken.None);

        var pedido = await connection.GetColumnsAsync("loja", "pedido", CancellationToken.None);
        var columns = await connection.GetColumnsAsync("loja", table, CancellationToken.None);
        await connection.ExecuteAsync($"DROP TABLE loja.{table}", CancellationToken.None);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(pedido.Value.Select(column => column.Type), Is.EqualTo(new[] { "INTEGER", "INTEGER", "INTEGER", "DECIMAL(12,2)", "DATETIME YEAR TO SECOND", "VARCHAR(200)" }));
        Assert.That(columns.Value.Select(column => column.Type), Is.EqualTo(new[] { "SERIAL", "CHAR(5)", "VARCHAR(30)", "LVARCHAR(500)", "DECIMAL(31,4)", "MONEY(16,2)", "DATETIME YEAR TO FRACTION(5)", "DATETIME HOUR TO MINUTE", "INTERVAL DAY TO SECOND", "DATE", "BOOLEAN", "BIGINT", "FLOAT", "DECIMAL(16)", "TEXT", "BYTE" }));
        Assert.That(columns.Value.Select(column => column.IsNullable), Is.EqualTo(new[] { false, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true }));
    }

    /// <summary>RN-SQL-009: a mensagem é a do Informix, e o SQLSTATE vem (`IX000` no que ele não classifica). O driver não informa a posição.</summary>
    [Test]
    public async Task Execute_Errors_ReportTheDatabaseMessageAndSqlState()
    {
        await using var connection = await OpenAsync();

        var syntax = await connection.ExecuteAsync("SELECT numero FORM loja.pedido", CancellationToken.None);
        var missing = await connection.ExecuteAsync("SELECT * FROM loja.tabela_que_nao_existe", CancellationToken.None);
        var duplicate = await connection.ExecuteAsync("INSERT INTO loja.cliente (id, nome) VALUES (1, 'Repetido')", CancellationToken.None);

        Assert.That(syntax.Error.Message, Does.Contain("A syntax error has occurred."));
        Assert.That(syntax.Error.SqlState, Is.EqualTo("42000"));
        Assert.That(syntax.Error.Position, Is.Null);
        Assert.That(missing.Error.Message, Does.Contain("tabela_que_nao_existe").And.Contain("is not in the database"));
        Assert.That(missing.Error.SqlState, Is.EqualTo("42000"));
        Assert.That(duplicate.Error.Message, Does.Contain("Unique constraint").Or.Contain("duplicate"));
        Assert.That(duplicate.Error.SqlState, Is.Not.Empty);
    }

    /// <summary>
    /// RN-SQL-003: `BEGIN WORK`, `COMMIT WORK` e `ROLLBACK WORK` são recusados sem ir ao banco, também depois de um comentário entre
    /// chaves, que só o Informix tem, e de um comentário de bloco, que nele acaba no primeiro `*/`.
    /// </summary>
    [Test]
    public async Task Execute_TransactionControl_InTheInformixForms_IsRefused()
    {
        var table = await CreateWriteTableAsync();
        await using var connection = await OpenAsync();

        var refused = new List<EDatabaseFailure>();
        foreach (var sql in new[] { "BEGIN WORK", "begin work;", "COMMIT WORK", "ROLLBACK WORK", "ROLLBACK WORK TO SAVEPOINT ponto", "RELEASE SAVEPOINT ponto", "{ abre } BEGIN WORK", "{ a; b }\n{ c } begin", "/* a /* b */ BEGIN WORK", "-- abre\nBEGIN WORK" })
            refused.Add((await connection.ExecuteAsync(sql, CancellationToken.None)).Error.Kind);

        var written = await connection.ExecuteAsync($"UPDATE {table} SET versao = 4 WHERE numero = 1004", CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 4");
        await DropAsync(table);

        Assert.That(refused, Is.All.EqualTo(EDatabaseFailure.TransactionControlNotSupported));
        Assert.That(written.IsSuccess, Is.True, written.IsFailure ? written.Error.Message : null);
        Assert.That(seen, Is.EqualTo(1));
    }

    /// <summary>
    /// RN-SESSAO-005, a rede de segurança. No Informix um `BEGIN WORK` que chega ao banco abre uma transação que o auto-commit do
    /// driver não fecha: o que fosse gravado depois sumiria com a sessão. O teste chega ao banco pulando a recusa de propósito: a
    /// resposta é a mesma recusa, a transação já foi desfeita, e a gravação seguinte é vista pelas outras conexões.
    /// </summary>
    [Test]
    public async Task Execute_BeginWorkThatGetsPastTheRefusal_IsRolledBackAndRefused()
    {
        var table = await CreateWriteTableAsync();
        var connection = await OpenAsync();

        var begun = await connection.ExecutePastTheTransactionControlRefusalAsync("BEGIN WORK", CancellationToken.None);
        var written = await connection.ExecuteAsync($"UPDATE {table} SET versao = 9 WHERE numero = 1001", CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        await connection.DisposeAsync();
        var seenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        await DropAsync(table);

        Assert.That(begun.IsFailure, Is.True);
        Assert.That(begun.Error.Kind, Is.EqualTo(EDatabaseFailure.TransactionControlNotSupported));
        Assert.That(written.IsSuccess, Is.True, written.IsFailure ? written.Error.Message : null);
        Assert.That(seen, Is.EqualTo(1));
        Assert.That(pending, Is.Zero);
        Assert.That(seenAfterClosing, Is.EqualTo(1));
    }

    /// <summary>
    /// A forma que a recusa por texto não vê: uma rotina que abre a transação por dentro, chamada por `EXECUTE PROCEDURE` (sem linhas)
    /// ou por `EXECUTE FUNCTION` (com linhas). A sonda acha a transação, ela é desfeita, e o comando é recusado; a gravação seguinte é
    /// confirmada como qualquer outra.
    /// </summary>
    [TestCase("EXECUTE PROCEDURE teste.abre_transacao()")]
    [TestCase("EXECUTE FUNCTION teste.abre_transacao_e_devolve()")]
    public async Task Execute_RoutineThatLeavesATransactionOpen_IsRolledBackAndRefused(string call)
    {
        var table = await CreateWriteTableAsync();
        var connection = await OpenAsync();

        var called = await connection.ExecuteAsync(call, CancellationToken.None);
        var written = await connection.ExecuteAsync($"UPDATE {table} SET versao = 9 WHERE numero = 1001", CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        await connection.DisposeAsync();
        var seenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        await DropAsync(table);

        Assert.That(called.IsFailure, Is.True);
        Assert.That(called.Error.Kind, Is.EqualTo(EDatabaseFailure.TransactionControlNotSupported));
        Assert.That(written.IsSuccess, Is.True, written.IsFailure ? written.Error.Message : null);
        Assert.That(seen, Is.EqualTo(1));
        Assert.That(seenAfterClosing, Is.EqualTo(1));
    }

    /// <summary>
    /// A sonda que falha por outro motivo não recusa o comando que o banco confirmou. `CLOSE DATABASE` deixa a sessão sem banco: o
    /// `BEGIN WORK` da sonda é recusado com um erro que não é o de transação aberta, e o `ROLLBACK` da limpeza também. O comando
    /// continua sendo sucesso; a conexão, que não serve para mais nada, é fechada, e o comando seguinte diz isso.
    /// </summary>
    [Test]
    public async Task Execute_WhenTheTransactionProbeFailsForAnotherReason_KeepsTheSuccess_AndClosesTheConnection()
    {
        var connection = await OpenAsync();

        var closed = await connection.ExecuteAsync("CLOSE DATABASE", CancellationToken.None);
        var openAfterwards = connection.IsOpen;
        var next = await connection.ExecuteAsync("SELECT 1 FROM systables WHERE tabid = 1", CancellationToken.None);
        await connection.DisposeAsync();

        Assert.That(closed.IsSuccess, Is.True, closed.IsFailure ? closed.Error.Message : null);
        Assert.That(closed.Value.RowsAffected, Is.Zero);
        Assert.That(openAfterwards, Is.False);
        Assert.That(next.IsFailure, Is.True);
        Assert.That(next.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(next.Error.Message, Does.StartWith("A conexão com o banco foi encerrada"));
    }

    /// <summary>
    /// A sonda de transação que vem depois de cada comando utilitário e de cada rotina não os estraga: criar tabela, chamar uma
    /// função que grava e ajustar a sessão continuam respondendo sucesso, e o que foi gravado fica.
    /// </summary>
    [Test]
    public async Task Execute_UtilityCommandsAndRoutines_StillSucceed()
    {
        await using var connection = await OpenAsync();
        var table = $"utilitario_{Guid.NewGuid():N}";

        var created = await connection.ExecuteAsync($"CREATE TABLE loja.{table} (numero INTEGER NOT NULL, versao INTEGER NOT NULL)", CancellationToken.None);
        var set = await connection.ExecuteAsync("SET LOCK MODE TO WAIT 5", CancellationToken.None);
        var inserted = await connection.ExecuteAsync($"INSERT INTO loja.{table} VALUES (1, 0)", CancellationToken.None);
        var called = await connection.ExecuteAsync($"EXECUTE FUNCTION teste.grava_versao('loja.{table}')", CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM loja.{table} WHERE versao = 1");
        var temporary = await connection.ExecuteAsync($"SELECT numero FROM loja.{table} INTO TEMP rascunho", CancellationToken.None);
        var kept = await ExecutePageAsync(connection, "SELECT COUNT(*) FROM rascunho");
        var dropped = await connection.ExecuteAsync($"DROP TABLE loja.{table}", CancellationToken.None);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(set.IsSuccess, Is.True, set.IsFailure ? set.Error.Message : null);
        Assert.That(inserted.Value.RowsAffected, Is.EqualTo(1));
        Assert.That(called.IsSuccess, Is.True, called.IsFailure ? called.Error.Message : null);
        Assert.That(called.Value.Page!.TotalRows, Is.EqualTo(1));
        Assert.That(seen, Is.EqualTo(1));
        Assert.That(temporary.IsSuccess, Is.True, temporary.IsFailure ? temporary.Error.Message : null);
        Assert.That(kept.Rows[0][0], Is.EqualTo("1"));
        Assert.That(dropped.IsSuccess, Is.True, dropped.IsFailure ? dropped.Error.Message : null);
    }

    /// <summary>
    /// Num banco sem log não existe transação: `BEGIN WORK`, `COMMIT WORK` e `ROLLBACK WORK` são erro. O driver lê, pagina, conta e
    /// grava nele sem mandar nenhum dos três, e a sonda de transação lê a recusa do banco como "não há transação".
    /// </summary>
    [Test]
    public async Task UnloggedDatabase_ReadsPagesCountsAndWrites()
    {
        var unlogged = Settings with { Database = InformixSingleton.UnloggedDatabase };
        var opened = await Client.OpenAsync(unlogged, CancellationToken.None);
        Assert.That(opened.IsSuccess, Is.True, opened.IsFailure ? opened.Error.Message : null);
        await using var connection = opened.Value;
        var table = $"escrita_{Guid.NewGuid():N}";

        var first = await connection.ExecuteAsync("SELECT valor FROM numero ORDER BY valor", CancellationToken.None);
        var second = await connection.FetchNextAsync(CancellationToken.None);
        await connection.CloseCursorAsync();
        var total = await connection.CountAsync("SELECT valor FROM numero", CancellationToken.None);
        var created = await connection.ExecuteAsync($"CREATE TABLE {table} (valor INTEGER)", CancellationToken.None);
        var inserted = await connection.ExecuteAsync($"INSERT INTO {table} SELECT valor FROM numero", CancellationToken.None);
        var refused = await connection.ExecuteAsync("BEGIN WORK", CancellationToken.None);
        var dropped = await connection.ExecuteAsync($"DROP TABLE {table}", CancellationToken.None);

        Assert.That(first.IsSuccess, Is.True, first.IsFailure ? first.Error.Message : null);
        Assert.That(first.Value.Page!.Rows, Has.Count.EqualTo(200));
        Assert.That(first.Value.Page.HasMore, Is.True);
        Assert.That(second.IsSuccess, Is.True, second.IsFailure ? second.Error.Message : null);
        Assert.That(second.Value.Rows[0][0], Is.EqualTo("201"));
        Assert.That(total.Value, Is.EqualTo(1000));
        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(inserted.Value.RowsAffected, Is.EqualTo(1000));
        Assert.That(refused.Error.Kind, Is.EqualTo(EDatabaseFailure.TransactionControlNotSupported));
        Assert.That(dropped.IsSuccess, Is.True, dropped.IsFailure ? dropped.Error.Message : null);
        Assert.That(connection.IsOpen, Is.True);
    }

    /// <summary>
    /// RN-SQL-011, pelo driver de verdade: cada célula como texto, sem perder precisão. `DECIMAL(31)` não cabe no decimal do C#, que
    /// cortava as casas. O banco do contêiner é Latin-1: o acento vai e volta. `BOOLEAN` chega do driver como número (0 ou 1).
    /// </summary>
    [Test]
    public async Task Execute_ReturnsEveryCellAsText_WithoutLosingPrecision()
    {
        await using var connection = await OpenAsync();
        var table = $"celulas_{Guid.NewGuid():N}";
        var created = await connection.ExecuteAsync($"CREATE TABLE loja.{table} (exato DECIMAL(31, 4), dinheiro MONEY(16, 2), instante DATETIME YEAR TO FRACTION(5), segundo DATETIME YEAR TO SECOND, hora DATETIME HOUR TO MINUTE, dia DATE, inteiro BIGINT, aproximado FLOAT, logico BOOLEAN, nulo VARCHAR(10), acento VARCHAR(40), longo LVARCHAR(20000))", CancellationToken.None);
        var inserted = await connection.ExecuteAsync($"INSERT INTO loja.{table} VALUES (123456789012345678901234567.1234, -1234567.50, DATETIME (2026-10-09 13:05:07.12345) YEAR TO FRACTION(5), DATETIME (2026-10-09 13:05:07) YEAR TO SECOND, DATETIME (13:05) HOUR TO MINUTE, MDY(10, 9, 2026), 9223372036854775807, 0.1, 't', NULL, 'São Paulo ação ç ã é ü', LPAD('x', 20000, 'x'))", CancellationToken.None);

        var page = await ExecutePageAsync(connection, $"SELECT * FROM loja.{table}");
        await connection.ExecuteAsync($"DROP TABLE loja.{table}", CancellationToken.None);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(inserted.IsSuccess, Is.True, inserted.IsFailure ? inserted.Error.Message : null);
        Assert.That(page.Columns.Select(column => column.Kind), Is.EqualTo(new[] { "number", "number", "datetime", "datetime", "datetime", "datetime", "number", "number", "number", "text", "text", "text" }));
        Assert.That(page.Rows[0].Take(11), Is.EqualTo(new[] { "123456789012345678901234567.1234", "-1234567.50", "2026-10-09 13:05:07.123450", "2026-10-09 13:05:07.000000", "13:05:00", "2026-10-09", "9223372036854775807", "0.1", "1", null, "São Paulo ação ç ã é ü" }));
        Assert.That(page.Rows[0][11], Is.EqualTo(new string('x', 10000)));
        Assert.That(page.TruncatedCells, Is.EqualTo(new[] { new[] { 0, 11 } }));
    }

    /// <summary>Um texto em Latin-1 (o do banco do contêiner) com acentos, aspas e números, sem `|`, barra invertida nem quebra de linha (o `LOAD` os leria).</summary>
    private static string LatinText(int length, char mark)
    {
        var text = new StringBuilder();
        for (var index = 0; text.Length < length; index++)
            text.Append($"{{\"{mark}{index}\":\"Ação nº {index} em São Paulo, 'aspas' ç ã é ü ½\"}},");

        return text.ToString(0, length);
    }

    /// <summary>
    /// RN-SQL-017, pelo driver de verdade: o `CLOB` e o `TEXT` de 50.000 caracteres e o `LVARCHAR` de 30.000 chegam inteiros ao leitor
    /// (o driver não corta nada), a grade recebe os 10.000 primeiros, e a página leva o valor completo de cada um, igual, byte por byte,
    /// ao que foi gravado. Quem grava é o `dbaccess` do contêiner: o `TEXT` só entra por parâmetro ou pelo `LOAD`, e o `CLOB` acima dos
    /// 32 KB de um literal, pelo `FILETOCLOB`.
    /// </summary>
    [Test]
    public async Task Execute_LongClobTextAndLvarchar_CarryTheWholeValue()
    {
        var table = $"longos_{Guid.NewGuid():N}";
        var (clob, text, lvarchar) = (LatinText(50000, 'c'), LatinText(50000, 't'), LatinText(30000, 'l'));
        await InformixSingleton.RunScriptAsync(
            $"CREATE TABLE loja.{table} (id INTEGER, c CLOB, t TEXT, l LVARCHAR(32000));\nLOAD FROM '/tmp/{table}.unl' INSERT INTO loja.{table} (id, t, l);\nUPDATE loja.{table} SET c = FILETOCLOB('/tmp/{table}.txt', 'server') WHERE id = 1;",
            new Dictionary<string, byte[]> { [$"/tmp/{table}.unl"] = Encoding.Latin1.GetBytes($"1|{text}|{lvarchar}|\n"), [$"/tmp/{table}.txt"] = Encoding.Latin1.GetBytes(clob) });
        await using var connection = await OpenAsync();

        var page = await ExecutePageAsync(connection, $"SELECT id, c, t, l FROM loja.{table}");
        var dropped = await connection.ExecuteAsync($"DROP TABLE loja.{table}", CancellationToken.None);

        Assert.That(dropped.IsSuccess, Is.True, dropped.IsFailure ? dropped.Error.Message : null);
        Assert.That(page.Columns.Select(column => column.Kind), Is.EqualTo(new[] { "number", "text", "text", "text" }));
        Assert.That(page.Rows[0][1..], Is.EqualTo(new[] { clob[..10000], text[..10000], lvarchar[..10000] }));
        Assert.That(page.TruncatedCells, Is.EqualTo(new[] { new[] { 0, 1 }, new[] { 0, 2 }, new[] { 0, 3 } }));
        var full = page.FullValues!.Select(value => value.Write()).ToArray();
        Assert.That(full.Select(Encoding.Latin1.GetBytes), Is.EqualTo(new[] { clob, text, lvarchar }.Select(Encoding.Latin1.GetBytes)));
        Assert.That(full, Is.EqualTo(new[] { clob, text, lvarchar }));
    }

    /// <summary>
    /// Rotinas do Informix declaradas como `RETURNING LVARCHAR` sem comprimento explícito (como `sysadmin:task`) têm precisão
    /// estática de 2.048 bytes em `sysprocedures`, e o servidor DRDA do Informix trunca o retorno de `EXECUTE FUNCTION` em 2.048
    /// bytes. A conexão envolve a chamada em `SELECT CAST(... AS CLOB) FROM TABLE(SET{1})`, trazendo o texto inteiro
    /// para a página e para `FullValues` (F7).
    /// </summary>
    [Test]
    public async Task Execute_RoutineReturningDefaultLvarchar_DoesNotTruncateAt2048Bytes()
    {
        var table = await CreateWriteTableAsync();
        var writingRoutine = $"grava_{Guid.NewGuid():N}";
        await using var connection = await OpenAsync();
        var created = await connection.ExecuteAsync($"CREATE FUNCTION teste.{writingRoutine}() RETURNING LVARCHAR; UPDATE {table} SET versao = 5 WHERE numero = 1001; RETURN 'atualizado'; END FUNCTION;", CancellationToken.None);

        var taskPage = await ExecutePageAsync(connection, "execute function sysadmin:task ('onstat', '-a')");
        var writingPage = await ExecutePageAsync(connection, $"EXECUTE FUNCTION teste.{writingRoutine}()");
        var updated = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 5");
        var dropped = await connection.ExecuteAsync($"DROP FUNCTION teste.{writingRoutine}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(dropped.IsSuccess, Is.True, dropped.IsFailure ? dropped.Error.Message : null);
        Assert.That(taskPage.Columns[0].Name, Is.Empty);
        Assert.That(taskPage.Columns[0].Type, Is.EqualTo("CLOB"));
        Assert.That(taskPage.Rows[0][0]!.Length, Is.EqualTo(10000));
        Assert.That(taskPage.TruncatedCells, Is.EqualTo(new[] { new[] { 0, 0 } }));
        Assert.That(taskPage.FullValues![0].Write().Length, Is.GreaterThan(10000));
        Assert.That(writingPage.Rows[0][0], Is.EqualTo("atualizado"));
        Assert.That(updated, Is.EqualTo(1));
    }

    /// <summary>
    /// RN-SQL-001 e RN-SESSAO-005: um comando com contagem de linhas seguido de `BEGIN WORK`, num envio só. O driver executava os
    /// dois: a resposta era o sucesso do primeiro, a conexão ficava dentro de uma transação, e tudo o que fosse gravado depois sumia
    /// quando a sessão fechasse. O envio é recusado sem ir ao banco: nada dele é executado, e a gravação seguinte é confirmada como
    /// qualquer outra.
    /// </summary>
    [TestCase("UPDATE {0} SET versao = versao WHERE numero = 1019")]
    [TestCase("INSERT INTO {0} (numero, versao) VALUES (9001, 0)")]
    [TestCase("DELETE FROM {0} WHERE numero = 1019")]
    public async Task Execute_CountedCommandFollowedByBeginWork_IsRefused_AndLeavesNoTransaction(string command)
    {
        var table = await CreateWriteTableAsync();
        var connection = await OpenAsync();

        var sent = await connection.ExecuteAsync($"{string.Format(command, table)}; BEGIN WORK", CancellationToken.None);
        var written = await connection.ExecuteAsync($"UPDATE {table} SET versao = 9 WHERE numero = 1001", CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        await connection.DisposeAsync();
        var seenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        var untouched = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE numero IN (1019, 9001)");
        await DropAsync(table);

        Assert.That(sent.IsFailure, Is.True);
        Assert.That(sent.Error.Kind, Is.EqualTo(EDatabaseFailure.MultipleStatementsNotSupported));
        Assert.That(written.IsSuccess, Is.True, written.IsFailure ? written.Error.Message : null);
        Assert.That(seen, Is.EqualTo(1));
        Assert.That(pending, Is.Zero);
        Assert.That(seenAfterClosing, Is.EqualTo(1));
        Assert.That(untouched, Is.EqualTo(1));
    }

    /// <summary>
    /// A rede de segurança não depende mais da contagem de linhas: a sonda de transação roda depois de todo comando executado até o
    /// fim. O teste pula as duas recusas de propósito, como passaria uma forma de mandar dois comandos que elas não conhecessem: o
    /// `BEGIN WORK` chega ao banco depois de um comando com contagem, a sonda acha a transação, ela é desfeita, e a gravação
    /// seguinte é vista pelas outras conexões e continua lá depois de a sessão fechar.
    /// </summary>
    [TestCase("UPDATE {0} SET versao = versao WHERE numero = 1019")]
    [TestCase("INSERT INTO {0} (numero, versao) VALUES (9001, 0)")]
    [TestCase("DELETE FROM {0} WHERE numero = 1019")]
    public async Task Execute_CountedCommandFollowedByBeginWork_PastTheRefusals_IsRolledBackByTheProbe(string command)
    {
        var table = await CreateWriteTableAsync();
        var connection = await OpenAsync();

        var sent = await connection.ExecutePastTheTransactionControlRefusalAsync($"{string.Format(command, table)}; BEGIN WORK", CancellationToken.None);
        var written = await connection.ExecuteAsync($"UPDATE {table} SET versao = 9 WHERE numero = 1001", CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        await connection.DisposeAsync();
        var seenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        await DropAsync(table);

        Assert.That(sent.IsFailure, Is.True);
        Assert.That(sent.Error.Kind, Is.EqualTo(EDatabaseFailure.TransactionControlNotSupported));
        Assert.That(written.IsSuccess, Is.True, written.IsFailure ? written.Error.Message : null);
        Assert.That(seen, Is.EqualTo(1));
        Assert.That(pending, Is.Zero);
        Assert.That(seenAfterClosing, Is.EqualTo(1));
    }

    /// <summary>
    /// RN-SQL-001: a rotina que tem `;` no corpo é um comando só, até o `END PROCEDURE` ou o `END FUNCTION`. Um procedimento e uma
    /// função de verdade, com comentário na frente e `;` no fim, passam pela recusa, são criados e funcionam. O gatilho do Informix
    /// separa as ações com vírgula, e não tem `;` no corpo: é criado como qualquer comando, e com `;` dentro é um envio de dois.
    /// </summary>
    [Test]
    public async Task Execute_RoutinesWithSemicolonsInTheBody_AreOneStatement_AndAreCreated()
    {
        var table = await CreateWriteTableAsync();
        var suffix = Guid.NewGuid().ToString("N");
        await using var connection = await OpenAsync();
        var source = await connection.ExecuteAsync($"CREATE TABLE loja.origem_{suffix} (numero INTEGER)", CancellationToken.None);

        var procedure = await connection.ExecuteAsync($"{{ o procedimento }}\nCREATE PROCEDURE teste.p_{suffix} ()\n  UPDATE {table} SET versao = 1 WHERE numero = 1001;\n  UPDATE {table} SET versao = 1 WHERE numero = 1002;\nEND PROCEDURE;", CancellationToken.None);
        var function = await connection.ExecuteAsync($"CREATE FUNCTION teste.f_{suffix} (x INTEGER) RETURNING INTEGER; DEFINE dobro INTEGER; LET dobro = x * 2; RETURN dobro; END FUNCTION -- fim", CancellationToken.None);
        var trigger = await connection.ExecuteAsync($"CREATE TRIGGER teste.g_{suffix} INSERT ON loja.origem_{suffix} FOR EACH ROW (UPDATE {table} SET versao = 3 WHERE numero = 1003, UPDATE {table} SET versao = 3 WHERE numero = 1004);", CancellationToken.None);
        var triggerWithSemicolon = await connection.ExecuteAsync($"CREATE TRIGGER teste.h_{suffix} INSERT ON loja.origem_{suffix} FOR EACH ROW (UPDATE {table} SET versao = 4 WHERE numero = 1005; UPDATE {table} SET versao = 4 WHERE numero = 1006)", CancellationToken.None);

        var called = await connection.ExecuteAsync($"EXECUTE PROCEDURE teste.p_{suffix}()", CancellationToken.None);
        var computed = await ExecutePageAsync(connection, $"EXECUTE FUNCTION teste.f_{suffix}(21)");
        var inserted = await connection.ExecuteAsync($"INSERT INTO loja.origem_{suffix} VALUES (1)", CancellationToken.None);
        var byTheProcedure = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        var byTheTrigger = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 3");
        await connection.ExecuteAsync($"DROP TABLE loja.origem_{suffix}", CancellationToken.None);
        await connection.ExecuteAsync($"DROP FUNCTION teste.f_{suffix}", CancellationToken.None);
        await connection.ExecuteAsync($"DROP PROCEDURE teste.p_{suffix}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(source.IsSuccess, Is.True, source.IsFailure ? source.Error.Message : null);
        Assert.That(procedure.IsSuccess, Is.True, procedure.IsFailure ? procedure.Error.Message : null);
        Assert.That(function.IsSuccess, Is.True, function.IsFailure ? function.Error.Message : null);
        Assert.That(trigger.IsSuccess, Is.True, trigger.IsFailure ? trigger.Error.Message : null);
        Assert.That(triggerWithSemicolon.Error.Kind, Is.EqualTo(EDatabaseFailure.MultipleStatementsNotSupported));
        Assert.That(called.IsSuccess, Is.True, called.IsFailure ? called.Error.Message : null);
        Assert.That(computed.Rows[0][0], Is.EqualTo("42"));
        Assert.That(inserted.IsSuccess, Is.True, inserted.IsFailure ? inserted.Error.Message : null);
        Assert.That(byTheProcedure, Is.EqualTo(2));
        Assert.That(byTheTrigger, Is.EqualTo(2));
    }

    /// <summary>
    /// O servidor do Informix executa o que vem depois do fim de uma rotina, no mesmo envio: o driver manda o texto que começa por
    /// `CREATE PROCEDURE` inteiro. Depois do `END PROCEDURE` o `;` volta a separar comandos, e o envio é recusado sem ir ao banco:
    /// nem a rotina é criada. O mesmo vale para a rotina externa, que não tem corpo, e para o gatilho.
    /// </summary>
    [Test]
    public async Task Execute_RoutineFollowedByAnotherStatement_IsRefused_AndNothingIsCreated()
    {
        var table = await CreateWriteTableAsync();
        var suffix = Guid.NewGuid().ToString("N");
        var connection = await OpenAsync();
        var body = $"UPDATE {table} SET versao = 1 WHERE numero = 1001;";

        var refused = new List<EDatabaseFailure?>();
        foreach (var sql in new[]
        {
            $"CREATE PROCEDURE teste.r_{suffix} () {body} END PROCEDURE; BEGIN WORK",
            $"CREATE PROCEDURE teste.r_{suffix} () {body} END PROCEDURE; UPDATE {table} SET versao = 2 WHERE numero = 1002",
            $"CREATE DBA PROCEDURE teste.r_{suffix} () {body} END PROCEDURE; BEGIN WORK",
            $"CREATE FUNCTION teste.r_{suffix} () RETURNING INTEGER; RETURN 1; END FUNCTION; BEGIN WORK",
            $"CREATE PROCEDURE teste.r_{suffix} () {body} END PROCEDURE DOCUMENT 'um; dois'; BEGIN WORK",
            $"CREATE FUNCTION teste.r_{suffix} (INTEGER) RETURNING INTEGER EXTERNAL NAME '/tmp/nao_existe.so(f)' LANGUAGE C; UPDATE {table} SET versao = 2 WHERE numero = 1002",
            $"CREATE TRIGGER teste.r_{suffix} INSERT ON {table} FOR EACH ROW (UPDATE {table} SET versao = 2 WHERE numero = 1002); BEGIN WORK"
        })
        {
            var outcome = await connection.ExecuteAsync(sql, CancellationToken.None);
            refused.Add(outcome.IsFailure ? outcome.Error.Kind : null);
        }

        var routines = await connection.GetObjectsAsync("teste", "routines", CancellationToken.None);
        var written = await connection.ExecuteAsync($"UPDATE {table} SET versao = 9 WHERE numero = 1001", CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        var others = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao IN (1, 2)");
        await connection.DisposeAsync();
        var seenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        await DropAsync(table);

        Assert.That(refused, Is.All.EqualTo(EDatabaseFailure.MultipleStatementsNotSupported));
        Assert.That(routines.Value.Select(routine => routine.Name), Has.No.Member($"r_{suffix}"));
        Assert.That(written.IsSuccess, Is.True, written.IsFailure ? written.Error.Message : null);
        Assert.That(seen, Is.EqualTo(1));
        Assert.That(others, Is.Zero);
        Assert.That(seenAfterClosing, Is.EqualTo(1));
    }

    /// <summary>
    /// O mesmo envio, pulando as recusas de propósito: uma rotina legítima seguida de `; BEGIN WORK` chega ao banco. O servidor cria
    /// a rotina, recusa o `BEGIN WORK` (o envio já roda dentro de uma transação dele) e não deixa a conexão dentro de transação
    /// nenhuma: a gravação seguinte é confirmada. É por causa da rotina criada com resposta de erro que a recusa vem antes.
    /// </summary>
    [Test]
    public async Task Execute_RoutineFollowedByBeginWork_PastTheRefusals_LeavesNoTransaction()
    {
        var table = await CreateWriteTableAsync();
        var suffix = Guid.NewGuid().ToString("N");
        var connection = await OpenAsync();

        var sent = await connection.ExecutePastTheTransactionControlRefusalAsync($"CREATE PROCEDURE teste.s_{suffix} () UPDATE {table} SET versao = 1 WHERE numero = 1001; END PROCEDURE; BEGIN WORK", CancellationToken.None);
        var written = await connection.ExecuteAsync($"UPDATE {table} SET versao = 9 WHERE numero = 1001", CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        await connection.DisposeAsync();
        var seenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        await using (var cleaner = await OpenAsync())
            await cleaner.ExecuteAsync($"DROP PROCEDURE teste.s_{suffix}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(sent.IsFailure, Is.True);
        Assert.That(written.IsSuccess, Is.True, written.IsFailure ? written.Error.Message : null);
        Assert.That(seen, Is.EqualTo(1));
        Assert.That(pending, Is.Zero);
        Assert.That(seenAfterClosing, Is.EqualTo(1));
    }

    /// <summary>
    /// RN-SQL-010: uma função que grava uma linha a cada `RETURN ... WITH RESUME`, cancelada no meio. O driver fecha o cursor em
    /// silêncio, e o que a função gravou até ali fica confirmado: a resposta saía como sucesso, com zero linhas, e parte da tabela
    /// gravada. A resposta só é sucesso com as mil linhas gravadas e o total inteiro; cancelada no meio, ela diz que o Prism não
    /// sabe se o comando foi concluído.
    /// </summary>
    [Test]
    public async Task Cancel_WhileAFunctionWritesAtEachReturnedRow_NeverAnswersSuccessWithPartOfTheWrites()
    {
        var table = await CreateWriteTableAsync();
        var function = $"teste.aos_poucos_{Guid.NewGuid():N}";
        await using var connection = await OpenAsync();
        var created = await connection.ExecuteAsync($"CREATE FUNCTION {function} () RETURNING INTEGER; DEFINE n INTEGER; FOR n = 1001 TO 2000 UPDATE {table} SET versao = 1 WHERE numero = n; RETURN n WITH RESUME; END FOR; END FUNCTION", CancellationToken.None);

        var whole = await connection.ExecuteAsync($"EXECUTE FUNCTION {function}()", CancellationToken.None);
        var prepared = new List<bool>();
        var crossed = new List<string>();
        var unknown = 0;

        for (var attempt = 0; attempt < 24; attempt++)
        {
            // A tentativa só vale com a tabela zerada: o preparo que o banco recusa reprova o teste.
            prepared.Add((await connection.ExecuteAsync($"UPDATE {table} SET versao = 0", CancellationToken.None)).IsSuccess);
            var delay = (int)(whole.Value.ElapsedMs * attempt / 20);
            var running = connection.ExecuteAsync($"EXECUTE FUNCTION {function}()", CancellationToken.None);
            await Task.Delay(delay);
            connection.Cancel();
            var outcome = await running;
            var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
            unknown += outcome.IsFailure && outcome.Error.Message.StartsWith("O cancelamento chegou enquanto o comando devolvia as linhas", StringComparison.Ordinal) ? 1 : 0;
            await TestContext.Out.WriteLineAsync($"cancelado aos {delay} ms: {(outcome.IsSuccess ? $"sucesso, total {outcome.Value.Page!.TotalRows}" : outcome.Error.Message.Split('\n')[0])}; {written} gravadas");

            if (outcome.IsSuccess && (written != 1000 || outcome.Value.Page!.TotalRows != 1000))
                crossed.Add($"aos {delay} ms: sucesso com total {outcome.Value.Page!.TotalRows} e {written} gravadas");
        }

        var afterwards = await connection.ExecuteAsync($"UPDATE {table} SET versao = 2 WHERE numero = 1001", CancellationToken.None);
        var seenAfterwards = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 2");
        await connection.ExecuteAsync($"DROP FUNCTION {function}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(whole.IsSuccess, Is.True, whole.IsFailure ? whole.Error.Message : null);
        Assert.That(whole.Value.Page!.TotalRows, Is.EqualTo(1000));
        Assert.That(prepared, Is.All.True, "o banco recusou o preparo de uma tentativa");
        Assert.That(crossed, Is.Empty);
        Assert.That(unknown, Is.GreaterThan(0), "nenhum cancelamento chegou enquanto a função devolvia as linhas: o teste não exercitou o caso");
        Assert.That(afterwards.IsSuccess, Is.True, afterwards.IsFailure ? afterwards.Error.Message : null);
        Assert.That(seenAfterwards, Is.EqualTo(1));
    }

    /// <summary>
    /// RN-SQL-013: no Informix um `SELECT` não grava nem por função de tabela. `TABLE(FUNCTION ...)`, `TABLE(...)` e
    /// `TABLE(MULTISET(SELECT ...))` com uma função que grava são recusados pelo banco (-675), e nada é gravado: não há forma de
    /// `TABLE (` a mandar para o modo completo, como no Db2.
    /// </summary>
    [TestCase("SELECT * FROM TABLE(FUNCTION teste.grava_versao('{0}')) AS gravadas (numero)")]
    [TestCase("SELECT * FROM TABLE(teste.grava_versao('{0}')) AS gravadas (numero)")]
    [TestCase("SELECT * FROM TABLE(MULTISET(SELECT teste.grava_versao('{0}') FROM systables WHERE tabid = 1)) AS gravadas (numero)")]
    public async Task Execute_ReadThroughATableFunctionThatWrites_IsRefusedByTheDatabase(string query)
    {
        var table = await CreateWriteTableAsync();
        await using var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync(string.Format(query, table), CancellationToken.None);
        var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        await DropAsync(table);

        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Message, Does.Contain("Illegal SQL statement in SPL routine"));
        Assert.That(written, Is.Zero);
    }

    /// <summary>
    /// I6: o erro que o banco devolve durante a leitura das linhas chega do driver embrulhado numa exceção de conjunto. A resposta é
    /// a mensagem e o SQLSTATE do banco, como em qualquer outro erro dele, e não o texto do .NET para o embrulho.
    /// </summary>
    [Test]
    public async Task Execute_ErrorWhileReadingTheRows_ReportsTheDatabaseMessageAndSqlState()
    {
        await using var connection = await OpenAsync();

        var outcome = await connection.ExecuteAsync("SELECT teste.abre_transacao_e_devolve() FROM systables WHERE tabid = 1", CancellationToken.None);
        var afterwards = await connection.PingAsync(CancellationToken.None);

        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(outcome.Error.Message, Does.StartWith("[IBM]"));
        Assert.That(outcome.Error.Message, Does.Not.Contain("One or more errors"));
        Assert.That(outcome.Error.SqlState, Is.EqualTo("IX000"));
        Assert.That(afterwards.IsSuccess, Is.True);
    }

    /// <summary>RN-SQL-011: as células saem iguais seja qual for a cultura do processo. Com a da Arábia Saudita a data saía no calendário islâmico.</summary>
    [Test]
    [SetCulture("ar-SA")]
    public Task Execute_ReturnsEveryCellAsText_WhateverTheCultureOfTheProcess()
        => Execute_ReturnsEveryCellAsText_WithoutLosingPrecision();

    /// <summary>
    /// RN-SQL-011: `INTERVAL` chega inteiro, de coluna e de expressão, nas duas classes (dia a fração e ano a mês). O driver o
    /// entrega como texto.
    /// </summary>
    [Test]
    public async Task Execute_ReturnsIntervalsWhole()
    {
        await using var connection = await OpenAsync();
        var table = $"intervalos_{Guid.NewGuid():N}";
        var created = await connection.ExecuteAsync($"CREATE TABLE loja.{table} (dias INTERVAL DAY(3) TO SECOND, meses INTERVAL YEAR TO MONTH, fracao INTERVAL HOUR TO FRACTION(3), so_dias INTERVAL DAY TO DAY)", CancellationToken.None);
        var inserted = await connection.ExecuteAsync($"INSERT INTO loja.{table} VALUES (INTERVAL (123 04:05:06) DAY(3) TO SECOND, INTERVAL (2-03) YEAR TO MONTH, INTERVAL (12:34:56.789) HOUR TO FRACTION(3), INTERVAL (7) DAY TO DAY)", CancellationToken.None);

        var page = await ExecutePageAsync(connection, $"SELECT dias, meses, fracao, so_dias, dias + INTERVAL (1) DAY TO DAY AS soma, INTERVAL (2-03) YEAR TO MONTH AS constante FROM loja.{table}");
        await connection.ExecuteAsync($"DROP TABLE loja.{table}", CancellationToken.None);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(inserted.IsSuccess, Is.True, inserted.IsFailure ? inserted.Error.Message : null);
        Assert.That(page.Rows[0].Select(cell => cell!.Trim()), Is.EqualTo(new[] { "123 04:05:06", "2-03", "12:34:56.789", "7", "124 04:05:06", "2-03" }));
    }

    /// <summary>
    /// RN-SQL-001: um envio que começa por uma rotina externa (`EXTERNAL NAME`), continua com um `UPDATE` e acaba com outra rotina.
    /// A rotina externa não tem corpo, e o `END PROCEDURE` do fim é da outra: o servidor executava os três comandos, e a resposta era
    /// sucesso com zero linhas afetadas (ou, com um `BEGIN WORK` no meio, o erro dele com o `UPDATE` gravado e a função criada). O
    /// envio é recusado sem ir ao banco: nada é gravado, e nenhuma das rotinas é criada. Sozinha, a rotina externa é um comando.
    /// </summary>
    [Test]
    public async Task Execute_ExternalRoutineFollowedByOtherStatements_IsRefused_AndNothingIsWrittenOrCreated()
    {
        var table = await CreateWriteTableAsync();
        var suffix = Guid.NewGuid().ToString("N");
        await using var connection = await OpenAsync();
        var external = $"CREATE FUNCTION teste.x_{suffix} (INTEGER) RETURNING INTEGER EXTERNAL NAME '/tmp/nao_existe.so(x)' LANGUAGE C";
        var update = $"UPDATE {table} SET versao = 1 WHERE numero = 1001";
        var routine = $"CREATE PROCEDURE teste.q_{suffix} () UPDATE {table} SET versao = 2 WHERE numero = 1002; END PROCEDURE";

        var sent = await connection.ExecuteAsync($"{external}; {update}; {routine}", CancellationToken.None);
        var withBeginWork = await connection.ExecuteAsync($"{external}; {update}; BEGIN WORK; {routine}", CancellationToken.None);
        var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao <> 0");
        var created = await connection.GetObjectsAsync("teste", "routines", CancellationToken.None);
        var alone = await connection.ExecuteAsync($"{external};", CancellationToken.None);
        var afterwards = await connection.ExecuteAsync(update, CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        await connection.ExecuteAsync($"DROP FUNCTION teste.x_{suffix}", CancellationToken.None);
        await connection.ExecuteAsync($"DROP PROCEDURE teste.q_{suffix}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(sent.IsFailure, Is.True);
        Assert.That(sent.Error.Kind, Is.EqualTo(EDatabaseFailure.MultipleStatementsNotSupported));
        Assert.That(withBeginWork.IsFailure, Is.True);
        Assert.That(withBeginWork.Error.Kind, Is.EqualTo(EDatabaseFailure.MultipleStatementsNotSupported));
        Assert.That(written, Is.Zero);
        Assert.That(created.Value.Select(item => item.Name), Has.No.Member($"x_{suffix}"));
        Assert.That(created.Value.Select(item => item.Name), Has.No.Member($"q_{suffix}"));
        Assert.That(alone.IsSuccess, Is.True, alone.IsFailure ? alone.Error.Message : null);
        Assert.That(afterwards.IsSuccess, Is.True, afterwards.IsFailure ? afterwards.Error.Message : null);
        Assert.That(seen, Is.EqualTo(1));
    }

    /// <summary>
    /// RN-SESSAO-005: uma função que abre a transação por dentro, grava, devolve 500 linhas e lança. O comando falha, e a transação
    /// ficava aberta na conexão: a leitura seguinte na mesma sessão mostrava a linha não confirmada, a outra conexão ficava presa na
    /// trava, e o `UPDATE` seguinte, inocente, era recusado e desfeito. A sonda de transação roda também depois do comando que falha
    /// com a conexão viva: a transação é desfeita, a resposta continua sendo o erro do banco, e o comando seguinte encontra a
    /// sessão limpa.
    /// </summary>
    [Test]
    public async Task Execute_FunctionThatOpensATransactionWritesAndFails_KeepsItsError_AndLeavesTheSessionClean()
    {
        var table = await CreateWriteTableAsync();
        var function = $"teste.abre_grava_e_falha_{Guid.NewGuid():N}";
        var connection = await OpenAsync();
        var created = await connection.ExecuteAsync($"CREATE FUNCTION {function} () RETURNING INTEGER; DEFINE n INTEGER; BEGIN WORK; UPDATE {table} SET versao = 7 WHERE numero = 1001; FOR n = 1 TO 500 RETURN n WITH RESUME; END FOR; RAISE EXCEPTION -746, 0, 'falha de proposito'; END FUNCTION", CancellationToken.None);
        var mark = _log.Events.Count;

        var failed = await connection.ExecuteAsync($"EXECUTE FUNCTION {function}()", CancellationToken.None);
        var warnings = Logged(mark, LogEventLevel.Warning);
        var readInTheSameSession = await ExecutePageAsync(connection, $"SELECT versao FROM {table} WHERE numero = 1001");
        var seenByAnother = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 7");
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        var innocent = await connection.ExecuteAsync($"UPDATE {table} SET versao = 9 WHERE numero = 1002", CancellationToken.None);
        var innocentSeen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        await connection.DisposeAsync();
        var innocentSeenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        await using (var cleaner = await OpenAsync())
            await cleaner.ExecuteAsync($"DROP FUNCTION {function}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(failed.IsFailure, Is.True);
        Assert.That(failed.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(failed.Error.Message, Does.Contain("falha de proposito"));
        Assert.That(failed.Error.SqlState, Is.EqualTo("IX000"));
        Assert.That(warnings, Is.EqualTo(new[] { "Um comando que falhou ou foi cancelado deixou uma transação aberta na conexão: ela foi desfeita." }));
        Assert.That(readInTheSameSession.Rows[0][0], Is.EqualTo("0"));
        Assert.That(seenByAnother, Is.Zero);
        Assert.That(pending, Is.Zero);
        Assert.That(innocent.IsSuccess, Is.True, innocent.IsFailure ? innocent.Error.Message : null);
        Assert.That(innocent.Value.RowsAffected, Is.EqualTo(1));
        Assert.That(innocentSeen, Is.EqualTo(1));
        Assert.That(innocentSeenAfterClosing, Is.EqualTo(1));
    }

    /// <summary>
    /// RN-SQL-001: `external` e `name` também são nomes comuns no Informix. Um procedimento cujo corpo começa por
    /// `SELECT external name FROM ...` (a coluna `external` com o apelido `name`, sem `AS`) tem o par no cabeçalho, antes do
    /// primeiro `;`: era tomado por rotina externa seguida de outro comando e recusado, e o banco o cria. Só é rotina externa a que
    /// tem o texto entre aspas depois do par. O procedimento é criado, e o corpo dele roda inteiro.
    /// </summary>
    [Test]
    public async Task Execute_RoutineThatReadsAColumnCalledExternalWithTheAliasName_IsOneStatement_AndIsCreated()
    {
        var table = await CreateWriteTableAsync();
        var suffix = Guid.NewGuid().ToString("N");
        await using var connection = await OpenAsync();
        var source = await connection.ExecuteAsync($"CREATE TABLE loja.externa_{suffix} (external INTEGER)", CancellationToken.None);

        var procedure = await connection.ExecuteAsync($"CREATE PROCEDURE teste.e_{suffix} () SELECT external name FROM loja.externa_{suffix} INTO TEMP rascunho_{suffix}; UPDATE {table} SET versao = 1 WHERE numero = 1001; UPDATE {table} SET versao = 1 WHERE numero = 1002; END PROCEDURE", CancellationToken.None);
        var called = await connection.ExecuteAsync($"EXECUTE PROCEDURE teste.e_{suffix}()", CancellationToken.None);
        var byTheProcedure = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
        await connection.ExecuteAsync($"DROP PROCEDURE teste.e_{suffix}", CancellationToken.None);
        await connection.ExecuteAsync($"DROP TABLE loja.externa_{suffix}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(source.IsSuccess, Is.True, source.IsFailure ? source.Error.Message : null);
        Assert.That(procedure.IsSuccess, Is.True, procedure.IsFailure ? procedure.Error.Message : null);
        Assert.That(called.IsSuccess, Is.True, called.IsFailure ? called.Error.Message : null);
        Assert.That(byTheProcedure, Is.EqualTo(2));
    }

    /// <summary>
    /// RN-SESSAO-005 e RN-LOG-001: um `SELECT` executado até o fim que falha na primeira linha não abre transação, mas deixa o
    /// servidor respondendo "já há uma transação" (-535) ao `BEGIN WORK` da sonda: o cursor dele ficou aberto no servidor. A sonda
    /// tomava a resposta por uma transação do comando, e o log ganhava um aviso que o culpava. Ela pergunta de novo depois de uma
    /// leitura neutra, que fecha o cursor: só a transação de verdade responde -535 outra vez. A resposta é o erro do banco, o log
    /// não ganha aviso, e o comando seguinte é confirmado.
    /// </summary>
    [Test]
    public async Task Execute_ReadThatFailsOnItsFirstRow_IsNotBlamedForATransaction()
    {
        var table = await CreateWriteTableAsync();
        await using var connection = await OpenAsync();
        var mark = _log.Events.Count;

        // O apelido `delete` tira a leitura da paginação: ela roda até o fim, e é depois dela que a conferência roda.
        var failed = await connection.ExecuteAsync("SELECT 1 / (tabid - 1) AS delete FROM systables WHERE tabid = 1", CancellationToken.None);
        var warnings = Logged(mark, LogEventLevel.Warning);
        var linesOfTheProbe = Logged(mark, LogEventLevel.Information).Where(line => line.Contains("ProbeTransactionAsync", StringComparison.Ordinal)).ToArray();
        var innocent = await connection.ExecuteAsync($"UPDATE {table} SET versao = 9 WHERE numero = 1002", CancellationToken.None);
        var innocentSeen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        var pending = await ReadFromAnotherConnectionAsync(PendingWorkQuery);
        await DropAsync(table);

        Assert.That(failed.IsFailure, Is.True);
        Assert.That(failed.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(failed.Error.Message, Does.Contain("divide by zero"));
        Assert.That(warnings, Is.Empty);
        Assert.That(linesOfTheProbe, Is.Empty, "o -535 que a sonda recebe ali é resposta de rotina, e não vai para o log como informação");
        Assert.That(innocent.IsSuccess, Is.True, innocent.IsFailure ? innocent.Error.Message : null);
        Assert.That(innocentSeen, Is.EqualTo(1));
        Assert.That(pending, Is.Zero);
    }

    /// <summary>
    /// RN-SESSAO-005 e RN-SQL-010: uma função que abre a transação por dentro, grava e devolve linhas, cancelada enquanto as
    /// devolve. A resposta dizia "o que ele gravou até ali está confirmado", e a conferência depois da falha achava a transação e a
    /// desfazia: a outra conexão não via a linha. A resposta diz o que houve (o comando deixou uma transação aberta, e o Prism a
    /// desfez), com o mesmo código da função que não é cancelada. O cancelamento é disparado em instantes espalhados pelo tempo
    /// que a função leva: em nenhum deles a linha fica gravada ou sobra trabalho pendente, nenhuma resposta fala em gravação
    /// confirmada, e o comando seguinte encontra a sessão limpa.
    /// </summary>
    [Test]
    public async Task Cancel_WhileAFunctionThatOpenedATransactionReturnsItsRows_SaysTheTransactionWasUndone()
    {
        const string undoneMessage = "O comando deixou uma transação aberta, e o Prism a desfez: nada do que ele gravou dentro dela ficou.";
        var table = await CreateWriteTableAsync();
        var function = $"teste.abre_e_devolve_{Guid.NewGuid():N}";
        var connection = await OpenAsync();
        var created = await connection.ExecuteAsync($"CREATE FUNCTION {function} () RETURNING INTEGER; DEFINE n INTEGER; BEGIN WORK; UPDATE {table} SET versao = 7 WHERE numero = 1001; FOR n = 1 TO 200000 RETURN n WITH RESUME; END FOR; END FUNCTION", CancellationToken.None);

        var clock = Stopwatch.StartNew();
        var whole = await connection.ExecuteAsync($"EXECUTE FUNCTION {function}()", CancellationToken.None);
        var wholeMs = clock.ElapsedMilliseconds;
        var mark = _log.Events.Count;
        var answers = new List<string>();
        var kept = new List<long>();
        var pending = new List<long>();

        for (var attempt = 0; attempt < 12; attempt++)
        {
            var delay = (int)(wholeMs * attempt / 10);
            var running = connection.ExecuteAsync($"EXECUTE FUNCTION {function}()", CancellationToken.None);
            await Task.Delay(delay);
            connection.Cancel();
            var outcome = await running;
            kept.Add(await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 7"));
            pending.Add(await ReadFromAnotherConnectionAsync(PendingWorkQuery));
            answers.Add(outcome.IsSuccess ? "sucesso" : $"{outcome.Error.Kind}: {outcome.Error.Message.Split('\n')[0]}");
            await TestContext.Out.WriteLineAsync($"cancelado aos {delay} ms: {answers[^1]}");
        }

        var undone = answers.Count(answer => answer.StartsWith($"{EDatabaseFailure.TransactionControlNotSupported}: {undoneMessage}", StringComparison.Ordinal));
        var warnings = Logged(mark, LogEventLevel.Warning);
        var innocent = await connection.ExecuteAsync($"UPDATE {table} SET versao = 9 WHERE numero = 1002", CancellationToken.None);
        var innocentSeen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        await connection.DisposeAsync();
        var innocentSeenAfterClosing = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 9");
        await using (var cleaner = await OpenAsync())
            await cleaner.ExecuteAsync($"DROP FUNCTION {function}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(whole.IsFailure, Is.True);
        Assert.That(whole.Error.Kind, Is.EqualTo(EDatabaseFailure.TransactionControlNotSupported));
        Assert.That(answers, Has.None.EqualTo("sucesso"));
        Assert.That(answers, Has.None.Contains("está confirmado"));
        Assert.That(undone, Is.GreaterThan(0), "nenhum cancelamento chegou enquanto a função devolvia as linhas: o teste não exercitou o caso");
        Assert.That(kept, Is.All.Zero);
        Assert.That(pending, Is.All.Zero);
        Assert.That(warnings.Count(warning => warning == "Um comando que falhou ou foi cancelado deixou uma transação aberta na conexão: ela foi desfeita."), Is.GreaterThanOrEqualTo(undone));
        Assert.That(warnings.Where(warning => warning is not ("Um comando que falhou ou foi cancelado deixou uma transação aberta na conexão: ela foi desfeita." or "Um comando deixou uma transação aberta na conexão: ela foi desfeita, e o comando foi recusado.")), Is.Empty);
        Assert.That(innocent.IsSuccess, Is.True, innocent.IsFailure ? innocent.Error.Message : null);
        Assert.That(innocent.Value.RowsAffected, Is.EqualTo(1));
        Assert.That(innocentSeen, Is.EqualTo(1));
        Assert.That(innocentSeenAfterClosing, Is.EqualTo(1));
    }

    /// <summary>
    /// RN-LOG-001: num banco sem log, o `BEGIN WORK` da sonda de transação é recusado depois de cada comando ("não há transação",
    /// -256), e essa é a resposta de rotina dela. Cada comando, e cada comando que falha, somava ao log uma linha de informação
    /// "o banco recusou a sonda": ela sai como depuração, abaixo do nível com que o Prism roda. A recusa do banco ao comando do
    /// usuário continua no log como informação.
    /// </summary>
    [Test]
    public async Task UnloggedDatabase_TheRoutineAnswerOfTheTransactionProbe_IsNotLoggedAsInformation()
    {
        var unlogged = Settings with { Database = InformixSingleton.UnloggedDatabase };
        var opened = await Client.OpenAsync(unlogged, CancellationToken.None);
        Assert.That(opened.IsSuccess, Is.True, opened.IsFailure ? opened.Error.Message : null);
        await using var connection = opened.Value;
        var table = $"rotina_{Guid.NewGuid():N}";
        var mark = _log.Events.Count;

        var created = await connection.ExecuteAsync($"CREATE TABLE {table} (valor INTEGER)", CancellationToken.None);
        var failed = await connection.ExecuteAsync($"INSERT INTO {table} VALUES ('texto')", CancellationToken.None);
        var failedAgain = await connection.ExecuteAsync("SELEC 1", CancellationToken.None);
        var dropped = await connection.ExecuteAsync($"DROP TABLE {table}", CancellationToken.None);
        var logged = _log.Events.Skip(mark).ToArray();
        var refusalsOfTheProbe = logged.Where(line => line.Properties.TryGetValue("Operation", out var operation) && operation.ToString().Contains("ProbeTransactionAsync")).Select(line => line.Level).ToArray();
        var refusalsOfTheCommands = logged.Where(line => line.Properties.TryGetValue("Operation", out var operation) && operation.ToString().Contains("ExecuteAsync")).Select(line => line.Level).ToArray();

        Assert.That(created.IsSuccess, Is.True, created.IsFailure ? created.Error.Message : null);
        Assert.That(failed.IsFailure, Is.True);
        Assert.That(failedAgain.IsFailure, Is.True);
        Assert.That(dropped.IsSuccess, Is.True, dropped.IsFailure ? dropped.Error.Message : null);
        Assert.That(refusalsOfTheProbe, Has.Length.EqualTo(4), "a sonda roda depois de cada um dos quatro comandos");
        Assert.That(refusalsOfTheProbe, Is.All.EqualTo(LogEventLevel.Debug));
        Assert.That(refusalsOfTheCommands, Is.EqualTo(new[] { LogEventLevel.Information, LogEventLevel.Information }));
    }

    private sealed class CollectingSink : ILogEventSink
    {
        public ConcurrentQueue<LogEvent> Events { get; } = new();

        public void Emit(LogEvent logEvent)
            => Events.Enqueue(logEvent);
    }
}
