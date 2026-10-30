using Prism.Infrastructure.Databases.Clients;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-SQL-003: os comandos de controle de transação são recusados sem ir ao banco, pela primeira palavra do comando. O que decide é a
/// palavra que o banco leria primeiro: espaços e comentários antes dela não contam, e a mesma palavra dentro de um comentário, de um
/// texto ou no meio do comando não é recusa.
/// </summary>
public sealed class SqlTextTests
{
    [Trait("SqlText", "IsTransactionControl")]
    [Fact(DisplayName = "OK cada comando de controle de transação é reconhecido")]
    public void IsTransactionControl_ShouldRecognizeEveryCommandOfTheRule()
    {
        //Arrange
        var commands = new[] { "BEGIN", "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE", "START TRANSACTION", "START TRANSACTION READ ONLY", "COMMIT", "COMMIT;", "END", "ROLLBACK", "ROLLBACK TO SAVEPOINT ponto", "ABORT", "SAVEPOINT ponto", "RELEASE SAVEPOINT ponto", "RELEASE ponto", "PREPARE TRANSACTION 'lote'" };

        //Act
        var refused = commands.Where(SqlText.IsTransactionControl).ToArray();

        //Assert
        Assert.Equal(commands, refused);
    }

    [Trait("SqlText", "IsTransactionControl")]
    [Fact(DisplayName = "OK minúsculas, espaços e comentários antes da palavra não escondem o comando")]
    public void IsTransactionControl_ShouldIgnoreCaseWhitespaceAndLeadingComments()
    {
        //Arrange
        var commands = new[] { "begin", "Commit", "  \r\n\t rollback", "-- abre a transação\nbegin", "/* fecha */ commit", "/* um /* dentro */ do outro */ COMMIT", "-- um\n-- dois\n/* três */\n  start\n  transaction", "prepare /* em duas fases */ transaction 'lote'" };

        //Act
        var refused = commands.Where(SqlText.IsTransactionControl).ToArray();

        //Assert
        Assert.Equal(commands, refused);
    }

    /// <summary>O PostgreSQL trata como espaço, além do espaço, da tabulação e das quebras de linha, o avanço de página (`\f`) e a tabulação vertical (`\v`).</summary>
    [Trait("SqlText", "IsTransactionControl")]
    [Fact(DisplayName = "OK avanço de página e tabulação vertical antes da palavra não escondem o comando")]
    public void IsTransactionControl_ShouldSkipFormFeedAndVerticalTab()
    {
        //Arrange
        var commands = new[] { "\fBEGIN", "\vBEGIN", "\f\v \t\r\nBEGIN", ";\f;\vcommit", "start\ftransaction", "start\vtransaction", "-- abre\n\f\vbegin" };

        //Act
        var refused = commands.Where(SqlText.IsTransactionControl).ToArray();

        //Assert
        Assert.Equal(commands, refused);
    }

    /// <summary>
    /// O banco ignora um `;` solto antes do comando e termina o comentário `--` também no retorno de carro. Sem isto `;BEGIN` passava
    /// pela recusa, abria uma transação que ninguém fechava, e a gravação seguinte era desfeita no fechamento do cursor de uma leitura.
    /// </summary>
    [Trait("SqlText", "IsTransactionControl")]
    [Fact(DisplayName = "OK ponto e vírgula solto e comentário terminado em retorno de carro não escondem o comando")]
    public void IsTransactionControl_ShouldSeeThroughEmptyStatementsAndCarriageReturns()
    {
        //Arrange
        var commands = new[] { ";BEGIN", "; ;\n BEGIN", "-- abre\rBEGIN", "-- abre\r\nBEGIN", ";;commit", " ; -- fecha\r rollback", "/* um */ ; /* dois */ start transaction" };

        //Act
        var refused = commands.Where(SqlText.IsTransactionControl).ToArray();

        //Assert
        Assert.Equal(commands, refused);
    }

    /// <summary>`PREPARE TRANSACTION` só é a confirmação em duas fases quando o que vem depois é o identificador entre aspas simples; `transaction` também serve de nome de comando preparado.</summary>
    [Trait("SqlText", "IsTransactionControl")]
    [Fact(DisplayName = "OK PREPARE de um comando chamado transaction não é controle de transação")]
    public void IsTransactionControl_ShouldTellPrepareTransactionFromAPreparedStatementNamedTransaction()
    {
        //Act
        var twoPhase = new[] { "PREPARE TRANSACTION 'lote'", "prepare transaction\n  'lote'", "PREPARE TRANSACTION /* id */ 'lote'" }.Where(SqlText.IsTransactionControl).ToArray();
        var prepared = new[] { "PREPARE transaction AS SELECT 1", "PREPARE transaction (INTEGER) AS SELECT $1", "PREPARE TRANSACTION", "prepare transaction as select 'x'" }.Where(SqlText.IsTransactionControl).ToArray();

        //Assert
        Assert.Equal(3, twoPhase.Length);
        Assert.Empty(prepared);
    }

    /// <summary>O identificador da confirmação em duas fases é uma constante de texto, e o PostgreSQL tem quatro formas de escrevê-la: `'...'`, `$marca$...$marca$`, `E'...'` e `U&amp;'...'`.</summary>
    [Trait("SqlText", "IsTransactionControl")]
    [Fact(DisplayName = "OK PREPARE TRANSACTION é recusado com qualquer forma de constante de texto")]
    public void IsTransactionControl_ShouldRecognizePrepareTransactionWithEveryKindOfTextConstant()
    {
        //Arrange
        var commands = new[] { "PREPARE TRANSACTION 'lote'", "PREPARE TRANSACTION $$lote$$", "prepare transaction $id$lote$id$", "PREPARE TRANSACTION E'lote'", "prepare transaction e'lote'", "PREPARE TRANSACTION U&'lote'", "prepare transaction u&'lote'", "PREPARE TRANSACTION /* id */ $$lote$$" };
        var prepared = new[] { "PREPARE transaction AS SELECT E'x'", "PREPARE transaction AS SELECT $$x$$", "PREPARE transaction (TEXT) AS SELECT U&'x' || $1", "PREPARE TRANSACTION e", "PREPARE TRANSACTION u&" };

        //Act
        var refused = commands.Where(SqlText.IsTransactionControl).ToArray();
        var notRefused = prepared.Where(SqlText.IsTransactionControl).ToArray();

        //Assert
        Assert.Equal(commands, refused);
        Assert.Empty(notRefused);
    }

    [Trait("SqlText", "IsTransactionControl")]
    [Fact(DisplayName = "OK a palavra dentro de comentário, de texto ou no meio do comando não é recusa")]
    public void IsTransactionControl_ShouldNotRefuse_WhenTheWordIsNotTheFirstOne()
    {
        //Arrange
        var commands = new[] { "SELECT 'BEGIN'", "-- BEGIN\nSELECT 1", "/* COMMIT */ SELECT 1", "SELECT 1 -- ROLLBACK", "SELECT 1; COMMIT", "CREATE FUNCTION soma(x INTEGER) RETURNS INTEGER LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT x + 1; END", "DO $$ BEGIN PERFORM 1; END $$", "'BEGIN'" };

        //Act
        var refused = commands.Where(SqlText.IsTransactionControl).ToArray();

        //Assert
        Assert.Empty(refused);
    }

    /// <summary>`PREPARE nome AS ...` prepara uma consulta, e `START` só é transação com `TRANSACTION` depois; um nome que começa igual é outro nome.</summary>
    [Trait("SqlText", "IsTransactionControl")]
    [Fact(DisplayName = "OK comando que só começa parecido não é recusa")]
    public void IsTransactionControl_ShouldNotRefuse_LookAlikeCommands()
    {
        //Arrange
        var commands = new[] { "PREPARE consulta AS SELECT 1", "PREPARE transaction_log AS SELECT 1", "START", "BEGINNING", "END_OF_DAY()", "COMMIT_LOG", "ROLLBACK2", "SELECT 1", "", "   ", "-- só um comentário", "/* comentário que não fecha" };

        //Act
        var refused = commands.Where(SqlText.IsTransactionControl).ToArray();

        //Assert
        Assert.Empty(refused);
    }

