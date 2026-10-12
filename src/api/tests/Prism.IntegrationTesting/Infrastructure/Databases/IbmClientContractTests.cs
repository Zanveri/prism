using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Api.Support;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Extensions;
using System.Diagnostics;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// O contrato comum mais o que o Db2 e o Informix têm de igual por usarem o mesmo driver da IBM: a string de conexão montada pelo
/// construtor dele, o envio com mais de um comando (que esse driver executaria um por um, e a API recusa) e os nomes de objeto que
/// precisam de aspas.
/// A classe de cada banco informa o que só ele tem.
/// </summary>
public abstract class IbmClientContractTests : DatabaseClientContractTests
{
    protected override string WrongPasswordMessage => "SQL30082N";

    // Limitada de propósito (cerca de um minuto no banco): se o cancelamento falhasse, o teste terminaria reprovado, e não pendurado.
    protected override string SlowQuery => "SELECT COUNT(*) FROM loja.pedido a, loja.pedido b, loja.pedido c WHERE c.numero <= 1600 AND MOD(a.numero + b.numero + c.numero, 7) = 3";

    protected override string?[] FirstPedidoRow => ["1001", "1.50", "2026-01-01 00:01:00.000000", "Pedido 1"];

    protected override EDatabaseFailure SeveralStatementsRefusal => EDatabaseFailure.MultipleStatementsNotSupported;

    /// <summary>
    /// RN-DRIVER-001 e 005: a API não leva o driver da IBM. O contêiner destes testes parte com a pasta de drivers em que o gerenciador
    /// o instalou (<see cref="IbmDriverSingleton"/>): a conferência da partida a aprova, e o client de verdade entra no lugar do que
    /// só responde `DRIVER_NOT_INSTALLED`.
    /// </summary>
    protected override async Task ConfigureAsync(IServiceCollection services)
        => services.UseDriverSource(directory: await IbmDriverSingleton.GetDirectoryAsync());

    /// <summary>
    /// RN-DRIVER-001 e 005: o assembly da IBM e a biblioteca nativa dele vêm da pasta em que o gerenciador de drivers instalou o
    /// driver, e de nenhum outro lugar. A API não leva o driver: se ele aparecesse ao lado dela (uma saída de build antiga, uma
    /// referência que voltou a copiar o pacote), o teste de conexão passaria do mesmo jeito, e é este que acusa.
    /// </summary>
    [Test]
    public async Task Driver_IsLoadedFromTheFolderTheDriverManagerInstalledItIn()
    {
        await using var connection = await OpenAsync();
        var folder = Path.GetFileName(await IbmDriverSingleton.GetDirectoryAsync());

        var managed = AppDomain.CurrentDomain.GetAssemblies().Where(assembly => assembly.GetName().Name == "IBM.Data.Db2").Select(assembly => assembly.Location).ToArray();
        var native = Process.GetCurrentProcess().Modules.Cast<ProcessModule>().Where(module => module.ModuleName is "db2app64.dll" or "libdb2.so" or "libdb2.dylib").Select(module => module.FileName).ToArray();

        Assert.That(managed, Has.Length.EqualTo(1));
        Assert.That(managed[0], Does.Contain(folder));
        Assert.That(native, Is.Not.Empty);
        Assert.That(native, Has.All.Contains(folder));
        Assert.That(Directory.EnumerateFileSystemEntries(AppContext.BaseDirectory, "IBM.Data.Db2*"), Is.Empty, "a pasta de saída dos testes não leva o assembly da IBM");
        Assert.That(Directory.Exists(Path.Combine(AppContext.BaseDirectory, "clidriver")), Is.False, "a pasta de saída dos testes não leva a clidriver");
    }

    /// <summary>A cláusula de chave estrangeira com nome, como este banco a escreve dentro de um `CREATE TABLE`.</summary>
    protected abstract string ForeignKey(string name, string columns, string referenced);

    /// <summary>
    /// O comando que faz as leituras seguintes da sessão enxergarem o que outra sessão gravou e ainda não confirmou, sem esperar
    /// trava. Nulo no banco em que isso não existe por este driver: no Informix, pela porta DRDA, `SET ISOLATION TO DIRTY READ` é
    /// aceito e não vale para os comandos seguintes.
    /// </summary>
    protected virtual string? UncommittedReadIsolation => null;

