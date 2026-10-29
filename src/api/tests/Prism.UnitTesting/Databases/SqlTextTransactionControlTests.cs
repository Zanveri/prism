using Prism.Infrastructure.Databases.Clients;

namespace Prism.UnitTesting.Databases;

/// <summary>RN-TX-004: o que o controle de transação digitado faz no Commit manual, na forma de cada banco, e o que o PostgreSQL só roda fora de transação.</summary>
public sealed class SqlTextTransactionControlTests
{
    [Trait("SqlText", "TransactionControlOf")]
    [Fact(DisplayName = "OK COMMIT e ROLLBACK, com WORK, TRANSACTION e AND NO CHAIN, são os botões")]
    public void TransactionControlOf_ShouldReadCommitAndRollback()
    {
        //Arrange
        var commits = new[] { "COMMIT", "commit work", "COMMIT TRANSACTION;", "END", "COMMIT AND NO CHAIN", "-- confirma\nCOMMIT WORK AND NO CHAIN" };
        var rollbacks = new[] { "ROLLBACK", "rollback work", "ROLLBACK TRANSACTION", "ABORT", ";ROLLBACK;" };

        //Act
        var readCommits = commits.Select(sql => SqlText.TransactionControlOf(sql, ESqlDialect.PostgreSql)).Distinct().ToArray();
        var readRollbacks = rollbacks.Select(sql => SqlText.TransactionControlOf(sql, ESqlDialect.PostgreSql)).Distinct().ToArray();

        //Assert
        Assert.Equal([ETransactionControl.Commit], readCommits);
        Assert.Equal([ETransactionControl.Rollback], readRollbacks);
    }

    [Trait("SqlText", "TransactionControlOf")]
    [Fact(DisplayName = "OK os pontos de salvamento de cada banco vão ao banco, e o BEGIN e as formas que nunca valem não")]
    public void TransactionControlOf_ShouldReadSavepointsBeginAndTheFormsThatNeverGo()
    {
        //Act
        var read = new[]
        {
            SqlText.TransactionControlOf("SAVEPOINT a", ESqlDialect.PostgreSql),
            SqlText.TransactionControlOf("RELEASE SAVEPOINT a", ESqlDialect.Db2),
            SqlText.TransactionControlOf("SAVEPOINT a ON ROLLBACK RETAIN CURSORS", ESqlDialect.Db2),
            SqlText.TransactionControlOf("ROLLBACK TO SAVEPOINT a", ESqlDialect.Db2),
            SqlText.TransactionControlOf("{ volta } ROLLBACK WORK TO SAVEPOINT a", ESqlDialect.Informix),
            SqlText.TransactionControlOf("BEGIN WORK", ESqlDialect.Informix),
            SqlText.TransactionControlOf("START TRANSACTION", ESqlDialect.PostgreSql),
            SqlText.TransactionControlOf("COMMIT AND CHAIN", ESqlDialect.PostgreSql),
            SqlText.TransactionControlOf("COMMIT PREPARED 'lote'", ESqlDialect.PostgreSql),
            SqlText.TransactionControlOf("PREPARE TRANSACTION 'lote'", ESqlDialect.PostgreSql),
            SqlText.TransactionControlOf("BEGIN ATOMIC UPDATE t SET a = 1; END", ESqlDialect.Db2),
            SqlText.TransactionControlOf("SELECT 'COMMIT'", ESqlDialect.PostgreSql)
        };

        //Assert
        Assert.Equal(
        [
            ETransactionControl.Savepoint, ETransactionControl.Savepoint, ETransactionControl.Savepoint, ETransactionControl.RollbackToSavepoint, ETransactionControl.RollbackToSavepoint,
            ETransactionControl.Begin, ETransactionControl.Begin, ETransactionControl.Never, ETransactionControl.Never, ETransactionControl.Never,
            ETransactionControl.None, ETransactionControl.None
        ], read);
    }

    [Trait("SqlText", "RunsOnlyOutsideTransaction")]
    [Fact(DisplayName = "OK os comandos que o PostgreSQL não aceita dentro de transação são reconhecidos, e os parecidos não")]
    public void RunsOnlyOutsideTransaction_ShouldRecognizeTheListOfTheRule()
    {
        //Arrange
        var outside = new[] { "VACUUM", "vacuum analyze loja.pedido", "CREATE DATABASE outro", "DROP DATABASE outro", "CREATE TABLESPACE t LOCATION '/x'", "ALTER SYSTEM SET work_mem = '8MB'", "CREATE INDEX CONCURRENTLY i ON t (a)", "CREATE UNIQUE INDEX CONCURRENTLY i ON t (a)", "DROP INDEX CONCURRENTLY i", "REINDEX TABLE CONCURRENTLY t", "REINDEX DATABASE loja" };
        var inside = new[] { "CREATE INDEX i ON t (a)", "DROP INDEX i", "REINDEX TABLE t", "ALTER TABLE t ADD c INT", "SELECT 'VACUUM'", "CREATE TABLE database (a INT)" };

        //Act
        var recognized = outside.Where(SqlText.RunsOnlyOutsideTransaction).ToArray();
        var wrong = inside.Where(SqlText.RunsOnlyOutsideTransaction).ToArray();

        //Assert
        Assert.Equal(outside, recognized);
        Assert.Empty(wrong);
    }
}