    /// <summary>
    /// RN-SQL-013: um `WITH` que grava vai direto ao modo completo, sem a tentativa só de leitura (que deixa passar gravação em tabela
    /// temporária e a desfaria ao fechar o cursor).
    /// </summary>
    [Trait("SqlText", "WithModifiesData")]
    [Fact(DisplayName = "OK WITH com INSERT, UPDATE, DELETE ou MERGE é comando que grava")]
    public void WithModifiesData_ShouldRecognizeEveryDataChangeInsideAWith()
    {
        //Arrange
        var commands = new[]
        {
            "WITH novas AS (INSERT INTO t VALUES (1) RETURNING id) SELECT id FROM novas",
            "WITH mudadas AS (UPDATE t SET a = 1 RETURNING id) SELECT * FROM mudadas",
            "with x as (delete from t returning id) select * from x",
            "WITH x AS (MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DO NOTHING RETURNING t.id) SELECT * FROM x",
            "WITH origem AS (SELECT 1 AS id) INSERT INTO t SELECT id FROM origem",
            "-- carga\nWITH x AS (SELECT 1)\nUPDATE t SET a = 1",
            "WITH x AS (SELECT 'texto' AS a) DELETE FROM t"
        };

        //Act
        var writing = commands.Where(SqlText.WithModifiesData).ToArray();

        //Assert
        Assert.Equal(commands, writing);
    }

    /// <summary>
    /// A palavra tem de ser a palavra inteira, fora de texto, de identificador entre aspas e de comentário: `updated_at`, `deleted_at` e
    /// `is_deleted` existem em quase toda tabela, e não podem tirar o cursor de uma leitura.
    /// </summary>
    [Trait("SqlText", "WithModifiesData")]
    [Fact(DisplayName = "OK nome de coluna, texto e comentário com a palavra não fazem de uma leitura um comando que grava")]
    public void WithModifiesData_ShouldMatchWholeWordsOutsideTextAndComments()
    {
        //Arrange
        var commands = new[]
        {
            "WITH x AS (SELECT id, updated_at, deleted_at, inserted_by, is_deleted FROM t) SELECT * FROM x",
            "WITH x AS (SELECT 'insert into t' AS texto, id FROM t) SELECT * FROM x",
            "WITH x AS (SELECT 'it''s an update' AS texto FROM t) SELECT * FROM x",
            "WITH x AS (SELECT E'isto não é \\'delete\\' de verdade' AS texto FROM t) SELECT * FROM x",
            "WITH x AS (SELECT \"update\", \"delete\" FROM t) SELECT * FROM x",
            "WITH x AS (SELECT 1 -- update t\n) SELECT * FROM x",
            "WITH x AS (SELECT 1 /* delete from t /* merge */ */) SELECT * FROM x",
            "WITH x AS (SELECT $$insert into t$$ AS texto) SELECT * FROM x",
            "WITH x AS (SELECT $corpo$ merge into $$ t $corpo$ AS texto) SELECT * FROM x",
            "WITH merged AS (SELECT 1 AS updates) SELECT updates, $1 FROM merged",
            "SELECT 1",
            "UPDATE t SET a = 1",
            ""
        };

        //Act
        var writing = commands.Where(SqlText.WithModifiesData).ToArray();

        //Assert
        Assert.Empty(writing);
    }

    /// <summary>
    /// Uma consulta pode vir entre parênteses, e o `WITH` de dentro grava do mesmo jeito. Sem isto ela ficava só com a tentativa de
    /// leitura, em que a gravação em tabela temporária passa e é desfeita quando o cursor fecha antes do fim.
    /// </summary>
    [Trait("SqlText", "WithModifiesData")]
    [Fact(DisplayName = "OK WITH que grava entre parênteses é comando que grava")]
    public void WithModifiesData_ShouldSeeThroughLeadingParentheses()
    {
        //Arrange
        var commands = new[]
        {
            "(WITH g AS (INSERT INTO rascunho SELECT numero FROM generate_series(1, 500) AS numero RETURNING id) SELECT id FROM g)",
            "((WITH g AS (DELETE FROM t RETURNING id) SELECT id FROM g))",
            " ( /* nota */ ( -- outra\n with g AS (UPDATE t SET a = 1 RETURNING id) SELECT id FROM g ) )",
            ";(WITH g AS (MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DO NOTHING RETURNING t.id) SELECT * FROM g)"
        };

        //Act
        var writing = commands.Where(SqlText.WithModifiesData).ToArray();

        //Assert
        Assert.Equal(commands, writing);
    }

    /// <summary>A leitura entre parênteses continua leitura: só o `WITH` com gravação dentro deixa de ser.</summary>
    [Trait("SqlText", "WithModifiesData")]
    [Fact(DisplayName = "OK leitura entre parênteses não é comando que grava")]
    public void WithModifiesData_ShouldNotTakeAParenthesizedReadForAWrite()
    {
        //Arrange
        var commands = new[]
        {
            "(SELECT numero FROM loja.pedido)",
            "((SELECT 1) UNION (SELECT 2))",
            "(WITH x AS (SELECT id, updated_at FROM t) SELECT * FROM x)",
            "(SELECT 'insert' AS palavra) UNION ALL (SELECT 'delete')",
            "(VALUES (1), (2))",
            "(",
            "(("
        };

        //Act
        var writing = commands.Where(SqlText.WithModifiesData).ToArray();
        var firstWords = commands.Select(command => SqlText.LeadingWords(command).First).ToArray();

        //Assert
        Assert.Empty(writing);
        Assert.All(firstWords, first => Assert.Equal("(", first));
    }

    /// <summary>
    /// No PostgreSQL o `$` pode fazer parte de um identificador (`k$a$b`, `a$$`). Lido como abertura de `$marca$`, ele escondia o resto
    /// do comando, inclusive a gravação. Um `$` só abre texto quando o caractere anterior não é de palavra.
    /// </summary>
    [Trait("SqlText", "WithModifiesData")]
    [Fact(DisplayName = "OK cifrão dentro de um identificador não abre texto nem esconde a gravação")]
    public void WithModifiesData_ShouldNotTakeADollarInsideAnIdentifierForAQuoteTag()
    {
        //Arrange
        var commands = new[]
        {
            "WITH a AS (SELECT 1 AS k$a$b), g AS (INSERT INTO rascunho SELECT 1 RETURNING id) SELECT id FROM g",
            "WITH a AS (SELECT 1 AS a$$), g AS (INSERT INTO rascunho SELECT 1 RETURNING id) SELECT 1 AS b$$ FROM g",
            "WITH a AS (SELECT 1 AS total$x$), g AS (DELETE FROM t RETURNING id) SELECT 2 AS outro$x$ FROM g"
        };
        var texts = new[]
        {
            "WITH x AS (SELECT $$insert into t$$ AS texto) SELECT * FROM x",
            "WITH x AS (SELECT 'a'||$m$ delete $m$ AS texto) SELECT * FROM x",
            "WITH x AS (SELECT 1 AS k$a$b, $a$ update $a$ AS texto) SELECT * FROM x"
        };

        //Act
        var writing = commands.Where(SqlText.WithModifiesData).ToArray();
        var writingTexts = texts.Where(SqlText.WithModifiesData).ToArray();

        //Assert
        Assert.Equal(commands, writing);
        Assert.Empty(writingTexts);
    }

    /// <summary>
    /// No PostgreSQL todo caractere a partir de U+0080 é letra de identificador e de marca de `$marca$`. Lida só com as letras do ASCII,
    /// uma coluna `é$a$` abria um texto que não existe, e um texto `$é$ ' $é$` não era visto; os dois escondiam a gravação que vinha
    /// depois, o comando passava por leitura, e o que ele gravava em tabela temporária era desfeito quando o cursor fechava.
    /// </summary>
    [Trait("SqlText", "WithModifiesData")]
    [Fact(DisplayName = "OK caractere de fora do ASCII é parte de identificador e de marca, e não esconde a gravação")]
    public void WithModifiesData_ShouldTreatCharactersBeyondAsciiAsPartOfIdentifiersAndTags()
    {
        //Arrange
        var commands = new[]
        {
            "WITH a AS (SELECT 1 AS é$a$), g AS (INSERT INTO rascunho SELECT numero FROM generate_series(1, 500) AS numero RETURNING id) SELECT 2 AS ç$a$ FROM g",
            "WITH a AS (SELECT 1 AS é$$), g AS (INSERT INTO rascunho SELECT 1 RETURNING id) SELECT 2 AS ç$$ FROM g",
            "WITH a AS (SELECT $é$ ' $é$ AS t), g AS (INSERT INTO rascunho SELECT numero FROM generate_series(1, 500) AS numero RETURNING id) SELECT id FROM g",
            "WITH a AS (SELECT $é$ \" $é$ AS t), g AS (INSERT INTO rascunho SELECT 1 RETURNING id) SELECT id FROM g",
            "WITH a AS (SELECT $ação$ it's $ação$ AS t), g AS (DELETE FROM t RETURNING id) SELECT id FROM g",
            "WITH a AS (SELECT 1 AS é, $éé$ ' \" $éé$ AS t), g AS (UPDATE t SET a = 1 RETURNING id) SELECT id FROM g",
            "WITH a AS (SELECT $中$ ' $中$ AS t), g AS (INSERT INTO rascunho SELECT 1 RETURNING id) SELECT id FROM g",
            "WITH a AS (SELECT 1 AS 中$a$), g AS (INSERT INTO rascunho SELECT 1 RETURNING id) SELECT 2 AS 中$a$ FROM g"
        };
        var texts = new[]
        {
            "WITH x AS (SELECT $é$ insert into t $é$ AS texto) SELECT * FROM x",
            "WITH x AS (SELECT 1 AS é$a$, $ação$ delete $ação$ AS texto) SELECT * FROM x",
            "WITH x AS (SELECT 1 AS éupdate, 2 AS deleteção, 3 AS ınsert) SELECT * FROM x"
        };

        //Act
        var writing = commands.Where(SqlText.WithModifiesData).ToArray();
        var writingTexts = texts.Where(SqlText.WithModifiesData).ToArray();

        //Assert
        Assert.Equal(commands, writing);
        Assert.Empty(writingTexts);
    }