    /// <summary>
    /// O comando de <see cref="DatabaseClientContractTests.WriteReturningRows"/> para a varredura de cancelamento. Onde os instantes
    /// dela são medidos, devolve linhas largas: a volta das linhas leva bem mais que os milissegundos de um temporizador, e o
    /// cancelamento disparado depois de a gravação aparecer cai onde foi mirado.
    /// </summary>
    protected virtual string WriteReturningWideRows(string table)
        => WriteReturningRows(table);

    /// <summary>
    /// RN-CONN-004: a string de conexão sai do construtor do driver, e host, banco, usuário e senha não conseguem acrescentar
    /// parâmetro a ela. Um servidor de mentira conta quem bate na porta dele: com `;Server=`, `;Pwd=`, aspas e `@host` no banco, no
    /// usuário, na senha ou no host, ninguém bate. O mesmo servidor posto como porta da conexão é a prova de que o contador conta.
    /// </summary>
    [Test]
    public async Task Open_WithConnectionKeywordsInAConnectionField_NeverReachesAnotherServer()
    {
        using var decoy = new ConnectionCounter();
        var elsewhere = $"127.0.0.1:{decoy.Port}";
        var attempts = new[]
        {
            Settings with { Database = $"{Settings.Database};Server={elsewhere}" },
            Settings with { Database = $"{Settings.Database};Pwd=x" },
            Settings with { Database = $"{Settings.Database}\";Server={elsewhere};\"" },
            Settings with { Database = $"{Settings.Database}';Server={elsewhere};'" },
            Settings with { Database = $"{{{Settings.Database}}};Server={elsewhere}" },
            Settings with { Database = $"{Settings.Database}@{elsewhere}" },
            Settings with { Database = $"//{elsewhere}/{Settings.Database}" },
            Settings with { UserName = $"{Settings.UserName};Server={elsewhere}" },
            Settings with { UserName = $"{Settings.UserName};Pwd=x" },
            Settings with { UserName = $"{Settings.UserName}\";Server={elsewhere};\"" },
            Settings with { Password = $"{Settings.Password};Server={elsewhere}" },
            Settings with { Password = $"x;Server={elsewhere};Database={Settings.Database}" },
            Settings with { Password = $"x\";Server={elsewhere};\"" },
            Settings with { Password = $"x';Server={elsewhere};'" },
            Settings with { Password = $"{{x}};Server={elsewhere}" },
            Settings with { Password = $"x\";Server={elsewhere}" },
            Settings with { Password = $"x@{elsewhere}" },
            Settings with { Host = $"{Settings.Host};Server={elsewhere}" },
            Settings with { Host = $"{Settings.Host}:{Settings.Port};Server={elsewhere};Database={Settings.Database}" }
        };

        var failures = new List<EDatabaseFailure?>();
        foreach (var attempt in attempts)
        {
            var opened = await Client.OpenAsync(attempt, CancellationToken.None);
            failures.Add(opened.IsFailure ? opened.Error.Kind : null);
        }

        var reachedWithInjection = decoy.Accepted;
        var direct = await Client.OpenAsync(Settings with { Port = decoy.Port }, CancellationToken.None);

        Assert.That(failures, Is.All.EqualTo(EDatabaseFailure.ConnectionFailed));
        Assert.That(reachedWithInjection, Is.Zero);
        Assert.That(direct.IsFailure, Is.True);
        Assert.That(decoy.Accepted, Is.GreaterThan(0));
    }

