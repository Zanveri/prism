using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Prism.Infrastructure;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Extensions;
using System.Security.Cryptography;
using System.Text;

namespace Prism.IntegrationTesting.Journal;

/// <summary>
/// RN-DIARIO-001 a 009: testes de integração do serviço do diário cifrado com o cofre real no disco.
/// </summary>
[TestFixture]
[Category("Journal")]
public sealed class JournalServiceTests
{
    private sealed class TestContext : IDisposable
    {
        public string DataDirectory { get; }

        public ServiceProvider Provider { get; }

        public IVaultService Vault => Provider.GetRequiredService<IVaultService>();

        public IJournalService Journal => Provider.GetRequiredService<IJournalService>();

        public FakeTimeClock Clock { get; }

        public TestContext(string? dataDirectory = null, FakeTimeClock? clock = null)
        {
            DataDirectory = dataDirectory ?? Directory.CreateTempSubdirectory("prism-journal-tests-").FullName;
            Clock = clock ?? new FakeTimeClock(new DateTimeOffset(2026, 10, 30, 14, 0, 0, TimeSpan.Zero));

            var services = new ServiceCollection();
            services.AddInfrastructure(DataDirectory);
            services.Configure<VaultOptions>(vault =>
            {
                vault.MemoryKiB = 8192;
                vault.Iterations = 1;
                vault.Parallelism = 1;
            });
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);

            Provider = services.BuildServiceProvider();
            _ = Provider.GetRequiredService<IJournalService>();
        }