    /// <summary>
    /// Uma letra de fora do ASCII colada à palavra faz dela outro identificador, como no banco: `BEGINé` é um nome, e o erro de sintaxe
    /// é dele. E o banco só iguala maiúsculas e minúsculas do ASCII: `begın`, com o i sem pingo do turco, não é `BEGIN`.
    /// </summary>
    [Trait("SqlText", "IsTransactionControl")]
    [Fact(DisplayName = "OK palavra com caractere de fora do ASCII não é comando de controle de transação")]
    public void IsTransactionControl_ShouldNotRefuse_WordsWithCharactersBeyondAscii()
    {
        //Arrange
        var commands = new[] { "BEGINé", "éBEGIN", "commitção", "begın", "ſavepoint ponto", "START TRANSACTIONé", "PREPARE TRANSACTIONé 'lote'" };

        //Act
        var refused = commands.Where(SqlText.IsTransactionControl).ToArray();

        //Assert
        Assert.Empty(refused);
    }

    /// <summary>O que já valia no ASCII continua valendo: `$` dentro de identificador, parâmetro `$1`, texto `$$...$$` e `$marca$...$marca$`.</summary>
    [Trait("SqlText", "WithModifiesData")]
    [Fact(DisplayName = "OK cifrão em identificador, parâmetro e texto do ASCII continuam lidos como antes")]
    public void WithModifiesData_ShouldKeepReadingAsciiDollarsAsBefore()
    {
        //Arrange
        var commands = new[]
        {
            "WITH a AS (SELECT 1 AS k$a$b), g AS (INSERT INTO rascunho SELECT 1 RETURNING id) SELECT id FROM g",
            "WITH a AS (SELECT 1 AS a$$), g AS (INSERT INTO rascunho SELECT 1 RETURNING id) SELECT 1 AS b$$ FROM g",
            "WITH a AS (SELECT 1 AS x$1), g AS (INSERT INTO rascunho SELECT 1 RETURNING id) SELECT 2 AS y$1 FROM g",
            "WITH a AS (SELECT $$texto$$ AS t), g AS (INSERT INTO rascunho SELECT 1 RETURNING id) SELECT id FROM g",
            "WITH a AS (SELECT $marca$ ' $marca$ AS t), g AS (INSERT INTO rascunho SELECT 1 RETURNING id) SELECT id FROM g",
            "WITH a AS (SELECT $1::TEXT AS t), g AS (INSERT INTO rascunho SELECT 1 RETURNING id) SELECT id FROM g"
        };
        var texts = new[]
        {
            "WITH x AS (SELECT $$insert into t$$ AS texto) SELECT * FROM x",
            "WITH x AS (SELECT $marca$ delete from t $marca$ AS texto) SELECT * FROM x",
            "WITH x AS (SELECT 1 AS k$a$b, $a$ update $a$ AS texto) SELECT * FROM x"
        };

        //Act
        var writing = commands.Where(SqlText.WithModifiesData).ToArray();
        var writingTexts = texts.Where(SqlText.WithModifiesData).ToArray();

        //Assert
        Assert.Equal(commands, writing);
        Assert.Empty(writingTexts);
    }

    [Trait("SqlText", "LeadingWords")]
    [Fact(DisplayName = "OK as duas primeiras palavras saem em maiúsculas, sem os comentários")]
    public void LeadingWords_ShouldReturnTheFirstTwoWordsInUpperCase()
    {
        //Act
        var select = SqlText.LeadingWords("  select * from t");
        var with = SqlText.LeadingWords("-- relatório\nWith vendas AS (SELECT 1) SELECT * FROM vendas");
        var parenthesis = SqlText.LeadingWords(" (SELECT 1) UNION (SELECT 2)");
        var single = SqlText.LeadingWords("VACUUM");
        var empty = SqlText.LeadingWords(" /* nada */ ");

        //Assert
        Assert.Equal(("SELECT", string.Empty), select);
        Assert.Equal(("WITH", "VENDAS"), with);
        Assert.Equal(("(", string.Empty), parenthesis);
        Assert.Equal(("VACUUM", string.Empty), single);
        Assert.Equal((string.Empty, string.Empty), empty);
    }

    /// <summary>
    /// RN-SQL-003, no Db2: um comando que começa por `BEGIN` e continua é um bloco composto, que o banco executa e confirma inteiro, e
    /// não controle de transação. `BEGIN` sozinho, com `WORK` ou com `TRANSACTION` não é comando do Db2: continua recusado, como os
    /// demais. `RELEASE` só é de transação com `SAVEPOINT`.
    /// </summary>
    [Trait("SqlText", "IsTransactionControl")]
    [Fact(DisplayName = "OK no Db2 o bloco composto que começa por BEGIN não é recusa, e o controle de transação continua sendo")]
    public void IsTransactionControl_ShouldAcceptCompoundBlocksAndRefuseTransactionControl_InDb2()
    {
        //Arrange
        var blocks = new[] { "BEGIN ATOMIC UPDATE t SET a = 1; UPDATE t SET a = 2; END", "BEGIN\n  DECLARE alvo INTEGER;\n  SET alvo = 1;\nEND", "begin not atomic delete from t; end", "-- bloco\nBEGIN /* corpo */ DECLARE x INTEGER; END", "RELEASE CURRENT", "RELEASE ALL" };
        var commands = new[] { "COMMIT", "COMMIT WORK", "ROLLBACK", "ROLLBACK TO SAVEPOINT ponto", "SAVEPOINT ponto ON ROLLBACK RETAIN CURSORS", "RELEASE SAVEPOINT ponto", "RELEASE TO SAVEPOINT ponto", "BEGIN", "BEGIN;", "begin work", "BEGIN TRANSACTION", "START TRANSACTION", "/* um /* dentro */ do outro */ COMMIT", ";BEGIN" };

        //Act
        var refusedBlocks = blocks.Where(sql => SqlText.IsTransactionControl(sql, ESqlDialect.Db2)).ToArray();
        var refused = commands.Where(sql => SqlText.IsTransactionControl(sql, ESqlDialect.Db2)).ToArray();

        //Assert
        Assert.Empty(refusedBlocks);
        Assert.Equal(commands, refused);
    }

    /// <summary>
    /// RN-SQL-003, no Informix: além de `--` e de `/* */`, o banco pula comentário entre chaves, e o comentário de bloco dele acaba no
    /// primeiro `*/` (não há um dentro do outro). Um `BEGIN WORK` depois de qualquer um deles é o comando que o banco executaria.
    /// </summary>
    [Trait("SqlText", "IsTransactionControl")]
    [Fact(DisplayName = "OK no Informix comentário entre chaves e de bloco sem aninhamento não escondem o comando")]
    public void IsTransactionControl_ShouldSkipBraceAndFlatBlockComments_InInformix()
    {
        //Arrange
        var commands = new[] { "BEGIN WORK", "begin", "COMMIT WORK", "ROLLBACK WORK", "ROLLBACK WORK TO SAVEPOINT ponto", "SAVEPOINT ponto", "RELEASE SAVEPOINT ponto", "{ abre a transação } BEGIN WORK", "{ um; dois }\n{ três } begin work", "/* um /* dentro */ BEGIN WORK", "-- abre\n{ de novo }\n/* e mais */ BEGIN WORK", "{ sem fecho /* } commit work" };
        var notCommands = new[] { "{ BEGIN WORK } SELECT 1 FROM systables", "{ comentário que não fecha BEGIN WORK", "/* BEGIN WORK */ SELECT 1 FROM systables", "SELECT 1 FROM systables { BEGIN WORK }", "EXECUTE PROCEDURE abre()" };

        //Act
        var refused = commands.Where(sql => SqlText.IsTransactionControl(sql, ESqlDialect.Informix)).ToArray();
        var refusedOthers = notCommands.Where(sql => SqlText.IsTransactionControl(sql, ESqlDialect.Informix)).ToArray();

        //Assert
        Assert.Equal(commands, refused);
        Assert.Empty(refusedOthers);
    }