    /// <summary>
    /// RN-SQL-001: o driver da IBM executaria um por um os comandos de um envio, cada um com a própria confirmação. Um erro no meio
    /// deixava gravado o que veio antes e depois dele, e a resposta era só o erro; uma leitura seguida de uma gravação sairia com a
    /// gravação por fazer. O envio com mais de um comando é recusado sem ir ao banco: nenhuma das gravações acontece.
    /// </summary>
    [Test]
    public async Task Execute_SeveralStatements_IsRefusedWithoutReachingTheDatabase()
    {
        var table = await CreateWriteTableAsync();
        await using var connection = await OpenAsync();
        var first = $"UPDATE {table} SET versao = 5 WHERE numero = 1001";
        var second = $"UPDATE {table} SET versao = 5 WHERE numero = 1002";
        var sends = new[]
        {
            $"{first}; {second}",
            $"{first}; SELEC 1; {second}",
            $"{first};{second};",
            $"{first} -- um\n; {second}",
            $"{first} /* um */; {second} -- dois",
            $";;{first}; {second}",
            $"{first} -- um\r'\n; {second} --'",
            $"{LargeReadQuery}; {second}",
            $"{first}; {LargeReadQuery}",
            $"SELECT ';' FROM loja.cliente; {second}",
            $"CREATE VIEW loja.nunca_criada AS SELECT id FROM loja.cliente; {second}"
        };

        var refusals = new List<DatabaseFailure?>();
        foreach (var send in sends)
        {
            var outcome = await connection.ExecuteAsync(send, CancellationToken.None);
            refusals.Add(outcome.IsFailure ? outcome.Error : null);
        }

        var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 5");
        var views = await connection.GetObjectsAsync(Name("loja"), "views", CancellationToken.None);
        var afterwards = await connection.ExecuteAsync(first, CancellationToken.None);
        var writtenAfterwards = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 5");
        await DropAsync(table);

        Assert.That(refusals.Select(refusal => refusal?.Kind), Is.All.EqualTo(EDatabaseFailure.MultipleStatementsNotSupported));
        Assert.That(refusals.Select(refusal => refusal?.Message), Is.All.StartsWith("Cada execução leva um comando só"));
        Assert.That(written, Is.Zero);
        Assert.That(views.Value.Select(view => view.Name), Has.No.Member(Name("nunca_criada")));
        Assert.That(afterwards.IsSuccess, Is.True, afterwards.IsFailure ? afterwards.Error.Message : null);
        Assert.That(writtenAfterwards, Is.EqualTo(1));
    }

    /// <summary>
    /// O `;` do fim, o comentário depois dele e os `;` soltos da frente não são outro comando. O driver da IBM manda cada pedaço
    /// como um comando: o pedaço vazio da frente fazia o banco recusar o envio, e o comentário do fim era recusado depois de a
    /// gravação já estar confirmada (a resposta era um erro, com a linha gravada). O comando vai sem eles: grava, lê até o fim e
    /// conta.
    /// </summary>
    [TestCase("", ";")]
    [TestCase("", " ; -- fim")]
    [TestCase("", ";\n/* fim */\n")]
    [TestCase("", "; ;")]
    [TestCase(";; ", "")]
    [TestCase("-- começo\n; ", ";; -- fim")]
    public async Task Execute_OneStatementAmongStraySemicolons_RunsToTheEndAndSucceeds(string before, string after)
    {
        var table = await CreateWriteTableAsync();
        await using var connection = await OpenAsync();

        var written = await connection.ExecuteAsync($"{before}UPDATE {table} SET versao = 6 WHERE numero = 1001{after}", CancellationToken.None);
        var seen = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 6");
        var read = await connection.ExecuteAsync($"{before}SELECT id FROM loja.cliente ORDER BY id{after}", CancellationToken.None);
        var total = await connection.CountAsync($"{before}SELECT id FROM loja.cliente ORDER BY id{after}", CancellationToken.None);
        await DropAsync(table);

        Assert.That(written.IsSuccess, Is.True, written.IsFailure ? written.Error.Message : null);
        Assert.That(written.Value.RowsAffected, Is.EqualTo(1));
        Assert.That(seen, Is.EqualTo(1));
        Assert.That(read.IsSuccess, Is.True, read.IsFailure ? read.Error.Message : null);
        Assert.That(read.Value.Page!.Rows, Has.Count.EqualTo(10));
        Assert.That(read.Value.Page.HasMore, Is.False);
        Assert.That(total.IsSuccess, Is.True, total.IsFailure ? total.Error.Message : null);
        Assert.That(total.Value, Is.EqualTo(10));
    }