        public void Dispose()
        {
            Provider.Dispose();
            SqliteConnection.ClearAllPools();
        }
    }

    private sealed class FakeTimeClock(DateTimeOffset initialUtc) : TimeProvider
    {
        private DateTimeOffset _utcNow = initialUtc;

        public override DateTimeOffset GetUtcNow() => _utcNow;

        public void Advance(TimeSpan delta) => _utcNow = _utcNow.Add(delta);
    }

    private static JournalQuery AllEntriesQuery(int limit = 200)
        => new(null, null, [], [], [], [], [], null, false, null, limit);

    [Test]
    public async Task Unlock_OpensJournal_Lock_ClosesAndZeroesKey()
    {
        var dir = Directory.CreateTempSubdirectory("prism-journal-unlock-").FullName;
        try
        {
            using var context = new TestContext(dir);
            var created = await context.Vault.CreateAsync("ana", "senha-forte-123", CancellationToken.None);
            Assert.That(created.IsSuccess, Is.True);
            Assert.That(context.Journal.IsAvailable, Is.True);

            var keyBuffer = context.Journal.LastKeyBufferForTesting();
            Assert.That(keyBuffer, Is.Not.Null);
            Assert.That(keyBuffer!.Any(b => b != 0), Is.True);

            var journalPath = Path.Combine(context.DataDirectory, "journal", "ana.journal.db");
            Assert.That(File.Exists(journalPath), Is.True);

            context.Vault.Lock();

            Assert.That(context.Journal.IsAvailable, Is.False);
            Assert.That(keyBuffer.All(b => b == 0), Is.True);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Test]
    public async Task Lock_FlushesQueuedEntriesBeforeClosing()
    {
        var dir = Directory.CreateTempSubdirectory("prism-journal-flush-").FullName;
        try
        {
            using (var context = new TestContext(dir))
            {
                await context.Vault.CreateAsync("ana", "senha-forte-123", CancellationToken.None);
                var now = context.Clock.GetUtcNow();

                for (var i = 0; i < 50; i++)
                {
                    var start = new JournalEntryStart(now.AddMilliseconds(i), EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", SqlText: $"SELECT {i}");
                    var end = new JournalEntryEnd(now.AddMilliseconds(i + 1), 1, EJournalOutcome.Ok, RowCount: 1);
                    context.Journal.Record(start, end);
                }

                // Fecha imediatamente sem aguardar leitura: o Lock tem de esvaziar a fila antes de fechar o SQLite.
                context.Vault.Lock();
            }

            using (var reopened = new TestContext(dir))
            {
                await reopened.Vault.UnlockAsync("ana", "senha-forte-123", CancellationToken.None);
                var page = await reopened.Journal.QueryAsync(AllEntriesQuery());
                Assert.That(page.IsSuccess, Is.True);
                Assert.That(page.Value.Total, Is.EqualTo(50));
            }
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Test]
    public async Task Complete_AfterGenerationChange_IsDropped()
    {
        var dir = Directory.CreateTempSubdirectory("prism-journal-gen-").FullName;
        try
        {
            using var context = new TestContext(dir);
            await context.Vault.CreateAsync("ana", "senha-ana-123", CancellationToken.None);
            var now = context.Clock.GetUtcNow();

            var entryId = context.Journal.Begin(new JournalEntryStart(now, EJournalKind.Sql, "UPDATE", EJournalLevel.Warning, "Escrita.", "editor", SqlText: "UPDATE t SET a = 1 WHERE id = 1"));
            Assert.That(entryId, Is.GreaterThan(0));

            // Troca para outro usuário antes de o comando terminar.
            await context.Vault.CreateAsync("beto", "senha-beto-123", CancellationToken.None);

            var betoEntryId = context.Journal.Begin(new JournalEntryStart(now.AddSeconds(1), EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", SqlText: "SELECT 1"));
            Assert.That(betoEntryId, Is.Not.EqualTo(entryId));

            // O Complete atrasado de Ana não pode alterar nada no diário de Beto.
            context.Journal.Complete(entryId, new JournalEntryEnd(now.AddSeconds(2), 2000, EJournalOutcome.Ok, RowCount: 99));
            context.Journal.Complete(betoEntryId, new JournalEntryEnd(now.AddSeconds(2), 1000, EJournalOutcome.Ok, RowCount: 1));

            var betoPage = await context.Journal.QueryAsync(AllEntriesQuery());
            Assert.That(betoPage.IsSuccess, Is.True);
            Assert.That(betoPage.Value.Items, Has.Count.EqualTo(1));
            Assert.That(betoPage.Value.Items[0].SqlText, Is.EqualTo("SELECT 1"));
            Assert.That(betoPage.Value.Items[0].RowCount, Is.EqualTo(1));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Test]
    public async Task Reopen_MarksInProgressAsInterrupted()
    {
        var dir = Directory.CreateTempSubdirectory("prism-journal-interrupted-").FullName;
        try
        {
            long id;
            using (var context = new TestContext(dir))
            {
                await context.Vault.CreateAsync("ana", "senha-forte-123", CancellationToken.None);
                var now = context.Clock.GetUtcNow();
                id = context.Journal.Begin(new JournalEntryStart(now, EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", SqlText: "SELECT pg_sleep(60)"));
                var beforeClose = await context.Journal.GetAsync(id);
                Assert.That(beforeClose.IsSuccess, Is.True);
                Assert.That(beforeClose.Value.Outcome, Is.EqualTo(EJournalOutcome.InProgress));
            }

            using (var reopened = new TestContext(dir))
            {
                await reopened.Vault.UnlockAsync("ana", "senha-forte-123", CancellationToken.None);
                var afterReopen = await reopened.Journal.GetAsync(id);
                Assert.That(afterReopen.IsSuccess, Is.True);
                Assert.That(afterReopen.Value.Outcome, Is.EqualTo(EJournalOutcome.Interrupted));
            }
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Test]
    public async Task WrongKey_RenamesDamagedFile_AndRecordsCritical()
    {
        var dir = Directory.CreateTempSubdirectory("prism-journal-damaged-").FullName;
        try
        {
            var journalDir = Path.Combine(dir, "journal");
            Directory.CreateDirectory(journalDir);
            var journalPath = Path.Combine(journalDir, "ana.journal.db");
            await File.WriteAllBytesAsync(journalPath, RandomNumberGenerator.GetBytes(8192));

            using var context = new TestContext(dir);
            await context.Vault.CreateAsync("ana", "senha-forte-123", CancellationToken.None);

            var files = Directory.GetFiles(journalDir, "ana.journal.damaged-*.db");
            Assert.That(files, Has.Length.EqualTo(1));

            var page = await context.Journal.QueryAsync(AllEntriesQuery());
            Assert.That(page.IsSuccess, Is.True);
            Assert.That(page.Value.Items, Has.Count.EqualTo(1));
            Assert.That(page.Value.Items[0].Kind, Is.EqualTo(EJournalKind.Security));
            Assert.That(page.Value.Items[0].Level, Is.EqualTo(EJournalLevel.Critical));
            Assert.That(page.Value.Items[0].Action, Is.EqualTo("Diário ilegível substituído"));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Test]
    public async Task CannotCreate_ServiceUnavailable_VaultStillOpen()
    {
        var dir = Directory.CreateTempSubdirectory("prism-journal-unavailable-").FullName;
        try
        {
            // Cria um arquivo chamado `journal` onde deveria ser a pasta, impedindo `Directory.CreateDirectory`.
            var blockerPath = Path.Combine(dir, "journal");
            await File.WriteAllTextAsync(blockerPath, "bloqueio");

            using var context = new TestContext(dir);
            var created = await context.Vault.CreateAsync("ana", "senha-forte-123", CancellationToken.None);

            Assert.That(created.IsSuccess, Is.True);
            Assert.That(context.Vault.IsUnlocked, Is.True);
            Assert.That(context.Journal.IsAvailable, Is.False);

            var id = context.Journal.Begin(new JournalEntryStart(DateTimeOffset.UtcNow, EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura."));
            Assert.That(id, Is.EqualTo(-1));

            var queryResult = await context.Journal.QueryAsync(AllEntriesQuery());
            Assert.That(queryResult.IsFailure, Is.True);
            Assert.That(queryResult.Error, Is.EqualTo(EJournalError.Unavailable));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Test]
    public async Task LongSql_IsTruncatedAt256KiB_WithMark()
    {
        var dir = Directory.CreateTempSubdirectory("prism-journal-longsql-").FullName;
        try
        {
            using var context = new TestContext(dir);
            await context.Vault.CreateAsync("ana", "senha-forte-123", CancellationToken.None);
            var now = context.Clock.GetUtcNow();

            var longSql = "SELECT '" + new string('a', 300 * 1024) + "'";
            var start = new JournalEntryStart(now, EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", SqlText: longSql, HistoryText: longSql);
            var end = new JournalEntryEnd(now.AddMilliseconds(5), 5, EJournalOutcome.Ok, RowCount: 1);
            context.Journal.Record(start, end);

            var page = await context.Journal.QueryAsync(AllEntriesQuery());
            Assert.That(page.IsSuccess, Is.True);
            var stored = page.Value.Items.Single().SqlText!;

            Assert.That(stored, Does.EndWith("no total)"));
            Assert.That(stored, Does.Contain("… (cortado: "));
            var prefixEnd = stored.IndexOf("… (cortado:", StringComparison.Ordinal);
            Assert.That(Encoding.UTF8.GetByteCount(stored[..prefixEnd]), Is.EqualTo(256 * 1024));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Test]
    public async Task Retention_DeletesOlderEntries_OnOpen()
    {
        var dir = Directory.CreateTempSubdirectory("prism-journal-retention-").FullName;
        var clock = new FakeTimeClock(new DateTimeOffset(2026, 6, 1, 12, 0, 0, TimeSpan.Zero));
        try
        {
            using (var context = new TestContext(dir, clock))
            {
                await context.Vault.CreateAsync("ana", "senha-forte-123", CancellationToken.None);
                var oldTime = clock.GetUtcNow();
                context.Journal.Record(
                    new JournalEntryStart(oldTime, EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", SqlText: "SELECT 'antigo'"),
                    new JournalEntryEnd(oldTime, 1, EJournalOutcome.Ok));

                clock.Advance(TimeSpan.FromDays(100));
                var recentTime = clock.GetUtcNow();
                context.Journal.Record(
                    new JournalEntryStart(recentTime, EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", SqlText: "SELECT 'recente'"),
                    new JournalEntryEnd(recentTime, 1, EJournalOutcome.Ok));
            }

            // Reabre após 100 dias com a guarda padrão de 90 dias: o registro de 100 dias atrás é apagado na abertura.
            using (var reopened = new TestContext(dir, clock))
            {
                await reopened.Vault.UnlockAsync("ana", "senha-forte-123", CancellationToken.None);
                var page = await reopened.Journal.QueryAsync(AllEntriesQuery());
                Assert.That(page.IsSuccess, Is.True);
                Assert.That(page.Value.Items, Has.Count.EqualTo(1));
                Assert.That(page.Value.Items[0].SqlText, Is.EqualTo("SELECT 'recente'"));
            }
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Test]
    public async Task Rekey_NewKeyOpens_OldKeyFails()
    {
        var dir = Directory.CreateTempSubdirectory("prism-journal-rekey-").FullName;
        try
        {
            byte[] oldKey;
            byte[] newKey;

            using (var context = new TestContext(dir))
            {
                await context.Vault.CreateAsync("ana", "senha-antiga-123", CancellationToken.None);
                oldKey = context.Vault.Read().Value.Journal!.Key.ToArray();

                var now = context.Clock.GetUtcNow();
                context.Journal.Record(
                    new JournalEntryStart(now, EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", SqlText: "SELECT 'antes-do-rekey'"),
                    new JournalEntryEnd(now, 1, EJournalOutcome.Ok));

                var changed = await context.Vault.ChangePasswordAsync(
                    "senha-antiga-123",
                    "senha-nova-456",
                    CancellationToken.None,
                    context.Journal.RekeyAsync,
                    context.Journal.RevertRekeyAsync);
                Assert.That(changed.IsSuccess, Is.True);
                context.Journal.CommitRekey();

                newKey = context.Vault.Read().Value.Journal!.Key.ToArray();
                Assert.That(newKey, Is.Not.EqualTo(oldKey));
            }

            var journalPath = Path.Combine(dir, "journal", "ana.journal.db");
            var oldHex = Convert.ToHexString(oldKey);
            await using (var connOld = new SqliteConnection($"Data Source={journalPath};Pooling=False"))
            {
                await connOld.OpenAsync();
                await using (var keyCmd = connOld.CreateCommand())
                {
                    keyCmd.CommandText = $"PRAGMA key = \"x'{oldHex}'\";";
                    await keyCmd.ExecuteNonQueryAsync();
                }

                await using var cmd = connOld.CreateCommand();
                cmd.CommandText = "SELECT count(*) FROM sqlite_master;";
                var ex = Assert.ThrowsAsync<SqliteException>(async () => await cmd.ExecuteScalarAsync());
                Assert.That(ex!.SqliteErrorCode, Is.EqualTo(26));
            }

            using (var reopened = new TestContext(dir))
            {
                await reopened.Vault.UnlockAsync("ana", "senha-nova-456", CancellationToken.None);
                var page = await reopened.Journal.QueryAsync(AllEntriesQuery());
                Assert.That(page.IsSuccess, Is.True);
                Assert.That(page.Value.Items, Has.Count.EqualTo(1));
                Assert.That(page.Value.Items[0].SqlText, Is.EqualTo("SELECT 'antes-do-rekey'"));
            }
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Test]
    public async Task NoPlaintextOnDisk()
    {
        var dir = Directory.CreateTempSubdirectory("prism-journal-ciphertext-").FullName;
        try
        {
            using (var context = new TestContext(dir))
            {
                await context.Vault.CreateAsync("ana", "senha-forte-123", CancellationToken.None);
                var now = context.Clock.GetUtcNow();
                var snapshot = new JournalConnectionSnapshot(Guid.NewGuid(), "ConexaoSecretaProducao99", "postgresql", "Clientes/Financeiro", "Produção", "#dc2626", "db_ultra_secreto");
                context.Journal.Record(
                    new JournalEntryStart(now, EJournalKind.Sql, "SELECT", EJournalLevel.Info, "Leitura.", "editor", snapshot, SqlText: "SELECT cpf_secreto_987654 FROM clientes_vip"),
                    new JournalEntryEnd(now, 2, EJournalOutcome.Ok, RowCount: 1));

                _ = await context.Journal.QueryAsync(AllEntriesQuery());
            }

            var journalDir = Path.Combine(dir, "journal");
            foreach (var file in Directory.GetFiles(journalDir))
            {
                var rawBytes = await File.ReadAllBytesAsync(file);
                var latin1 = Encoding.Latin1.GetString(rawBytes);
                Assert.That(latin1, Does.Not.Contain("cpf_secreto_987654"));
                Assert.That(latin1, Does.Not.Contain("ConexaoSecretaProducao99"));
                Assert.That(latin1, Does.Not.Contain("db_ultra_secreto"));
                Assert.That(latin1, Does.Not.Contain("SQLite format 3"));
            }
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }
}