    /// <summary>
    /// O que é comentário depende do banco. A chave só é comentário no Informix: no PostgreSQL e no Db2 o banco não a pula. E o
    /// comentário de bloco com outro dentro acaba em lugares diferentes: no PostgreSQL e no Db2 no fecho do de fora, no Informix no
    /// primeiro fecho. Lido com a regra do banco errado, um `BEGIN WORK` ficaria escondido de um e apareceria para o outro.
    /// </summary>
    [Trait("SqlText", "IsTransactionControl")]
    [Fact(DisplayName = "OK a chave e o comentário de bloco aninhado são lidos como o banco do comando os lê")]
    public void IsTransactionControl_ShouldReadCommentsAsTheDatabaseOfTheCommandDoes()
    {
        //Arrange
        const string afterBraces = "{ x } BEGIN";
        const string nestedThenBegin = "/* um /* dentro */ BEGIN WORK -- */";

        //Act
        var bracesInPostgres = SqlText.IsTransactionControl(afterBraces, ESqlDialect.PostgreSql);
        var bracesInDb2 = SqlText.IsTransactionControl(afterBraces, ESqlDialect.Db2);
        var bracesInInformix = SqlText.IsTransactionControl(afterBraces, ESqlDialect.Informix);
        var nestedInPostgres = SqlText.IsTransactionControl(nestedThenBegin, ESqlDialect.PostgreSql);
        var nestedInDb2 = SqlText.IsTransactionControl(nestedThenBegin, ESqlDialect.Db2);
        var nestedInInformix = SqlText.IsTransactionControl(nestedThenBegin, ESqlDialect.Informix);

        //Assert
        Assert.False(bracesInPostgres);
        Assert.False(bracesInDb2);
        Assert.True(bracesInInformix);
        Assert.False(nestedInPostgres);
        Assert.False(nestedInDb2);
        Assert.True(nestedInInformix);
    }

    /// <summary>
    /// RN-SQL-013, nos bancos sem transação só de leitura (Db2 e Informix): só uma leitura só fica com o cursor aberto entre as
    /// páginas. As palavras de gravação dentro de texto, de identificador entre aspas e de comentário não contam, nem o `;` do fim.
    /// </summary>
    [Trait("SqlText", "IsSingleRead")]
    [Fact(DisplayName = "OK leitura só é reconhecida, com palavras de gravação em texto, nome e comentário")]
    public void IsSingleRead_ShouldRecognizeASingleRead()
    {
        //Arrange
        var reads = new[]
        {
            "SELECT numero FROM pedido",
            "  select * from pedido order by numero;",
            "SELECT numero FROM pedido ;  -- fim",
            "SELECT numero FROM pedido;\n/* fim */\n;;",
            "WITH x AS (SELECT 1 AS a FROM t) SELECT a FROM x",
            "VALUES (1), (2)",
            "(SELECT 1 FROM t) UNION ALL (SELECT 2 FROM t)",
            "SELECT updated_at, is_deleted, inserted, merged FROM auditoria",
            "SELECT 'insert into t; delete from t' AS texto FROM t",
            "SELECT \"update\", \"a;b\" FROM t",
            "SELECT a /* update t; */ FROM t -- delete; from t",
            "-- relatório\n/* do mês */ SELECT 1 FROM t"
        };

        //Act
        var readInDb2 = reads.Where(sql => SqlText.IsSingleRead(sql, ESqlDialect.Db2)).ToArray();
        var readInInformix = reads.Where(sql => SqlText.IsSingleRead(sql, ESqlDialect.Informix)).ToArray();

        //Assert
        Assert.Equal(reads, readInDb2);
        Assert.Equal(reads, readInInformix);
    }

    /// <summary>
    /// O que não pode ficar paginado: o comando que não começa como leitura, o `SELECT` que grava (no Db2, por
    /// `FINAL TABLE (UPDATE ...)`), e o envio com outro comando depois do `;`, que o driver da IBM só executaria quando o cursor do
    /// primeiro fechasse. Um `FOR UPDATE` erra para o lado seguro: roda até o fim.
    /// </summary>
    [Trait("SqlText", "IsSingleRead")]
    [Fact(DisplayName = "OK comando que grava, que não começa como leitura ou que traz outro depois do ponto e vírgula não é leitura só")]
    public void IsSingleRead_ShouldRefuseWritesAndSecondStatements()
    {
        //Arrange
        var others = new[]
        {
            "UPDATE t SET a = 1",
            "EXECUTE FUNCTION grava()",
            "CALL grava()",
            "BEGIN ATOMIC UPDATE t SET a = 1; END",
            "",
            "-- só um comentário",
            "SELECT numero FROM FINAL TABLE (UPDATE t SET versao = 1)",
            "select numero from old table (delete from t)",
            "SELECT numero FROM NEW TABLE (INSERT INTO t VALUES (1))",
            "WITH g AS (SELECT a FROM FINAL TABLE (MERGE INTO t USING s ON t.a = s.a WHEN MATCHED THEN UPDATE SET b = 1)) SELECT a FROM g",
            "SELECT a FROM t FOR UPDATE",
            "SELECT a FROM t; UPDATE t SET a = 1",
            "SELECT a FROM t; SELECT b FROM t",
            "SELECT a FROM t;\n-- e depois\nCALL grava()",
            "SELECT ';' FROM t; EXECUTE PROCEDURE grava()",
            "SELECT a FROM t /* fim */ ; /* outro */ CALL grava()"
        };

        //Act
        var readInDb2 = others.Where(sql => SqlText.IsSingleRead(sql, ESqlDialect.Db2)).ToArray();
        var readInInformix = others.Where(sql => SqlText.IsSingleRead(sql, ESqlDialect.Informix)).ToArray();

        //Assert
        Assert.Empty(readInDb2);
        Assert.Empty(readInInformix);
    }

    /// <summary>No Informix o que está entre chaves é comentário: nem a palavra de gravação nem o `;` de dentro contam. No Db2 a chave não é nada.</summary>
    [Trait("SqlText", "IsSingleRead")]
    [Fact(DisplayName = "OK palavra de gravação e ponto e vírgula entre chaves só são comentário no Informix")]
    public void IsSingleRead_ShouldTreatBracesAsACommentOnlyInInformix()
    {
        //Arrange
        const string sql = "SELECT a { update t; delete } FROM t";

        //Act
        var inInformix = SqlText.IsSingleRead(sql, ESqlDialect.Informix);
        var inDb2 = SqlText.IsSingleRead(sql, ESqlDialect.Db2);

        //Assert
        Assert.True(inInformix);
        Assert.False(inDb2);
    }