    /// <summary>
    /// RN-SQL-006: o "contar total" põe o comando dentro de uma subconsulta, e nestes bancos não há transação só de leitura que o
    /// impeça de gravar. Um texto montado para fechar a subconsulta, gravar e abrir outra chegava ao banco e gravava. Só o que o
    /// texto diz ser uma leitura só é contado; o resto não vai ao banco.
    /// </summary>
    [Test]
    public async Task Count_OfWhatIsNotASingleRead_NeverReachesTheDatabase()
    {
        var table = await CreateWriteTableAsync();
        await using var connection = await OpenAsync();

        var crafted = await connection.CountAsync($"SELECT id FROM loja.cliente) AS x; UPDATE {table} SET versao = 7; SELECT 1 FROM (SELECT id FROM loja.cliente", CancellationToken.None);
        var write = await connection.CountAsync($"UPDATE {table} SET versao = 7", CancellationToken.None);
        var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 7");
        var read = await connection.CountAsync("SELECT id FROM loja.cliente", CancellationToken.None);
        await DropAsync(table);

        Assert.That(crafted.IsFailure, Is.True);
        Assert.That(crafted.Error.Kind, Is.EqualTo(EDatabaseFailure.ExecutionFailed));
        Assert.That(crafted.Error.Message, Does.StartWith("Só uma leitura pode ser contada"));
        Assert.That(write.IsFailure, Is.True);
        Assert.That(write.Error.Message, Does.StartWith("Só uma leitura pode ser contada"));
        Assert.That(written, Is.Zero);
        Assert.That(read.Value, Is.EqualTo(10));
    }

    /// <summary>Um `;` no fim, com ou sem comentário depois, não faz de uma leitura um envio de dois comandos: ela continua paginada.</summary>
    [TestCase(";")]
    [TestCase("  ;  ")]
    [TestCase("; -- fim")]
    [TestCase("\n/* fim */ ;\n")]
    public async Task Execute_ReadEndingInASemicolon_StaysPaged(string ending)
    {
        await using var connection = await OpenAsync();

        var page = await ExecutePageAsync(connection, PedidoQuery + ending);

        Assert.That(page.Rows, Has.Count.EqualTo(200));
        Assert.That(page.HasMore, Is.True);
        Assert.That(page.TotalRows, Is.Null);
    }

