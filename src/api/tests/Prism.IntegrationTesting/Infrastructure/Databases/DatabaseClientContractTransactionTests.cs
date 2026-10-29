using Prism.Infrastructure.Databases.Models;
using Prism.TestingCore.Extensions;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// RN-TX-001 a 011 contra o banco de verdade: no Commit manual o primeiro comando abre a transação da conexão, os seguintes rodam nela, e nada
/// fica gravado antes do Commit. O que se confere por outra conexão é lido depois do fim da transação: no Db2 e no Informix a leitura de uma
/// linha travada espera ou é recusada.
/// </summary>
public abstract partial class DatabaseClientContractTests
{
    /// <summary>RN-TX-004: o ponto de salvamento digitado, na forma deste banco (o Db2 pede `ON ROLLBACK RETAIN CURSORS`).</summary>
    protected virtual string TypedSavepoint(string name)
        => $"SAVEPOINT {name}";

    /// <summary>RN-TX-004: o banco cujo driver toma `ROLLBACK WORK TO SAVEPOINT` pelo `ROLLBACK` da transação inteira (o da IBM): a API o recusa sem enviar.</summary>
    protected virtual bool RefusesRollbackWorkToSavepoint => false;

    /// <summary>RN-TX-002: o Rollback desfaz tudo o que a transação fez, e a conexão fica sem transação até o próximo comando.</summary>
    [Test]
    public async Task ManualCommit_Rollback_UndoesWhatTheTransactionWrote()
    {
        var table = await CreateWriteTableAsync();
        try
        {
            await using (var connection = await OpenAsync())
            {
                connection.ManualCommit = true;
                var updated = await connection.ExecuteAsync($"UPDATE {table} SET versao = 1", CancellationToken.None);
                Assert.That(updated.IsSuccess, Is.True, updated.IsFailure ? updated.Error.Message : null);
                Assert.That(connection.Transaction, Is.EqualTo(ETransactionState.Open));

                // A própria transação vê o que gravou.
                var inside = await ExecutePageAsync(connection, $"SELECT COUNT(*) FROM {table} WHERE versao = 1");
                Assert.That(inside.Rows[0][0], Is.EqualTo("1000"));

                var rolledBack = await connection.RollbackAsync(CancellationToken.None);
                Assert.That(rolledBack.IsSuccess, Is.True, rolledBack.IsFailure ? rolledBack.Error.Message : null);
                Assert.That(connection.Transaction, Is.EqualTo(ETransactionState.None));
            }

            Assert.That(await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1"), Is.Zero);
        }
        finally
        {
            await DropAsync(table);
        }
    }

    /// <summary>RN-TX-002 e 004: o Commit confirma, e o `COMMIT` digitado não vai ao banco (é o botão, no registro de sessões): a conexão o recusa.</summary>
    [Test]
    public async Task ManualCommit_Commit_ConfirmsWhatTheTransactionWrote()
    {
        var table = await CreateWriteTableAsync();
        try
        {
            await using (var connection = await OpenAsync())
            {
                connection.ManualCommit = true;
                Assert.That((await connection.ExecuteAsync($"UPDATE {table} SET versao = 1 WHERE numero <= 1100", CancellationToken.None)).IsSuccess, Is.True);
                Assert.That((await connection.ExecuteAsync($"UPDATE {table} SET versao = 2 WHERE numero > 1100", CancellationToken.None)).IsSuccess, Is.True);

                var committed = await connection.CommitAsync(CancellationToken.None);
                Assert.That(committed.IsSuccess, Is.True, committed.IsFailure ? committed.Error.Message : null);
                Assert.That(connection.Transaction, Is.EqualTo(ETransactionState.None));
            }

            Assert.That(await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1"), Is.EqualTo(100));
            Assert.That(await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 2"), Is.EqualTo(900));
        }
        finally
        {
            await DropAsync(table);
        }
    }

    /// <summary>RN-TX-006: a conexão que fecha com a transação aberta a desfaz antes.</summary>
    [Test]
    public async Task ManualCommit_ClosingTheConnection_RollsTheTransactionBack()
    {
        var table = await CreateWriteTableAsync();
        try
        {
            await using (var connection = await OpenAsync())
            {
                connection.ManualCommit = true;
                Assert.That((await connection.ExecuteAsync($"UPDATE {table} SET versao = 1", CancellationToken.None)).IsSuccess, Is.True);
            }

            Assert.That(await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1"), Is.Zero);
        }
        finally
        {
            await DropAsync(table);
        }
    }

    /// <summary>
    /// RN-TX-004: no Commit manual o `BEGIN` digitado é recusado (o Prism já abre a transação) e os pontos de salvamento vão ao banco, na forma
    /// dele: a volta ao ponto desfaz só o que veio depois dele.
    /// </summary>
    [Test]
    public async Task ManualCommit_TypedSavepoints_GoToTheDatabase_AndBeginIsRefused()
    {
        var table = await CreateWriteTableAsync();
        try
        {
            await using (var connection = await OpenAsync())
            {
                connection.ManualCommit = true;
                var begin = await connection.ExecuteAsync(Engine == EDatabaseEngine.Informix ? "BEGIN WORK" : "BEGIN", CancellationToken.None);
                Assert.That(begin.IsFailure && begin.Error.Kind == EDatabaseFailure.TransactionControlNotSupported, Is.True);
                Assert.That(connection.Transaction, Is.EqualTo(ETransactionState.None));

                foreach (var sql in new[] { $"UPDATE {table} SET versao = 1", TypedSavepoint("antes_do_dois"), $"UPDATE {table} SET versao = 2" })
                {
                    var outcome = await connection.ExecuteAsync(sql, CancellationToken.None);
                    Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? $"{sql}: {outcome.Error.Message}" : null);
                }

                var rollbackWork = await connection.ExecuteAsync("ROLLBACK WORK TO SAVEPOINT antes_do_dois", CancellationToken.None);
                Assert.That(rollbackWork.IsFailure && rollbackWork.Error.Kind == EDatabaseFailure.TransactionControlNotSupported, Is.EqualTo(RefusesRollbackWorkToSavepoint));
                if (!RefusesRollbackWorkToSavepoint)
                    Assert.That((await connection.ExecuteAsync($"UPDATE {table} SET versao = 2", CancellationToken.None)).IsSuccess, Is.True);

                var rollbackTo = await connection.ExecuteAsync("ROLLBACK TO SAVEPOINT antes_do_dois", CancellationToken.None);
                Assert.That(rollbackTo.IsSuccess, Is.True, rollbackTo.IsFailure ? rollbackTo.Error.Message : null);

                Assert.That((await connection.CommitAsync(CancellationToken.None)).IsSuccess, Is.True);
            }

            Assert.That(await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1"), Is.EqualTo(1000));
        }
        finally
        {
            await DropAsync(table);
        }
    }

    /// <summary>
    /// RN-TX-011: o cursor que fecha antes do fim, no meio de uma leitura grande que o banco ainda devolve, não encerra nem estraga a transação:
    /// a gravação de antes continua pendente, e o Commit a confirma. No PostgreSQL é o caso do cancelamento, que sem o ponto de salvamento da
    /// leitura deixaria a transação com erro.
    /// </summary>
    [Test]
    public async Task ManualCommit_CursorClosedBeforeTheEnd_KeepsTheTransaction()
    {
        var table = await CreateWriteTableAsync();
        try
        {
            await using (var connection = await OpenAsync())
            {
                connection.ManualCommit = true;
                Assert.That((await connection.ExecuteAsync($"UPDATE {table} SET versao = 1", CancellationToken.None)).IsSuccess, Is.True);

                var page = await ExecutePageAsync(connection, LargeReadQuery);
                Assert.That(page.HasMore, Is.True);

                var count = await ExecutePageAsync(connection, $"SELECT COUNT(*) FROM {table} WHERE versao = 1");
                Assert.That(count.Rows[0][0], Is.EqualTo("1000"));
                Assert.That(connection.Transaction, Is.EqualTo(ETransactionState.Open));
                Assert.That((await connection.CommitAsync(CancellationToken.None)).IsSuccess, Is.True);
            }

            Assert.That(await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1"), Is.EqualTo(1000));
        }
        finally
        {
            await DropAsync(table);
        }
    }

    /// <summary>
    /// RN-TX-009: o comando que falha dentro da transação. No PostgreSQL ela fica com erro, e só o Rollback resta; no Db2 e no Informix o banco
    /// desfaz só o comando, e o que estava pendente continua.
    /// </summary>
    [Test]
    public async Task ManualCommit_FailedCommand_LeavesTheTransactionAsTheDatabaseDoes()
    {
        var table = await CreateWriteTableAsync();
        try
        {
            await using (var connection = await OpenAsync())
            {
                connection.ManualCommit = true;
                Assert.That((await connection.ExecuteAsync($"UPDATE {table} SET versao = 1", CancellationToken.None)).IsSuccess, Is.True);

                var failed = await connection.ExecuteAsync("SELEC 1", CancellationToken.None);
                Assert.That(failed.IsFailure, Is.True);

                var spoiled = Engine == EDatabaseEngine.PostgreSql;
                Assert.That(connection.Transaction, Is.EqualTo(spoiled ? ETransactionState.Failed : ETransactionState.Open));

                var ended = spoiled ? await connection.RollbackAsync(CancellationToken.None) : await connection.CommitAsync(CancellationToken.None);
                Assert.That(ended.IsSuccess, Is.True, ended.IsFailure ? ended.Error.Message : null);
                Assert.That(await ReadFromAnotherConnectionAsync($"SELECT COUNT(*) FROM {table} WHERE versao = 1"), Is.EqualTo(spoiled ? 0 : 1000));
            }
        }
        finally
        {
            await DropAsync(table);
        }
    }
}