    /// <summary>
    /// RN-SQL-001, no Db2 e no Informix: o driver da IBM executa um por um os comandos separados por `;`, cada um com a própria
    /// confirmação. Toda forma que ele (ou o servidor do Informix) executa como mais de um comando é recusada. A lista saiu da
    /// conferência contra os dois bancos de verdade.
    /// </summary>
    [Trait("SqlText", "HasSeveralStatements")]
    [Fact(DisplayName = "OK envio com outro comando depois do ponto e vírgula é mais de um comando")]
    public void HasSeveralStatements_ShouldSeeEveryFormTheDriverRunsAsMoreThanOne()
    {
        //Arrange
        var several = new[]
        {
            "UPDATE t SET a = 1; UPDATE t SET a = 2",
            "UPDATE t SET a = 1;UPDATE t SET a = 2;UPDATE t SET a = 3",
            "UPDATE t SET a = 1; SELEC 1; UPDATE t SET a = 2",
            "UPDATE t SET a = 1; BEGIN WORK",
            "INSERT INTO t VALUES (1); BEGIN WORK",
            "DELETE FROM t; BEGIN WORK",
            "SELECT a FROM t; UPDATE t SET a = 1",
            "UPDATE t SET a = 1 WHERE b = 'x;y'; UPDATE t SET a = 2",
            "UPDATE t SET a = 1 -- um\n; UPDATE t SET a = 2",
            "UPDATE t SET a = 1 -- um; dois\n; UPDATE t SET a = 3",
            "UPDATE t SET a = 1 /* um */; UPDATE t SET a = 2",
            "UPDATE t SET a = 1 /* ' */; UPDATE t SET a = 2 /* ' */",
            "UPDATE t SET a = 1 -- /*\n; UPDATE t SET a = 2 -- */",
            "SELECT '--' FROM t; UPDATE t SET a = 2",
            "SELECT '/*' FROM t; UPDATE t SET a = 2 /* */",
            "SELECT 'a\\' FROM t; UPDATE t SET a = 2",
            ";;UPDATE t SET a = 1; UPDATE t SET a = 2",
            "CREATE VIEW v AS SELECT a FROM t; UPDATE t SET a = 2",
            "CREATE TABLE x (a INTEGER); UPDATE t SET a = 2",
            "SET LOCK MODE TO WAIT 5; UPDATE t SET a = 2",
            "UPDATE t SET a = 1; CREATE PROCEDURE p () UPDATE t SET a = 2; UPDATE t SET a = 3; END PROCEDURE",
            "UPDATE t SET a = 1; BEGIN UPDATE t SET a = 2; UPDATE t SET a = 3; END"
        };

        //Act
        var severalInDb2 = several.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Db2)).ToArray();
        var severalInInformix = several.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Informix)).ToArray();

        //Assert
        Assert.Equal(several, severalInDb2);
        Assert.Equal(several, severalInInformix);
    }

    /// <summary>O `;` do fim, o comentário depois dele, os `;` soltos e o `;` dentro de texto, de nome entre aspas e de comentário não fazem um segundo comando.</summary>
    [Trait("SqlText", "HasSeveralStatements")]
    [Fact(DisplayName = "OK ponto e vírgula do fim, em texto e em comentário não é segundo comando")]
    public void HasSeveralStatements_ShouldNotCountTheFinalSemicolonNorTheOnesInTextAndComments()
    {
        //Arrange
        var single = new[]
        {
            "UPDATE t SET a = 1",
            "UPDATE t SET a = 1;",
            "UPDATE t SET a = 1 ; -- fim",
            "UPDATE t SET a = 1; /* fim */",
            "UPDATE t SET a = 1;;",
            ";;UPDATE t SET a = 1",
            "; ;\n UPDATE t SET a = 1 ; ;",
            "SELECT 'a; UPDATE t SET a = 2' FROM t",
            "SELECT 1 AS \"a; UPDATE t SET a = 2\" FROM t",
            "SELECT 'it''s; UPDATE t SET a = 2' FROM t",
            "SELECT '\\'' FROM t; UPDATE t SET a = 2 --'",
            "UPDATE t SET a = 1 -- um; UPDATE t SET a = 2",
            "UPDATE t SET a = 1 /* ; UPDATE t SET a = 2 ; */",
            "",
            ";",
            "-- só um comentário; e mais"
        };

        //Act
        var severalInDb2 = single.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Db2)).ToArray();
        var severalInInformix = single.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Informix)).ToArray();

        //Assert
        Assert.Empty(severalInDb2);
        Assert.Empty(severalInInformix);
    }

    /// <summary>
    /// O comentário `--` do Db2 e do Informix só acaba na quebra de linha (`\n`): o retorno de carro continua dentro dele, para o
    /// banco e para o driver. Lido com a regra do PostgreSQL, o texto abaixo teria uma aspa aberta depois do `\r`, que engoliria o
    /// `;`, e o envio passaria por um comando só; o driver executaria os dois.
    /// </summary>
    [Trait("SqlText", "HasSeveralStatements")]
    [Fact(DisplayName = "OK comentário de linha do Db2 e do Informix não acaba no retorno de carro")]
    public void HasSeveralStatements_ShouldEndTheLineCommentOnlyAtTheLineFeed()
    {
        //Arrange
        const string hidden = "UPDATE t SET a = 1 -- um\r'\n; UPDATE t SET a = 2 --'";
        const string comment = "UPDATE t SET a = 1 -- um\r; UPDATE t SET a = 2";

        //Act
        var hiddenInDb2 = SqlText.HasSeveralStatements(hidden, ESqlDialect.Db2);
        var hiddenInInformix = SqlText.HasSeveralStatements(hidden, ESqlDialect.Informix);
        var commentInDb2 = SqlText.HasSeveralStatements(comment, ESqlDialect.Db2);
        var controlAfterCarriageReturnInDb2 = SqlText.IsTransactionControl("-- abre\rCOMMIT", ESqlDialect.Db2);
        var controlAfterCarriageReturnInPostgres = SqlText.IsTransactionControl("-- abre\rCOMMIT", ESqlDialect.PostgreSql);

        //Assert
        Assert.True(hiddenInDb2);
        Assert.True(hiddenInInformix);
        Assert.False(commentInDb2);
        Assert.False(controlAfterCarriageReturnInDb2);
        Assert.True(controlAfterCarriageReturnInPostgres);
    }

    /// <summary>
    /// O que é comentário depende do banco, e o `;` de dentro dele não separa. A chave só é comentário no Informix. O servidor do
    /// Informix executa os dois comandos do primeiro texto mesmo sem o driver os dividir. O comentário de bloco com outro dentro só
    /// existe no Db2, e só para o banco: o driver, que divide o envio, o encerra no primeiro `*/` e vê o `;` que vem depois. O
    /// último texto é um comando só para o Db2 e mais de um para o driver dele, e é recusado.
    /// </summary>
    [Trait("SqlText", "HasSeveralStatements")]
    [Fact(DisplayName = "OK o ponto e vírgula dentro de chave e de comentário aninhado é lido como o banco e o driver o leem")]
    public void HasSeveralStatements_ShouldReadCommentsAsTheDatabaseOfTheCommandDoes()
    {
        //Arrange
        const string quoteInBraces = "UPDATE t SET a = 1 { ' }; UPDATE t SET a = 2 { ' }";
        const string semicolonInBraces = "UPDATE t SET a = 1 { ; UPDATE t SET a = 2 ; }";
        const string nested = "UPDATE t SET a = 1 /* um /* dentro */ ; UPDATE t SET a = 2 ; */";

        //Act
        var quoteInBracesInInformix = SqlText.HasSeveralStatements(quoteInBraces, ESqlDialect.Informix);
        var semicolonInBracesInInformix = SqlText.HasSeveralStatements(semicolonInBraces, ESqlDialect.Informix);
        var semicolonInBracesInDb2 = SqlText.HasSeveralStatements(semicolonInBraces, ESqlDialect.Db2);
        var nestedInDb2 = SqlText.HasSeveralStatements(nested, ESqlDialect.Db2);
        var nestedInInformix = SqlText.HasSeveralStatements(nested, ESqlDialect.Informix);

        //Assert
        Assert.True(quoteInBracesInInformix);
        Assert.False(semicolonInBracesInInformix);
        Assert.True(semicolonInBracesInDb2);
        Assert.True(nestedInDb2);
        Assert.True(nestedInInformix);
    }

    /// <summary>
    /// RN-SQL-001: no Db2 o bloco com `;` no corpo é um comando só, e o texto que começa por ele vai inteiro: o banco recusa o que
    /// vier depois do fim do bloco sem executar nada. Só é bloco o que começa por ele.
    /// </summary>
    [Trait("SqlText", "HasSeveralStatements")]
    [Fact(DisplayName = "OK no Db2 procedimento, função, gatilho e bloco composto são um comando só")]
    public void HasSeveralStatements_ShouldTakeADb2BlockAsOneStatement()
    {
        //Arrange
        var blocks = new[]
        {
            "CREATE PROCEDURE p () LANGUAGE SQL BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",
            "create or replace procedure p () begin update t set a = 1; end;",
            "CREATE\nOR /* x */ REPLACE\tPROCEDURE p () BEGIN IF 1 = 1 THEN UPDATE t SET a = 1; END IF; END",
            "CREATE FUNCTION f () RETURNS INTEGER LANGUAGE SQL BEGIN DECLARE n INTEGER; SET n = 1; RETURN n; END",
            "CREATE OR REPLACE FUNCTION f () RETURNS INTEGER BEGIN RETURN 1; END",
            "CREATE TRIGGER g AFTER INSERT ON t FOR EACH ROW BEGIN ATOMIC UPDATE t SET a = 1; UPDATE t SET a = 2; END",
            "CREATE OR REPLACE TRIGGER g AFTER INSERT ON t FOR EACH ROW BEGIN ATOMIC UPDATE t SET a = 1; END",
            "BEGIN ATOMIC UPDATE t SET a = 1; UPDATE t SET a = 2; END",
            "BEGIN\n  DECLARE n INTEGER DEFAULT 0;\n  UPDATE t SET a = n;\nEND;",
            "-- cria\n/* o bloco */ BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END -- fim",
            "BEGIN UPDATE t SET a = 1; END; UPDATE t SET a = 2"
        };
        var notBlocks = new[] { "SELECT a AS begin FROM t; UPDATE t SET a = 2", "CREATE TABLE begin (a INTEGER); UPDATE t SET a = 2", "bloco: BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END bloco" };

        //Act
        var severalBlocks = blocks.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Db2)).ToArray();
        var severalNotBlocks = notBlocks.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Db2)).ToArray();

        //Assert
        Assert.Empty(severalBlocks);
        Assert.Equal(notBlocks, severalNotBlocks);
    }

    /// <summary>
    /// RN-SQL-001: no Informix o corpo da rotina vai até o `END PROCEDURE` ou o `END FUNCTION`, e ali o `;` não separa. Depois do
    /// fim ele volta a separar: o servidor executaria o que viesse depois, e um `BEGIN WORK` ali é o que a regra existe para barrar.
    /// A rotina externa não tem corpo nem fim, e o gatilho separa as ações com vírgula: neles todo `;` separa. O bloco composto não
    /// existe no Informix.
    /// </summary>
    [Trait("SqlText", "HasSeveralStatements")]
    [Fact(DisplayName = "OK no Informix a rotina é um comando só até o END PROCEDURE, e o que vem depois é outro comando")]
    public void HasSeveralStatements_ShouldTakeAnInformixRoutineAsOneStatement_UpToItsEnd()
    {
        //Arrange
        var routines = new[]
        {
            "CREATE PROCEDURE p () UPDATE t SET a = 1; UPDATE t SET a = 2; END PROCEDURE",
            "create procedure p () update t set a = 1; end procedure;",
            "CREATE DBA PROCEDURE p () UPDATE t SET a = 1; UPDATE t SET a = 2; END PROCEDURE",
            "CREATE OR REPLACE PROCEDURE p () UPDATE t SET a = 1; END PROCEDURE; -- fim",
            "CREATE PROCEDURE IF NOT EXISTS p () UPDATE t SET a = 1; END PROCEDURE { fim }",
            "CREATE FUNCTION f () RETURNING INTEGER; DEFINE n INTEGER; LET n = 1; RETURN n; END FUNCTION",
            "CREATE PROCEDURE p () IF 1 = 1 THEN UPDATE t SET a = 1; END IF; BEGIN UPDATE t SET a = 2; END; END PROCEDURE",
            "CREATE PROCEDURE p () UPDATE t SET a = 1; END PROCEDURE DOCUMENT 'um; dois' WITH LISTING IN '/tmp/p.txt';",
            "{ cria }\nCREATE PROCEDURE p () UPDATE t SET a = 1; { e; mais } UPDATE t SET a = 2; END PROCEDURE",
            "CREATE TRIGGER g INSERT ON t FOR EACH ROW (UPDATE t SET a = 1, UPDATE t SET a = 2);"
        };
        var several = new[]
        {
            "CREATE PROCEDURE p () UPDATE t SET a = 1; END PROCEDURE; UPDATE t SET a = 2",
            "CREATE PROCEDURE p () UPDATE t SET a = 1; END PROCEDURE; BEGIN WORK",
            "CREATE DBA PROCEDURE p () UPDATE t SET a = 1; END PROCEDURE; BEGIN WORK",
            "CREATE FUNCTION f () RETURNING INTEGER; RETURN 1; END FUNCTION; BEGIN WORK",
            "CREATE PROCEDURE p () UPDATE t SET a = 1; END PROCEDURE DOCUMENT 'x'; BEGIN WORK",
            "CREATE FUNCTION f (INTEGER) RETURNING INTEGER EXTERNAL NAME '/tmp/f.so(f)' LANGUAGE C; UPDATE t SET a = 2",
            "CREATE PROCEDURE p () UPDATE t SET a = 1; UPDATE t SET a = 2",
            "CREATE TRIGGER g INSERT ON t FOR EACH ROW (UPDATE t SET a = 1); BEGIN WORK",
            "CREATE TRIGGER g INSERT ON t FOR EACH ROW (UPDATE t SET a = 1; UPDATE t SET a = 2)",
            "BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END"
        };

        //Act
        var severalRoutines = routines.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Informix)).ToArray();
        var severalOthers = several.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Informix)).ToArray();

        //Assert
        Assert.Empty(severalRoutines);
        Assert.Equal(several, severalOthers);
    }

    /// <summary>
    /// O driver da IBM manda cada pedaço entre dois `;` como um comando, também o vazio: o `;` solto na frente faz o banco recusar o
    /// envio, e o comentário depois do `;` do fim é recusado depois de o comando já estar executado e confirmado. O comando vai sem
    /// eles. O `;` do meio de um bloco e o comentário sem `;` antes ficam.
    /// </summary>
    [Trait("SqlText", "Statement")]
    [Theory(DisplayName = "OK o comando vai ao driver sem os ponto e vírgulas soltos da frente e sem o do fim e o que vem depois")]
    [InlineData("UPDATE t SET a = 1", "UPDATE t SET a = 1")]
    [InlineData("UPDATE t SET a = 1;", "UPDATE t SET a = 1")]
    [InlineData("UPDATE t SET a = 1 ; -- fim", "UPDATE t SET a = 1 ")]
    [InlineData("UPDATE t SET a = 1; /* fim */ ;\n", "UPDATE t SET a = 1")]
    [InlineData(";;UPDATE t SET a = 1", "UPDATE t SET a = 1")]
    [InlineData("-- antes\n; UPDATE t SET a = 1;;", " UPDATE t SET a = 1")]
    [InlineData("SELECT a FROM t -- fim", "SELECT a FROM t -- fim")]
    [InlineData("-- cria\nBEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END;", "-- cria\nBEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END")]
    [InlineData("SELECT 'a;' FROM t;", "SELECT 'a;' FROM t")]
    [InlineData("UPDATE t SET a = 1; UPDATE t SET a = 2;", "UPDATE t SET a = 1; UPDATE t SET a = 2")]
    [InlineData("", "")]
    [InlineData(";", ";")]
    [InlineData("-- só um comentário", "-- só um comentário")]
    public void Statement_ShouldDropTheStraySemicolonsAroundTheStatement(string sql, string expected)
    {
        //Act
        var statement = SqlText.Statement(sql, ESqlDialect.Db2);

        //Assert
        Assert.Equal(expected, statement);
    }

    /// <summary>
    /// RN-SQL-013, no Db2: `TABLE (` é como se chama uma função de tabela, e a que foi criada com `MODIFIES SQL DATA` grava de dentro
    /// de um `SELECT` cujo texto não tem palavra de gravação nenhuma. Todo `SELECT` com `TABLE (`, com qualquer espaço ou comentário
    /// entre as duas partes, deixa de ser leitura só e roda até o fim. No Informix a função de tabela não grava (o banco recusa), e a
    /// leitura continua paginada. A palavra num nome, num texto ou num comentário não conta.
    /// </summary>
    [Trait("SqlText", "IsSingleRead")]
    [Fact(DisplayName = "OK no Db2 o SELECT com TABLE ( não é leitura só, e no Informix é")]
    public void IsSingleRead_ShouldRefuseTableFunctions_OnlyInDb2()
    {
        //Arrange
        var withTable = new[]
        {
            "SELECT a FROM TABLE(grava()) AS t",
            "select a from table  (\n  grava()\n) as t",
            "SELECT a FROM TABLE /* a função */ (grava()) AS t",
            "SELECT a FROM TABLE -- a função\n(grava()) AS t",
            "SELECT a FROM t, TABLE (VALUES 1, 2) AS copia (n)",
            "WITH g AS (SELECT a FROM TABLE(grava()) AS t) SELECT a FROM g"
        };
        var withoutTable = new[]
        {
            "SELECT table_id FROM t",
            "SELECT 'table (' FROM t",
            "SELECT a AS \"TABLE (\" FROM t",
            "SELECT a /* table ( */ FROM t -- table (",
            "SELECT a FROM tabela (b)",
            "SELECT a FROM t WHERE table_name IN ('x')",
            "SELECT a FROM (VALUES 1, 2) AS copia (a)"
        };

        //Act
        var tableReadInDb2 = withTable.Where(sql => SqlText.IsSingleRead(sql, ESqlDialect.Db2)).ToArray();
        var tableReadInInformix = withTable.Where(sql => SqlText.IsSingleRead(sql, ESqlDialect.Informix)).ToArray();
        var otherReadInDb2 = withoutTable.Where(sql => SqlText.IsSingleRead(sql, ESqlDialect.Db2)).ToArray();

        //Assert
        Assert.Empty(tableReadInDb2);
        Assert.Equal(withTable, tableReadInInformix);
        Assert.Equal(withoutTable, otherReadInDb2);
    }

    /// <summary>
    /// RN-SQL-001, no Informix: a rotina externa (`EXTERNAL NAME '...'` no cabeçalho, antes do primeiro `;`) não tem corpo nem
    /// `END PROCEDURE`: ela acaba no primeiro `;`, e o que vem depois é outro comando, que o servidor executaria. O `END PROCEDURE`
    /// de outra rotina, mais adiante no mesmo envio, não faz dela um bloco: o envio abaixo passava por um comando só, gravava o
    /// `UPDATE` e criava as duas rotinas. A palavra dentro de texto, de comentário ou de nome entre aspas, e uma coluna chamada
    /// `external`, não fazem de uma rotina com corpo uma rotina externa. O par sozinho também não: `external` e `name` são nomes
    /// comuns, e `SELECT external name FROM t` lê a coluna `external` com o apelido `name`. Só é rotina externa a que tem o texto
    /// entre aspas logo depois do par, a única forma que o banco aceita.
    /// </summary>
    [Trait("SqlText", "HasSeveralStatements")]
    [Fact(DisplayName = "OK no Informix a rotina externa não é bloco, nem com o END PROCEDURE de outra rotina depois")]
    public void HasSeveralStatements_ShouldNotTakeAnInformixExternalRoutineAsABlock()
    {
        //Arrange
        var several = new[]
        {
            "CREATE FUNCTION x (INTEGER) RETURNING INTEGER EXTERNAL NAME '/tmp/x.so(x)' LANGUAGE C; UPDATE t SET a = 1; CREATE PROCEDURE q () UPDATE t SET a = 2; END PROCEDURE",
            "CREATE FUNCTION x (INTEGER) RETURNING INTEGER EXTERNAL NAME '/tmp/x.so(x)' LANGUAGE C; UPDATE t SET a = 1; BEGIN WORK; CREATE PROCEDURE q () UPDATE t SET a = 2; END PROCEDURE",
            "CREATE PROCEDURE x (INTEGER) EXTERNAL NAME '/tmp/x.so(x)' LANGUAGE C; CREATE PROCEDURE q () UPDATE t SET a = 2; END PROCEDURE",
            "CREATE DBA FUNCTION x (INTEGER) RETURNING INTEGER EXTERNAL /* onde */ NAME '/tmp/x.so(x)' LANGUAGE C; UPDATE t SET a = 1; END FUNCTION",
            "create or replace function x (integer) returning integer with (not variant) external\nname '/tmp/x.so(x)' language c; update t set a = 1; end function",
            "CREATE PROCEDURE x (INTEGER) EXTERNAL NAME { onde } '/tmp/x.so(x)' LANGUAGE C; UPDATE t SET a = 1; END PROCEDURE",
            "CREATE PROCEDURE x (INTEGER) EXTERNAL NAME \"/tmp/x.so(x)\" LANGUAGE C; UPDATE t SET a = 1; END PROCEDURE"
        };
        var single = new[]
        {
            "CREATE FUNCTION x (INTEGER) RETURNING INTEGER EXTERNAL NAME '/tmp/x.so(x)' LANGUAGE C",
            "CREATE FUNCTION x (INTEGER) RETURNING INTEGER EXTERNAL NAME '/tmp/x.so(x)' LANGUAGE C; -- fim",
            "CREATE PROCEDURE p () UPDATE t SET a = 'EXTERNAL NAME'; UPDATE t SET a = 2; END PROCEDURE",
            "CREATE PROCEDURE p () UPDATE t SET \"EXTERNAL\" = 1, \"NAME\" = 2; UPDATE t SET a = 2; END PROCEDURE",
            "CREATE PROCEDURE p () { EXTERNAL NAME } UPDATE t SET a = 1; UPDATE t SET a = 2; END PROCEDURE",
            "CREATE PROCEDURE p () UPDATE t SET external = 1; UPDATE t SET name = 2; END PROCEDURE",
            "CREATE FUNCTION f () RETURNING INTEGER; DEFINE external INTEGER; DEFINE name INTEGER; LET external = 1; RETURN external; END FUNCTION",
            "CREATE PROCEDURE p () SELECT external name FROM t INTO TEMP x; UPDATE t SET a = 1; END PROCEDURE",
            "CREATE PROCEDURE p () SELECT external name, 'x' AS outra FROM t INTO TEMP x; UPDATE t SET a = 1; END PROCEDURE",
            "create procedure p () select external /* a coluna */ name from t where a = 'x' into temp x; update t set a = 1; end procedure"
        };

        //Act
        var severalFound = several.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Informix)).ToArray();
        var singleFound = single.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Informix)).ToArray();

        //Assert
        Assert.Equal(several, severalFound);
        Assert.Empty(singleFound);
    }

    /// <summary>
    /// RN-SQL-001, no Db2: a rotina de um módulo também tem `;` no corpo. `ALTER MODULE ... ADD` ou `PUBLISH PROCEDURE` ou
    /// `FUNCTION` é um comando só: o driver manda inteiro o texto que começa por `ALTER MODULE`, e o banco recusa, sem executar
    /// nada, o que vier depois do fim do bloco. As outras formas de `ALTER MODULE` não têm corpo, e nelas o `;` separa. No Informix
    /// não há módulo.
    /// </summary>
    [Trait("SqlText", "HasSeveralStatements")]
    [Fact(DisplayName = "OK no Db2 a rotina acrescentada a um módulo é um comando só")]
    public void HasSeveralStatements_ShouldTakeADb2ModuleRoutineAsOneStatement()
    {
        //Arrange
        var blocks = new[]
        {
            "ALTER MODULE m PUBLISH PROCEDURE p () BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",
            "ALTER MODULE m ADD PROCEDURE p () BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END;",
            "ALTER MODULE m PUBLISH FUNCTION f () RETURNS INTEGER BEGIN DECLARE n INTEGER; SET n = 1; RETURN n; END",
            "alter module loja.m add function f () returns integer begin declare n integer; set n = 1; return n; end",
            "ALTER MODULE \"Meu Módulo\" PUBLISH PROCEDURE p () BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",
            "-- o módulo\nALTER\nMODULE /* qual */ m PUBLISH\tPROCEDURE p () BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END -- fim"
        };
        var several = new[]
        {
            "ALTER MODULE m PUBLISH VARIABLE v INTEGER; UPDATE t SET a = 2",
            "ALTER MODULE m DROP PROCEDURE p; UPDATE t SET a = 2",
            "ALTER MODULE m DROP BODY; ALTER MODULE m PUBLISH PROCEDURE p () BEGIN UPDATE t SET a = 1; END",
            "ALTER TABLE t ADD COLUMN b INTEGER; UPDATE t SET b = 1",
            "UPDATE t SET a = 1; ALTER MODULE m PUBLISH PROCEDURE p () BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END"
        };

        //Act
        var severalBlocks = blocks.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Db2)).ToArray();
        var severalOthers = several.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Db2)).ToArray();
        var blockInInformix = SqlText.HasSeveralStatements(blocks[0], ESqlDialect.Informix);

        //Assert
        Assert.Empty(severalBlocks);
        Assert.Equal(several, severalOthers);
        Assert.True(blockInInformix);
    }

    /// <summary>
    /// RN-SQL-001, no Db2: o banco lê um comentário de bloco dentro de outro, e o driver, que é quem divide o envio, encerra o
    /// comentário no primeiro `*/`. Com um comentário aninhado antes das palavras do bloco (ou entre `CREATE` e `PROCEDURE`), o
    /// banco vê o bloco e o driver não: ele divide no `;`, o primeiro pedaço cria a rotina, e o segundo é executado. O envio só é um
    /// bloco quando as duas leituras começam pelas palavras dele; fora do bloco, o `;` que qualquer uma das duas vê ao lado de um
    /// comando faz do envio mais de um comando. A lista saiu da conferência contra o Db2 de verdade, pelo driver cru.
    /// </summary>
    [Trait("SqlText", "HasSeveralStatements")]
    [Fact(DisplayName = "OK no Db2 o comentário aninhado não esconde do driver o ponto e vírgula nem faz um bloco que ele não vê")]
    public void HasSeveralStatements_ShouldReadNestedCommentsAsTheDriverToo_InDb2()
    {
        //Arrange
        var several = new[]
        {
            "/* a /* b */ c */ ALTER MODULE m PUBLISH PROCEDURE q (); UPDATE t SET a = 1",
            "/* a /* b */ c */ CREATE PROCEDURE p () LANGUAGE SQL UPDATE t SET a = 1; UPDATE t SET a = 2",
            "/* a /* b */ c */ CREATE FUNCTION f () RETURNS INTEGER RETURN 1; UPDATE t SET a = 2",
            "/* a /* b */ c */ CREATE FUNCTION f () RETURNS INTEGER RETURN 1; SELEC 1; UPDATE t SET a = 2",
            "/* a /* b */ c */ CREATE TRIGGER g AFTER INSERT ON t FOR EACH ROW UPDATE t SET a = 1; UPDATE t SET a = 2",
            "CREATE /* a /* b */ c */ PROCEDURE p () LANGUAGE SQL UPDATE t SET a = 1; UPDATE t SET a = 2",
            "CREATE OR /* a /* b */ c */ REPLACE PROCEDURE p () LANGUAGE SQL UPDATE t SET a = 1; UPDATE t SET a = 2",
            "CREATE OR REPLACE /* a /* b */ c */ PROCEDURE p () LANGUAGE SQL UPDATE t SET a = 1; UPDATE t SET a = 2",
            "ALTER /* a /* b */ c */ MODULE m PUBLISH PROCEDURE q (); UPDATE t SET a = 1",
            "/* a /* b */ c */ BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",
            "/* a /* b */ c */ CREATE PROCEDURE p () LANGUAGE SQL BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",

            // O bloco que só uma das duas leituras vê.
            "/* a /* b */ CREATE PROCEDURE */ UPDATE t SET a = 1; UPDATE t SET a = 2",
            "/* a /* b */ BEGIN */ UPDATE t SET a = 1; UPDATE t SET a = 2",
            "ALTER MODULE m /* a /* b */ ' */ PUBLISH PROCEDURE q (); UPDATE t SET a = 1 -- '",

            // O `;` que só o driver vê: para o banco está dentro do comentário.
            "UPDATE t SET a = 1 /* a /* b */ ; c */",
            "UPDATE t SET a = 1 /* a /* b */ ; UPDATE t SET a = 2 ; */",
            "UPDATE t SET a = 1 /* a /* b */ ; -- */",
            "/* a /* b */ ; */ UPDATE t SET a = 1",
            "/* a /* b */ ; UPDATE t SET a = 1 ; */ UPDATE t SET a = 2",
            "/* a /* b */ ; UPDATE t SET a = 1 */",
            "/* a /* b */ ; */",
            "/* a /* b */ ; -- */\nCREATE PROCEDURE p () BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",

            // O `;` que só o banco vê: para o driver está dentro de um texto.
            "/* a /* b */ ' */ UPDATE t SET a = 1 ; UPDATE t SET a = 2 -- '",

            // E o que as duas veem.
            "UPDATE t SET a = 1 /* a /* b */ c */; UPDATE t SET a = 2"
        };
        var single = new[]
        {
            // Depois da palavra `PROCEDURE`, de `ALTER MODULE` e de `BEGIN`, as duas leituras veem o bloco: o driver manda inteiro.
            "CREATE PROCEDURE /* a /* b */ c */ p () LANGUAGE SQL UPDATE t SET a = 1; UPDATE t SET a = 2",
            "ALTER MODULE /* a /* b */ c */ m PUBLISH PROCEDURE q (); UPDATE t SET a = 1",
            "BEGIN /* a /* b */ c */ UPDATE t SET a = 1; END; UPDATE t SET a = 2",
            "/* um */ CREATE /* dois */ PROCEDURE p () BEGIN UPDATE t SET a = 1; UPDATE t SET a = 2; END",

            // Sem `;` ao lado de um comando em nenhuma das duas leituras.
            "/* a /* b */ c */ CREATE PROCEDURE p () LANGUAGE SQL UPDATE t SET a = 1",
            "/* a /* b */ c */ UPDATE t SET a = 1",
            "UPDATE t SET a = 1; /* a /* b */ c */",
            "UPDATE t SET a = 1 /* a /* b */ c */;",
            "UPDATE t SET a = 1 /* a /* b */",
            ";"
        };

        //Act
        var severalFound = several.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Db2)).ToArray();
        var singleFound = single.Where(sql => SqlText.HasSeveralStatements(sql, ESqlDialect.Db2)).ToArray();

        //Assert
        Assert.Equal(several, severalFound);
        Assert.Empty(singleFound);
    }

    /// <summary>
    /// RN-SQL-013, no Db2: com um comentário aninhado, o que o banco executa e o que o driver enxerga podem não ser a mesma coisa.
    /// O comando só é uma leitura só quando as duas leituras dizem isso: a palavra de gravação que só o banco vê (o driver a toma
    /// por texto entre aspas) e a que só o driver vê (para o banco é comentário) tiram a paginação, e a leitura que para o driver
    /// não começa por `SELECT` também (ele a mandaria como comando sem linhas, e o banco a recusa). A leitura com comentário
    /// aninhado que não esconde nada continua paginada.
    /// </summary>
    [Trait("SqlText", "IsSingleRead")]
    [Fact(DisplayName = "OK no Db2 a leitura só é a que o banco e o driver leem como leitura")]
    public void IsSingleRead_ShouldAgreeWithBothReadingsOfANestedComment_InDb2()
    {
        //Arrange
        var notReads = new[]
        {
            "SELECT numero /* a /* b */ ' */ FROM FINAL TABLE (UPDATE t SET a = 1) -- '",
            "SELECT a FROM t /* a /* b */ ' */ , TABLE (grava()) AS g -- '",
            "SELECT 1 /* a /* b */ UPDATE */ FROM t",
            "/* a /* b */ SELECT */ UPDATE t SET a = 1",
            "/* a /* b */ c */ SELECT numero FROM t",
            "SELECT a FROM t /* a /* b */ ; c */"
        };
        var reads = new[]
        {
            "SELECT /* a /* b */ c */ numero FROM t",
            "SELECT /* um /* dentro */ do outro */ COUNT(*) FROM t",
            "SELECT numero FROM t; /* a /* b */ c */",
            "SELECT numero FROM t /* a /* b */ c */;"
        };

        //Act
        var readFound = notReads.Where(sql => SqlText.IsSingleRead(sql, ESqlDialect.Db2)).ToArray();
        var notReadFound = reads.Where(sql => !SqlText.IsSingleRead(sql, ESqlDialect.Db2)).ToArray();

        //Assert
        Assert.Empty(readFound);
        Assert.Empty(notReadFound);
    }

    [Trait("SqlText", "RewriteDoubleQuotedLiterals")]
    [Fact(DisplayName = "OK aspas duplas em posição de parâmetro ou valor viram aspas simples, preservando identificadores qualificados e de cláusula")]
    public void RewriteDoubleQuotedLiterals_ShouldRewriteValueLiteralsAndPreserveIdentifiers()
    {
        //Arrange
        const string query = "select * from items where items.description = \"FRIGIDEIRA ACO INOX 30CM ALCA GRANO\" and items.code IN (\"A\", \"B'C\")";
        const string qualifiedQuery = "select t.\"Col Name\" as \"Meu Alias\", LENGTH(\"texto\") from \"usr_schema\".\"items\" t where t.\"Col Name\" = \"Valor 'X'\"";

        //Act
        var rewritten = SqlText.RewriteDoubleQuotedLiterals(query, ESqlDialect.Informix);
        var rewrittenQualified = SqlText.RewriteDoubleQuotedLiterals(qualifiedQuery, ESqlDialect.PostgreSql);

        //Assert
        Assert.Equal("select * from items where items.description = 'FRIGIDEIRA ACO INOX 30CM ALCA GRANO' and items.code IN ('A', 'B''C')", rewritten);
        Assert.Equal("select t.\"Col Name\" as \"Meu Alias\", LENGTH(\"texto\") from \"usr_schema\".\"items\" t where t.\"Col Name\" = 'Valor ''X'''", rewrittenQualified);
    }

    [Trait("SqlText", "InformixRoutineCall")]
    [Fact(DisplayName = "OK chamada de EXECUTE FUNCTION ou EXECUTE PROCEDURE isolada é extraída sem comentários nem ponto e vírgula final")]
    public void InformixRoutineCall_ShouldExtractRoutineExpressionFromExecuteFunctionOrProcedure()
    {
        //Arrange
        var calls = new[]
        {
            "execute function sysadmin:task ('cdr list replicate', '')",
            "  /* nota */ EXECUTE PROCEDURE loja.minha_rotina(1, 'a;b') ; -- fim\n",
            "{ cabeçalho }\n;; execute function informix.f(); ; { rodapé }"
        };
        var nonCalls = new[]
        {
            "SELECT sysadmin:task('onstat', '-g cfg') FROM TABLE(SET{1})",
            "EXECUTE IMMEDIATE 'SELECT 1'",
            "EXECUTE FUNCTION",
            "EXECUTE PROCEDURE ; -- vazia"
        };

        //Act
        var extracted = calls.Select(SqlText.InformixRoutineCall).ToArray();
        var ignored = nonCalls.Select(SqlText.InformixRoutineCall).Where(call => call is not null).ToArray();

        //Assert
        Assert.Equal(new[] { "sysadmin:task ('cdr list replicate', '')", "loja.minha_rotina(1, 'a;b')", "informix.f()" }, extracted);
        Assert.Empty(ignored);
    }
}