    /// <summary>
    /// RN-ARVORE: nome com espaço, barra, ponto, aspas e maiúsculas e minúsculas vai como parâmetro até o catálogo e volta como o
    /// banco o guarda. O mesmo nome em outra caixa é outro objeto (aqui, nenhum); o nome escrito sem aspas é dobrado pelo banco.
    /// </summary>
    [Test]
    public async Task Catalog_OfNamesThatNeedQuotes_UsesThemExactly()
    {
        await using var connection = await OpenAsync();
        var suffix = Guid.NewGuid().ToString("N");
        var quoted = $"MiXta/Com.Ponto e 'aspas' {suffix}";
        var plain = $"SemAspas_{suffix}";
        var createdQuoted = await connection.ExecuteAsync($"CREATE TABLE loja.\"{quoted}\" (\"Coluna Um\" INTEGER NOT NULL, \"coluna.dois\" VARCHAR(10), PRIMARY KEY (\"Coluna Um\"))", CancellationToken.None);
        var createdPlain = await connection.ExecuteAsync($"CREATE TABLE loja.{plain} (Id INTEGER NOT NULL)", CancellationToken.None);

        var tables = await connection.GetObjectsAsync(Name("loja"), "tables", CancellationToken.None);
        var columns = await connection.GetColumnsAsync(Name("loja"), quoted, CancellationToken.None);
        var columnsInAnotherCase = await connection.GetColumnsAsync(Name("loja"), quoted.ToUpperInvariant(), CancellationToken.None);
        var indexes = await connection.GetIndexesAsync(Name("loja"), quoted, CancellationToken.None);
        var plainColumns = await connection.GetColumnsAsync(Name("loja"), Name(plain), CancellationToken.None);
        var read = await connection.ExecuteAsync($"SELECT \"Coluna Um\", \"coluna.dois\" FROM loja.\"{quoted}\"", CancellationToken.None);
        await connection.ExecuteAsync($"DROP TABLE loja.\"{quoted}\"", CancellationToken.None);
        await connection.ExecuteAsync($"DROP TABLE loja.{plain}", CancellationToken.None);

        Assert.That(createdQuoted.IsSuccess, Is.True, createdQuoted.IsFailure ? createdQuoted.Error.Message : null);
        Assert.That(createdPlain.IsSuccess, Is.True, createdPlain.IsFailure ? createdPlain.Error.Message : null);
        Assert.That(tables.Value.Select(table => (table.Name, table.Kind)), Is.SupersetOf(new[] { (quoted, "table"), (Name(plain), "table") }));
        Assert.That(columns.Value.Select(column => (column.Name, column.IsPrimaryKey)), Is.EqualTo(new[] { ("Coluna Um", true), ("coluna.dois", false) }));
        Assert.That(columnsInAnotherCase.Value, Is.Empty);
        Assert.That(indexes.Value.Single().Columns, Is.EqualTo(new[] { "Coluna Um" }));
        Assert.That(plainColumns.Value.Select(column => column.Name), Is.EqualTo(new[] { Name("id") }));
        Assert.That(read.IsSuccess, Is.True, read.IsFailure ? read.Error.Message : null);
        Assert.That(read.Value.Page!.Columns.Select(column => column.Name), Is.EqualTo(new[] { "Coluna Um", "coluna.dois" }));
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
        var child = await connection.ExecuteAsync($"CREATE TABLE loja.filha_{suffix} (x INTEGER, y INTEGER, {ForeignKey("fk_filha_mae", "y, x", $"loja.mae_{suffix} (b, a)")})", CancellationToken.None);

        var foreignKeys = await connection.GetForeignKeysAsync(Name("loja"), Name($"filha_{suffix}"), CancellationToken.None);
        var columns = await connection.GetColumnsAsync(Name("loja"), Name($"mae_{suffix}"), CancellationToken.None);
        var indexes = await connection.GetIndexesAsync(Name("loja"), Name($"mae_{suffix}"), CancellationToken.None);
        await connection.ExecuteAsync($"DROP TABLE loja.filha_{suffix}", CancellationToken.None);
        await connection.ExecuteAsync($"DROP TABLE loja.mae_{suffix}", CancellationToken.None);

        Assert.That(parent.IsSuccess, Is.True, parent.IsFailure ? parent.Error.Message : null);
        Assert.That(child.IsSuccess, Is.True, child.IsFailure ? child.Error.Message : null);

        var foreignKey = foreignKeys.Value.Single();
        Assert.That(foreignKey.Name, Is.EqualTo(Name("fk_filha_mae")));
        Assert.That(foreignKey.Columns, Is.EqualTo(new[] { Name("y"), Name("x") }));
        Assert.That(foreignKey.ReferencedSchema, Is.EqualTo(Name("loja")));
        Assert.That(foreignKey.ReferencedTable, Is.EqualTo(Name($"mae_{suffix}")));
        Assert.That(foreignKey.ReferencedColumns, Is.EqualTo(new[] { Name("b"), Name("a") }));
        Assert.That(columns.Value.Select(column => column.IsPrimaryKey), Is.EqualTo(new[] { true, true, false }));
        Assert.That(indexes.Value.Single().Columns, Is.EqualTo(new[] { Name("b"), Name("a") }));
    }

    /// <summary>Uma visão também tem colunas; sem chave primária nem índice.</summary>
    [Test]
    public async Task GetColumns_OfView_ReturnsItsColumns()
    {
        await using var connection = await OpenAsync();

        var columns = await connection.GetColumnsAsync(Name("loja"), Name("pedido_resumo"), CancellationToken.None);
        var indexes = await connection.GetIndexesAsync(Name("loja"), Name("pedido_resumo"), CancellationToken.None);

        Assert.That(columns.IsSuccess, Is.True, columns.IsFailure ? columns.Error.Message : null);
        Assert.That(columns.Value.Select(column => column.Name), Is.EqualTo(new[] { Name("cliente_id"), Name("pedidos"), Name("total") }));
        Assert.That(columns.Value.Select(column => column.IsPrimaryKey), Is.All.False);
        Assert.That(indexes.Value, Is.Empty);
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
        Assert.That(watch.Elapsed, Is.LessThan(TimeSpan.FromSeconds(5)));
        Assert.That(ping.IsSuccess, Is.True);
    }

