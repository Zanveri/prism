using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-PROT-005: o que é leitura numa conexão somente leitura, pelo texto, nos três dialetos. A lista é do que passa: começa (depois dos
/// parênteses) por `SELECT`, `WITH` ou `VALUES` (no PostgreSQL também `TABLE`, `SHOW` e `EXPLAIN` sem `ANALYZE`) e não tem palavra de
/// gravação, `INTO`, trava de linha nem próximo valor de sequência; no Db2, nem função de tabela nem `EXPLAIN`. Texto, nomes entre aspas,
/// comentários e o `$marca$` não contam. Na dúvida, não é leitura.
/// </summary>
public sealed class ReadOnlySqlTests
{
    [Trait("ReadOnlySql", "Refusal")]
    [Theory(DisplayName = "OK leituras passam nos três bancos")]
    [InlineData("SELECT * FROM loja.pedido")]
    [InlineData("select numero from loja.pedido where status = 'aberto' order by numero")]
    [InlineData("  \n\t SELECT 1  ")]
    [InlineData("(SELECT 1) UNION (SELECT 2)")]
    [InlineData("((SELECT numero FROM loja.pedido))")]
    [InlineData("WITH abertos AS (SELECT * FROM loja.pedido WHERE status = 'aberto') SELECT COUNT(*) FROM abertos")]
    [InlineData("VALUES (1, 'a'), (2, 'b')")]
    [InlineData("SELECT 1;")]
    [InlineData("SELECT 1; SELECT 2")]
    [InlineData("SELECT * FROM loja.pedido FOR READ ONLY")]
    [InlineData("SELECT updated_at, is_deleted, insert_count FROM loja.pedido")]
    [InlineData("-- só comentário\n/* nada */")]
    [InlineData("")]
    [InlineData(";;")]
    public void Refusal_ShouldBeNull_ForReads(string sql)
    {
        //Act
        var refusals = Enum.GetValues<EDatabaseEngine>().Select(engine => ReadOnlySql.Refusal(sql, engine));

        //Assert
        Assert.All(refusals, Assert.Null);
    }

    /// <summary>O que grava, ou pode gravar, em qualquer um dos três bancos.</summary>
    [Trait("ReadOnlySql", "Refusal")]
    [Theory(DisplayName = "Erro o que não é leitura é recusado nos três bancos")]
    [InlineData("INSERT INTO loja.pedido (numero) VALUES (1)", "um INSERT não é leitura")]
    [InlineData("update loja.pedido set status = 'x'", "um UPDATE não é leitura")]
    [InlineData("DELETE FROM loja.pedido", "um DELETE não é leitura")]
    [InlineData("MERGE INTO loja.pedido USING x ON (1 = 1) WHEN MATCHED THEN DELETE", "um MERGE não é leitura")]
    [InlineData("CREATE TABLE loja.nova (id INTEGER)", "um CREATE não é leitura")]
    [InlineData("ALTER TABLE loja.pedido DROP COLUMN status", "um ALTER não é leitura")]
    [InlineData("DROP TABLE loja.pedido", "um DROP não é leitura")]
    [InlineData("TRUNCATE TABLE loja.pedido", "um TRUNCATE não é leitura")]
    [InlineData("GRANT SELECT ON loja.pedido TO leitor", "um GRANT não é leitura")]
    [InlineData("REVOKE SELECT ON loja.pedido FROM leitor", "um REVOKE não é leitura")]
    [InlineData("COMMENT ON TABLE loja.pedido IS 'x'", "um COMMENT não é leitura")]
    [InlineData("CALL loja.fechar_mes()", "um CALL não é leitura")]
    [InlineData("EXECUTE PROCEDURE fechar_mes()", "um EXECUTE não é leitura")]
    [InlineData("SET search_path TO loja", "um SET não é leitura")]
    [InlineData("RESET ALL", "um RESET não é leitura")]
    [InlineData("LOCK TABLE loja.pedido", "um LOCK não é leitura")]
    [InlineData("BEGIN", "um BEGIN não é leitura")]
    [InlineData("COMMIT", "um COMMIT não é leitura")]
    [InlineData("ROLLBACK", "um ROLLBACK não é leitura")]
    [InlineData("SAVEPOINT a", "um SAVEPOINT não é leitura")]
    [InlineData("DO $$ BEGIN DELETE FROM t; END $$", "um DO não é leitura")]
    [InlineData("\"SELECT\" 1", "o comando não começa por SELECT, WITH ou VALUES")]
    [InlineData("(", "o comando não começa por SELECT, WITH ou VALUES")]
    [InlineData("SELECT 1; DELETE FROM loja.pedido", "um DELETE não é leitura")]
    [InlineData("DELETE FROM loja.pedido; SELECT 1", "um DELETE não é leitura")]
    public void Refusal_ShouldExplain_WhatIsNotARead(string sql, string reason)
    {
        //Act
        var refusals = Enum.GetValues<EDatabaseEngine>().Select(engine => ReadOnlySql.Refusal(sql, engine));

        //Assert
        Assert.All(refusals, refusal => Assert.Equal(reason, refusal));
    }

    /// <summary>A leitura que grava pelo caminho: o `WITH` que grava, o `SELECT ... INTO`, a trava de linha e a sequência.</summary>
    [Trait("ReadOnlySql", "Refusal")]
    [Theory(DisplayName = "Erro a leitura que grava no caminho é recusada nos três bancos")]
    [InlineData("WITH apagados AS (DELETE FROM loja.pedido RETURNING *) SELECT * FROM apagados", "o comando tem um DELETE, que grava")]
    [InlineData("WITH x AS (SELECT 1) INSERT INTO loja.log SELECT * FROM x", "o comando tem um INSERT, que grava")]
    [InlineData("SELECT * INTO loja.copia FROM loja.pedido", "o SELECT ... INTO grava o resultado numa tabela")]
    [InlineData("SELECT * FROM pedido INTO TEMP copia", "o SELECT ... INTO grava o resultado numa tabela")]
    [InlineData("SELECT * FROM loja.pedido FOR UPDATE", "a trava de linha (FOR UPDATE, FOR SHARE) é para alterar as linhas")]
    [InlineData("SELECT * FROM loja.pedido FOR NO KEY UPDATE", "a trava de linha (FOR UPDATE, FOR SHARE) é para alterar as linhas")]
    [InlineData("SELECT * FROM loja.pedido FOR SHARE", "a trava de linha (FOR UPDATE, FOR SHARE) é para alterar as linhas")]
    [InlineData("SELECT * FROM loja.pedido FOR KEY SHARE SKIP LOCKED", "a trava de linha (FOR UPDATE, FOR SHARE) é para alterar as linhas")]
    [InlineData("SELECT * FROM PEDIDO WITH RS USE AND KEEP EXCLUSIVE LOCKS", "a trava de linha (FOR UPDATE, FOR SHARE) é para alterar as linhas")]
    [InlineData("SELECT NEXT VALUE FOR loja.seq FROM SYSIBM.SYSDUMMY1", "avançar uma sequência (NEXT VALUE FOR, NEXTVAL) não volta atrás")]
    [InlineData("SELECT seq.NEXTVAL FROM systables WHERE tabid = 1", "avançar uma sequência (NEXT VALUE FOR, NEXTVAL) não volta atrás")]
    [InlineData("VALUES NEXTVAL FOR loja.seq", "avançar uma sequência (NEXT VALUE FOR, NEXTVAL) não volta atrás")]
    [InlineData("SELECT * FROM FINAL TABLE (UPDATE PEDIDO SET STATUS = 'X')", "o comando tem um UPDATE, que grava")]
    [InlineData("SELECT update FROM loja.pedido", "o comando tem um UPDATE, que grava")]
    public void Refusal_ShouldRefuse_AReadThatWrites(string sql, string reason)
    {
        //Act
        var refusals = Enum.GetValues<EDatabaseEngine>().Select(engine => ReadOnlySql.Refusal(sql, engine));

        //Assert
        Assert.All(refusals, refusal => Assert.Equal(reason, refusal));
    }

    /// <summary>Texto, nome entre aspas e comentário não contam: a palavra de gravação dentro deles não recusa a leitura.</summary>
    [Trait("ReadOnlySql", "Refusal")]
    [Theory(DisplayName = "OK palavra de gravação dentro de texto, nome entre aspas ou comentário não conta")]
    [InlineData("SELECT 'DELETE FROM loja.pedido' AS texto")]
    [InlineData("SELECT \"update\", \"into\" FROM loja.pedido")]
    [InlineData("SELECT 1 -- DELETE FROM loja.pedido")]
    [InlineData("SELECT 1 /* INSERT INTO loja.pedido */")]
    [InlineData("/* DROP TABLE x */ SELECT 1")]
    [InlineData("-- UPDATE x\nSELECT 1")]
    [InlineData("SELECT 'it''s; DELETE' FROM loja.pedido")]
    public void Refusal_ShouldIgnore_TextQuotedNamesAndComments(string sql)
    {
        //Act
        var refusals = Enum.GetValues<EDatabaseEngine>().Select(engine => ReadOnlySql.Refusal(sql, engine));

        //Assert
        Assert.All(refusals, Assert.Null);
    }

    /// <summary>No PostgreSQL: `TABLE`, `SHOW` e `EXPLAIN` sem `ANALYZE` são leitura; o `$marca$`, o `E'...'` e o comentário aninhado são lidos como ele os lê.</summary>
    [Trait("ReadOnlySql", "Refusal")]
    [Theory(DisplayName = "OK no PostgreSQL TABLE, SHOW, EXPLAIN sem ANALYZE e o texto entre $marca$ são leitura")]
    [InlineData("TABLE loja.pedido")]
    [InlineData("SHOW search_path")]
    [InlineData("EXPLAIN SELECT * FROM loja.pedido")]
    [InlineData("EXPLAIN DELETE FROM loja.pedido")]
    [InlineData("EXPLAIN (FORMAT JSON) SELECT 1")]
    [InlineData("SELECT $$DELETE FROM loja.pedido$$")]
    [InlineData("SELECT $marca$ ; DROP TABLE x; $marca$ AS texto")]
    [InlineData("SELECT E'a\\' DELETE ' AS texto")]
    [InlineData("SELECT 1 /* a /* DELETE */ b */")]
    [InlineData("SELECT k$a$b FROM t")]
    [InlineData("SELECT 1 --\rFROM t")]
    public void Refusal_ShouldBeNull_ForPostgreSqlReads(string sql)
        => Assert.Null(ReadOnlySql.Refusal(sql, EDatabaseEngine.PostgreSql));

    [Trait("ReadOnlySql", "Refusal")]
    [Theory(DisplayName = "Erro no PostgreSQL o EXPLAIN ANALYZE executa o comando, e o comentário aninhado não esconde a gravação")]
    [InlineData("EXPLAIN ANALYZE SELECT 1", "o EXPLAIN ANALYZE executa o comando")]
    [InlineData("EXPLAIN (ANALYZE, BUFFERS) SELECT 1", "o EXPLAIN ANALYZE executa o comando")]
    [InlineData("explain analyse delete from loja.pedido", "o EXPLAIN ANALYZE executa o comando")]
    [InlineData("SELECT 1 /* a /* b */ DELETE FROM t */; DELETE FROM t", "um DELETE não é leitura")]
    [InlineData("SELECT 1 --\rDELETE FROM t", "o comando tem um DELETE, que grava")]
    [InlineData("COPY loja.pedido TO STDOUT", "um COPY não é leitura")]
    [InlineData("VACUUM loja.pedido", "um VACUUM não é leitura")]
    [InlineData("LISTEN canal", "um LISTEN não é leitura")]
    public void Refusal_ShouldExplain_PostgreSqlCommands(string sql, string reason)
        => Assert.Equal(reason, ReadOnlySql.Refusal(sql, EDatabaseEngine.PostgreSql));

    /// <summary>No Db2 o `EXPLAIN` grava nas tabelas de explicação e a função de tabela pode gravar sem que o texto mostre; `SHOW` e `TABLE` não são do Db2.</summary>
    [Trait("ReadOnlySql", "Refusal")]
    [Theory(DisplayName = "Erro no Db2 o EXPLAIN, a função de tabela, o TABLE e o SHOW não são leitura")]
    [InlineData("EXPLAIN PLAN FOR SELECT * FROM PEDIDO", "no Db2, o EXPLAIN grava nas tabelas de explicação")]
    [InlineData("SELECT * FROM TABLE(MON_GET_CONNECTION(NULL, -1))", "no Db2, uma função de tabela (TABLE (...)) pode gravar sem que o comando mostre")]
    [InlineData("SELECT * FROM TABLE /* x */ (F())", "no Db2, uma função de tabela (TABLE (...)) pode gravar sem que o comando mostre")]
    [InlineData("TABLE PEDIDO", "um TABLE não é leitura")]
    [InlineData("SHOW X", "um SHOW não é leitura")]
    public void Refusal_ShouldExplain_Db2Commands(string sql, string reason)
        => Assert.Equal(reason, ReadOnlySql.Refusal(sql, EDatabaseEngine.Db2));

    /// <summary>
    /// No Db2 o banco aceita um comentário de bloco dentro de outro, e o driver o encerra no primeiro `*/`: basta uma das duas leituras ver
    /// o que não é leitura. O PostgreSQL também aninha, e lê o mesmo texto como leitura.
    /// </summary>
    [Trait("ReadOnlySql", "Refusal")]
    [Theory(DisplayName = "Erro no Db2 a gravação que só a leitura do driver vê é recusada")]
    [InlineData("SELECT 1 FROM SYSIBM.SYSDUMMY1 /* a /* b */ DELETE FROM PEDIDO */")]
    [InlineData("SELECT 1 FROM SYSIBM.SYSDUMMY1 /* a /* b */ ; UPDATE PEDIDO SET X = 1 */")]
    public void Refusal_ShouldReadTheDb2CommentAsTheDriverToo(string sql)
    {
        //Act
        var db2 = ReadOnlySql.Refusal(sql, EDatabaseEngine.Db2);
        var postgres = ReadOnlySql.Refusal(sql, EDatabaseEngine.PostgreSql);

        //Assert
        Assert.NotNull(db2);
        Assert.Null(postgres);
    }

    /// <summary>No Informix o comentário entre chaves é comentário, e o de bloco acaba no primeiro `*/`, como o banco o lê.</summary>
    [Trait("ReadOnlySql", "Refusal")]
    [Fact(DisplayName = "OK no Informix o comentário entre chaves não conta, e nos outros bancos a chave não é comentário")]
    public void Refusal_ShouldReadTheInformixBraceComment()
    {
        //Arrange
        const string sql = "SELECT 1 FROM systables { DELETE FROM pedido } WHERE tabid = 1";

        //Act
        var informix = ReadOnlySql.Refusal(sql, EDatabaseEngine.Informix);
        var postgres = ReadOnlySql.Refusal(sql, EDatabaseEngine.PostgreSql);

        //Assert
        Assert.Null(informix);
        Assert.Equal("o comando tem um DELETE, que grava", postgres);
    }

    [Trait("ReadOnlySql", "Refusal")]
    [Fact(DisplayName = "Erro no Informix o comentário de bloco acaba no primeiro */, e o que vem depois conta")]
    public void Refusal_ShouldEndTheInformixBlockCommentAtTheFirstClose()
        => Assert.Equal("o comando tem um DELETE, que grava", ReadOnlySql.Refusal("SELECT 1 FROM systables /* a /* b */ DELETE */", EDatabaseEngine.Informix));

    /// <summary>RN-VERIF-001: a consulta de verificação é uma leitura só; o `;` do fim não conta.</summary>
    [Trait("ReadOnlySql", "VerificationRefusal")]
    [Theory(DisplayName = "OK a consulta de verificação é uma leitura só, com ou sem o ; do fim")]
    [InlineData("SELECT 1")]
    [InlineData("SELECT 1;")]
    [InlineData("SELECT COUNT(*) FROM loja.pedido -- conta")]
    public void VerificationRefusal_ShouldBeNull_ForASingleRead(string sql)
        => Assert.Null(ReadOnlySql.VerificationRefusal(sql, EDatabaseEngine.PostgreSql));

    [Trait("ReadOnlySql", "VerificationRefusal")]
    [Theory(DisplayName = "Erro a consulta de verificação com dois comandos ou que não é leitura é recusada")]
    [InlineData("SELECT 1; SELECT 2", "o texto tem mais de um comando")]
    [InlineData("UPDATE loja.pedido SET x = 1", "um UPDATE não é leitura")]
    [InlineData("SELECT nextval('loja.seq')", "avançar uma sequência (NEXT VALUE FOR, NEXTVAL) não volta atrás")]
    public void VerificationRefusal_ShouldRefuse(string sql, string? reason)
        => Assert.Equal(reason, ReadOnlySql.VerificationRefusal(sql, EDatabaseEngine.PostgreSql));

    [Trait("ReadOnlySql", "Message")]
    [Fact(DisplayName = "OK a recusa diz que a conexão é somente leitura, o motivo e que nada foi ao banco")]
    public void Message_ShouldSayWhyAndThatNothingWasSent()
        => Assert.Equal("A conexão é somente leitura, e só leituras são executadas nela: um DELETE não é leitura. Nada foi enviado ao banco.", ReadOnlySql.Message("um DELETE não é leitura"));
}