    /// <summary>
    /// RN-SQL-010: o `Cancel` do driver da IBM só interrompe o comando que já está executando no banco. O pedido que chega um
    /// instante antes (o comando ainda está saindo da API) se perdia, e a consulta rodava até o fim. O teste varre esse instante,
    /// com esperas diferentes entre mandar o comando e cancelar: em nenhuma das vezes a consulta, que leva dezenas de segundos, pode
    /// passar de poucos segundos, e em todas a resposta é a de comando cancelado.
    /// </summary>
    [Test]
    public async Task Cancel_RightAfterTheCommandStarts_StopsIt_EveryTime()
    {
        await using var connection = await OpenAsync();
        var slowest = TimeSpan.Zero;
        var canceled = 0;

        for (var attempt = 0; attempt < 60; attempt++)
        {
            var watch = Stopwatch.StartNew();
            var running = connection.ExecuteAsync(SlowQuery, CancellationToken.None);
            Thread.SpinWait(attempt * 4000);
            connection.Cancel();
            var outcome = await running;

            canceled += outcome.IsFailure ? 1 : 0;
            slowest = watch.Elapsed > slowest ? watch.Elapsed : slowest;
        }

        var ping = await connection.PingAsync(CancellationToken.None);

        Assert.That(canceled, Is.EqualTo(60));
        Assert.That(slowest, Is.LessThan(TimeSpan.FromSeconds(5)));
        Assert.That(ping.IsSuccess, Is.True);
    }

    /// <summary>
    /// RN-SQL-010: a resposta de um comando cancelado diz isso. Quando o cancelamento interrompe a execução, a mensagem é a do banco;
    /// quando ele só corta a leitura (o driver não lança), é a do Prism. Nunca o texto de uma exceção do .NET.
    /// </summary>
    [Test]
    public async Task Cancel_ReportsThatTheCommandWasCanceled()
    {
        await using var connection = await OpenAsync();

        var running = connection.ExecuteAsync(SlowQuery, CancellationToken.None);
        while (await Task.WhenAny(running, Task.Delay(250)) != running)
            connection.Cancel();

        var outcome = await running;

        Assert.That(outcome.IsFailure, Is.True);
        Assert.That(outcome.Error.Message, Is.EqualTo("O comando foi cancelado.").Or.Contain("interrupt"));
    }

    /// <summary>
    /// RN-SQL-010: o comando que grava terminou, e o cancelamento chega depois. O comando é sucesso, com as linhas afetadas, e a
    /// gravação fica: o driver da IBM não lança num `Cancel` tardio, e a marca de cancelamento da conexão não decide nada aqui.
    /// </summary>
    [Test]
    public async Task Cancel_ArrivingWhileAWriteFinishes_NeverTurnsItIntoAFailure()
    {
        var table = await CreateWriteTableAsync();
        await using var connection = await OpenAsync();
        var outcomes = new List<bool>();

        // O cancelamento é disparado em cima do comando, em instantes diferentes: antes, durante e depois de ele rodar no banco.
        for (var delay = 0; delay < 12; delay++)
        {
            var running = connection.ExecuteAsync($"UPDATE {table} SET versao = {delay + 10}", CancellationToken.None);
            await Task.Delay(delay);
            connection.Cancel();
            var outcome = await running;
            var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = {delay + 10}");

            // Ou o banco executou e confirmou (sucesso, com as mil linhas), ou interrompeu e nada foi gravado (falha): nunca o cruzado.
            outcomes.Add(outcome.IsSuccess ? written == 1000 && outcome.Value.RowsAffected == 1000 : written == 0);
        }

        await DropAsync(table);

        Assert.That(outcomes, Is.All.True);
    }

    /// <summary>
    /// RN-SQL-010: o comando que grava e devolve linhas, cancelado enquanto as devolve. O driver da IBM não lança ali: fecha o cursor
    /// em silêncio, e as linhas só param de vir. A resposta saía como sucesso, com página vazia ou com um total menor que o gravado.
    /// O cancelamento é disparado logo ao enviar, no meio da execução e enquanto as linhas voltam. No banco que deixa ler o que
    /// ainda não foi confirmado, quem diz o instante é essa leitura: assim que a gravação aparece pela metade (o comando ainda
    /// executa) e, a partir de ela aparecer inteira (dali em diante ele só devolve linhas), em frações do tempo que ele ainda
    /// leva até o fim, medido na execução sem cancelamento: 0, 25, 50, 75 e 125%, e 300%, que cai depois do fim. No outro, em
    /// instantes espalhados pelo tempo que o comando inteiro levou. A resposta de cada vez é uma de três: o comando foi cancelado
    /// antes de terminar a execução e nada foi gravado; o Prism diz que não sabe se ele foi concluído; ou é sucesso, e então tudo
    /// está gravado e o total é o inteiro. Onde o instante é medido, as três têm de aparecer.
    /// </summary>
    [Test]
    public async Task Cancel_WhileAWriteReturnsItsRows_NeverAnswersSuccessWithPartOfThem()
    {
        const int rows = 30000;
        var table = await CreateWriteTableAsync();
        var command = WriteReturningWideRows(table);
        await using var connection = await OpenAsync();
        await using var observer = await OpenAsync();
        var observes = UncommittedReadIsolation is not { } isolation || (await observer.ExecuteAsync(isolation, CancellationToken.None)).IsSuccess;
        for (var copy = 1; copy < rows / 1000; copy++)
            await connection.ExecuteAsync($"INSERT INTO {table} (numero, versao) SELECT numero + {copy * 1000}, 0 FROM loja.pedido", CancellationToken.None);

        // A execução inteira, sem cancelamento, mede os tempos da varredura: o do comando e, onde a gravação é observada, o que
        // ele ainda leva depois de ela aparecer inteira, devolvendo as linhas.
        var clock = Stopwatch.StartNew();
        var wholeRunning = connection.ExecuteAsync(command, CancellationToken.None);
        await SeeWrittenAsync(wholeRunning, UncommittedReadIsolation is null ? 0 : rows);
        var writtenAt = clock.ElapsedMilliseconds;
        var whole = await wholeRunning;
        var returning = Math.Max(clock.ElapsedMilliseconds - writtenAt, 1);
        await TestContext.Out.WriteLineAsync($"sem cancelamento: {clock.ElapsedMilliseconds} ms ao todo{(UncommittedReadIsolation is null ? string.Empty : $", {returning} ms depois de a gravação aparecer inteira")}");
        var prepared = new List<bool>();
        var crossed = new List<string>();
        var unknown = 0;
        var succeeded = 0;
        var interrupted = 0;

        // Quando cancelar: depois de o observador ver gravadas pelo menos tantas linhas (nenhuma, alguma ou todas), mais uma espera
        // em milissegundos. Sem observador, só a espera, em frações do tempo do comando inteiro.
        (int Seen, long Wait)[] moments = UncommittedReadIsolation is null
            ? [.. Enumerable.Range(0, 20).Select(step => (0, (long)(whole.Value.ElapsedMs * step * 0.06)))]
            : [(0, 0), (1, 0), (1, 0), (rows, 0), (rows, returning / 4), (rows, returning / 2), (rows, returning * 3 / 4), (rows, returning * 5 / 4), (rows, returning * 3)];

        foreach (var (seen, wait) in moments)
        {
            // A tentativa só vale com a tabela zerada: o preparo que o banco recusa reprova o teste.
            prepared.Add((await connection.ExecuteAsync($"UPDATE {table} SET versao = 0", CancellationToken.None)).IsSuccess);
            var moment = $"{(seen == 0 ? "ao enviar" : seen < rows ? "com a gravação pela metade" : "com a gravação à vista")}, mais {wait} ms";
            var running = connection.ExecuteAsync(command, CancellationToken.None);
            await SeeWrittenAsync(running, seen);
            await Task.Delay((int)wait);
            connection.Cancel();
            var outcome = await running;
            var written = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1");
            var isUnknown = outcome.IsFailure && outcome.Error.Message.StartsWith("O cancelamento chegou enquanto o comando devolvia as linhas", StringComparison.Ordinal);
            unknown += isUnknown ? 1 : 0;
            succeeded += outcome.IsSuccess ? 1 : 0;
            interrupted += outcome.IsFailure && !isUnknown ? 1 : 0;
            await TestContext.Out.WriteLineAsync($"cancelado {moment}: {(outcome.IsSuccess ? $"sucesso, total {outcome.Value.Page!.TotalRows}" : outcome.Error.Message.Split('\n')[0])}; {written} gravadas");

            if (outcome.IsSuccess ? written != rows || outcome.Value.Page!.TotalRows != rows : !isUnknown && written != 0)
                crossed.Add($"{moment}: {(outcome.IsSuccess ? $"sucesso com total {outcome.Value.Page!.TotalRows}" : "cancelado")} e {written} gravadas");
        }

        var afterwards = await connection.ExecuteAsync($"UPDATE {table} SET versao = 2 WHERE numero = 1001", CancellationToken.None);
        var seenAfterwards = await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 2");
        await DropAsync(table);

        Assert.That(observes, Is.True, "o banco recusou a leitura do que ainda não foi confirmado");
        Assert.That(whole.IsSuccess, Is.True, whole.IsFailure ? whole.Error.Message : null);
        Assert.That(whole.Value.Page!.TotalRows, Is.EqualTo(rows));
        Assert.That(prepared, Is.All.True, "o banco recusou o preparo de uma tentativa");
        Assert.That(crossed, Is.Empty);
        Assert.That(unknown, Is.GreaterThan(0), "nenhum cancelamento chegou enquanto o comando devolvia as linhas: o teste não exercitou o caso");
        Assert.That(UncommittedReadIsolation is null || succeeded > 0, Is.True, "nenhum cancelamento chegou depois de o comando terminar: o ramo do sucesso com o total inteiro não foi exercitado");
        Assert.That(UncommittedReadIsolation is null || interrupted > 0, Is.True, "nenhum cancelamento chegou antes de o comando terminar a execução: o ramo do cancelado sem nada gravado não foi exercitado");
        Assert.That(afterwards.IsSuccess, Is.True, afterwards.IsFailure ? afterwards.Error.Message : null);
        Assert.That(seenAfterwards, Is.EqualTo(1));

        // Espera a leitura não confirmada ver gravadas pelo menos tantas linhas, ou o comando acabar; com zero, não espera nada.
        // A espera curta entre as consultas deixa o observador fora do caminho do comando que ele observa.
        async Task SeeWrittenAsync(Task running, int atLeast)
        {
            while (atLeast > 0 && !running.IsCompleted && long.Parse((await ExecutePageAsync(observer, $"SELECT COUNT(*) FROM {table} WHERE versao = 1")).Rows[0][0]!) < atLeast)
                await Task.Delay(2);
        }
    }

    /// <summary>
    /// RN-CONN-004: o driver da IBM separa os dados da conexão por `;`, e as aspas do construtor não isolam um valor que tem um: a
    /// senha com `;` nunca conectava, e a resposta era um "Invalid argument" sem dizer de onde. Host, senha, banco e usuário com `;`
    /// são recusados antes de chamar o driver, com a mensagem que diz qual campo e por quê, e sem repetir o valor.
    /// </summary>
    [Test]
    public async Task Open_WithSemicolonInAConnectionField_IsRefusedBeforeTheDriver_SayingWhichField()
    {
        var host = await Client.OpenAsync(Settings with { Host = $"{Settings.Host};x" }, CancellationToken.None);
        var password = await Client.OpenAsync(Settings with { Password = $"{Settings.Password};x" }, CancellationToken.None);
        var database = await Client.OpenAsync(Settings with { Database = $"{Settings.Database};x" }, CancellationToken.None);
        var userName = await Client.OpenAsync(Settings with { UserName = $"{Settings.UserName};x" }, CancellationToken.None);
        var others = await Client.OpenAsync(Settings with { Password = "com espaço = \"aspas\" 'apóstrofo' {chaves} @#%&" }, CancellationToken.None);

        Assert.That(new[] { host, password, database, userName }.Select(opened => opened.IsFailure ? opened.Error.Kind : (EDatabaseFailure?)null), Is.All.EqualTo(EDatabaseFailure.ConnectionFailed));
        Assert.That(host.Error.Message, Is.EqualTo("O driver da IBM não aceita `;` no host: é o caractere com que ele separa os dados da conexão."));
        Assert.That(password.Error.Message, Is.EqualTo("O driver da IBM não aceita `;` na senha: é o caractere com que ele separa os dados da conexão."));
        Assert.That(database.Error.Message, Is.EqualTo("O driver da IBM não aceita `;` no nome do banco: é o caractere com que ele separa os dados da conexão."));
        Assert.That(userName.Error.Message, Is.EqualTo("O driver da IBM não aceita `;` no usuário: é o caractere com que ele separa os dados da conexão."));
        Assert.That(new[] { host, password, database, userName }.Select(opened => opened.Error.SqlState), Is.All.Null);

        // A senha errada sem `;` vai ao banco, e quem responde é ele.
        Assert.That(others.IsFailure, Is.True);
        Assert.That(others.Error.Message, Does.Contain(WrongPasswordMessage));
    }
}
