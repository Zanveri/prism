using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Prism.Infrastructure;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace Prism.IntegrationTesting.Journal;

/// <summary>
/// Sonda da seção 10 da especificação e RN-HIST-008: 200 mil registros no diário cifrado,
/// primeira página do Histórico em até 100 ms, consulta da Auditoria com todos os filtros,
/// tempo de `PRAGMA rekey` e verificação de que nada fica em claro no disco (banco, WAL e temporários).
/// </summary>
[TestFixture]
[Category("Journal")]
[Explicit("Sonda de 200 mil registros (RN-HIST-008 e seção 10 da especificação).")]
public sealed class JournalPerformanceProbe
{
    private const int TotalEntries = 200_000;
    private const string SecretSqlCanary = "SELECT * FROM segredo_unico_sonda_998877 WHERE doc = 'CPF-9988776655'";
    private const string SecretConnectionCanary = "ConexaoSecretaSonda998877";

    [Test]
    public async Task TwoHundredThousandEntries_HistoryUnder100Ms_AuditFilters_Rekey_AndNothingPlaintextOnDisk()
    {
        var dataDirectory = Directory.CreateTempSubdirectory("prism-journal-probe-200k-").FullName;
        try
        {
            var services = new ServiceCollection();
            services.AddInfrastructure(dataDirectory);
            services.Configure<VaultOptions>(vault =>
            {
                vault.MemoryKiB = 8192;
                vault.Iterations = 1;
                vault.Parallelism = 1;
            });

            await using var provider = services.BuildServiceProvider();
            var vault = provider.GetRequiredService<IVaultService>();
            var journal = provider.GetRequiredService<IJournalService>();

            var created = await vault.CreateAsync("marina.costa", "senha-forte-sonda-123", CancellationToken.None);
            Assert.That(created.IsSuccess, Is.True);
            Assert.That(journal.IsAvailable, Is.True);

            var connections = new[]
            {
                new JournalConnectionSnapshot(Guid.NewGuid(), SecretConnectionCanary, "PostgreSQL", "ERP / Financeiro", "Produção", "red", "erp_prod"),
                new JournalConnectionSnapshot(Guid.NewGuid(), "MES Fábrica", "Informix", "Industrial", "Produção", "red", "mes_fabrica"),
                new JournalConnectionSnapshot(Guid.NewGuid(), "WMS Logística", "Db2", "Logística", "Homologação", "amber", "wms_hml"),
                new JournalConnectionSnapshot(Guid.NewGuid(), " Sandbox Local", "PostgreSQL", null, null, null, "sandbox_dev")
            };

            var origins = new[] { "editor", "script", "values", "statement", "filter", "rerun" };
            var levels = new[] { EJournalLevel.Info, EJournalLevel.Warning, EJournalLevel.High, EJournalLevel.Critical };
            var baseTime = new DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero);

            var populateSw = Stopwatch.StartNew();
            for (var i = 0; i < TotalEntries; i++)
            {
                var snap = connections[i & 3];
                var origin = origins[i % origins.Length];
                var level = levels[(i >> 2) & 3];
                var startedAt = baseTime.AddSeconds(i * 5);
                var sql = i == TotalEntries - 1
                    ? SecretSqlCanary
                    : $"SELECT id, codigo, descricao, atualizado_em FROM movimento_estoque WHERE lote = {i} ORDER BY id DESC;";

                var start = new JournalEntryStart(
                    startedAt,
                    EJournalKind.Sql,
                    level == EJournalLevel.Critical ? "DELETE" : "SELECT",
                    level,
                    level == EJournalLevel.Critical ? "DELETE sem WHERE." : "Leitura.",
                    origin,
                    snap,
                    SessionId: Guid.NewGuid(),
                    SqlText: sql,
                    HistoryText: sql,
                    Confirmed: level == EJournalLevel.Critical,
                    Protections: "confirm");

                var end = new JournalEntryEnd(
                    startedAt.AddMilliseconds(12),
                    12,
                    i % 17 == 0 ? EJournalOutcome.Error : EJournalOutcome.Ok,
                    RowCount: (i % 50) + 1,
                    SqlState: i % 17 == 0 ? "42P01" : null,
                    ErrorMessage: i % 17 == 0 ? "ERROR: relation does not exist" : null);

                journal.Record(start, end);
            }

            // Aguarda esvaziar a fila de 200 mil registros.
            var warmup = await journal.FacetsAsync();
            populateSw.Stop();
            Assert.That(warmup.IsSuccess, Is.True);
            Assert.That(warmup.Value.TotalEntries, Is.EqualTo(TotalEntries));
            TestContext.Out.WriteLine($"[Sonda] 200.000 registros gravados em {populateSw.ElapsedMilliseconds} ms (arquivo: {warmup.Value.FileSizeBytes / (1024 * 1024.0):F1} MiB).");

            // 1. RN-HIST-008: primeira página do Histórico (100 itens) por conexão <= 100 ms.
            var targetConn = connections[0].ConnectionId!.Value;
            var historyConnQuery = new JournalQuery(
                From: null,
                To: null,
                ConnectionIds: [targetConn],
                Environments: [],
                Levels: [],
                Kinds: [],
                Outcomes: [],
                Text: null,
                HistoryOnly: true,
                Before: null,
                Limit: 100);

            var histConnSw = Stopwatch.StartNew();
            var histConnResult = await journal.QueryAsync(historyConnQuery);
            histConnSw.Stop();
            Assert.That(histConnResult.IsSuccess, Is.True);
            Assert.That(histConnResult.Value.Items, Has.Count.EqualTo(100));
            TestContext.Out.WriteLine($"[Sonda] Histórico (1ª página, 1 conexão): {histConnSw.Elapsed.TotalMilliseconds:F2} ms.");
            Assert.That(histConnSw.ElapsedMilliseconds, Is.LessThanOrEqualTo(100), "RN-HIST-008: primeira página do Histórico por conexão deve abrir em até 100 ms.");

            // 2. RN-HIST-008: primeira página do Histórico (100 itens) em todas as conexões <= 100 ms.
            var historyAllQuery = historyConnQuery with { ConnectionIds = [] };
            var histAllSw = Stopwatch.StartNew();
            var histAllResult = await journal.QueryAsync(historyAllQuery);
            histAllSw.Stop();
            Assert.That(histAllResult.IsSuccess, Is.True);
            Assert.That(histAllResult.Value.Items, Has.Count.EqualTo(100));
            TestContext.Out.WriteLine($"[Sonda] Histórico (1ª página, todas as conexões): {histAllSw.Elapsed.TotalMilliseconds:F2} ms.");
            Assert.That(histAllSw.ElapsedMilliseconds, Is.LessThanOrEqualTo(100), "RN-HIST-008: primeira página do Histórico (todas as conexões) deve abrir em até 100 ms.");

            // 3. Auditoria com todos os filtros combinados.
            var auditQuery = new JournalQuery(
                From: baseTime.AddDays(1),
                To: baseTime.AddSeconds(TotalEntries * 5),
                ConnectionIds: [targetConn],
                Environments: ["Produção"],
                Levels: [EJournalLevel.High, EJournalLevel.Critical],
                Kinds: [EJournalKind.Sql],
                Outcomes: [EJournalOutcome.Ok],
                Text: "movimento_estoque",
                HistoryOnly: false,
                Before: null,
                Limit: 200);

            var auditSw = Stopwatch.StartNew();
            var auditResult = await journal.QueryAsync(auditQuery);
            auditSw.Stop();
            Assert.That(auditResult.IsSuccess, Is.True);
            Assert.That(auditResult.Value.Items, Is.Not.Empty);
            TestContext.Out.WriteLine($"[Sonda] Auditoria com todos os filtros (total={auditResult.Value.Total}): {auditSw.Elapsed.TotalMilliseconds:F2} ms.");

            // 4. Seção 10 #4: nada em claro no disco (nem com o diário aberto e WAL ativo).
            AssertNothingPlaintextOnDisk(dataDirectory);

            // 5. Seção 10 #2: medir PRAGMA rekey com 200 mil registros.
            var newKey = RandomNumberGenerator.GetBytes(32);
            var rekeySw = Stopwatch.StartNew();
            var rekeyed = await journal.RekeyAsync(newKey);
            rekeySw.Stop();
            Assert.That(rekeyed, Is.True);
            journal.CommitRekey();
            TestContext.Out.WriteLine($"[Sonda] PRAGMA rekey em 200.000 registros: {rekeySw.Elapsed.TotalMilliseconds:F0} ms.");
            Assert.That(rekeySw.Elapsed, Is.LessThan(TimeSpan.FromSeconds(10)), "Rekey em 200 mil registros deve terminar abaixo de 10 s.");

            // Confere leitura após o rekey e verifica o disco novamente depois de fechar o cofre.
            var afterRekey = await journal.QueryAsync(historyAllQuery);
            Assert.That(afterRekey.IsSuccess, Is.True);
            Assert.That(afterRekey.Value.Items[0].SqlText, Is.EqualTo(SecretSqlCanary));

            vault.Lock();
            AssertNothingPlaintextOnDisk(dataDirectory);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            Directory.Delete(dataDirectory, recursive: true);
        }
    }

    private static void AssertNothingPlaintextOnDisk(string rootDirectory)
    {
        var files = Directory.GetFiles(rootDirectory, "*", SearchOption.AllDirectories);
        Assert.That(files, Is.Not.Empty);

        var forbiddenUtf8 = new[]
        {
            Encoding.UTF8.GetBytes("segredo_unico_sonda_998877"),
            Encoding.UTF8.GetBytes("CPF-9988776655"),
            Encoding.UTF8.GetBytes(SecretConnectionCanary),
            Encoding.UTF8.GetBytes("SQLite format 3")
        };

        var forbiddenUtf16 = new[]
        {
            Encoding.Unicode.GetBytes("segredo_unico_sonda_998877"),
            Encoding.Unicode.GetBytes(SecretConnectionCanary)
        };

        foreach (var file in files)
        {
            using var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var bytes = new byte[fs.Length];
            fs.ReadExactly(bytes);
            foreach (var needle in forbiddenUtf8)
                Assert.That( bytes.AsSpan().IndexOf(needle), Is.EqualTo(-1), $"Texto UTF-8 encontrado em claro no arquivo {Path.GetFileName(file)}.");

            foreach (var needle in forbiddenUtf16)
                Assert.That(bytes.AsSpan().IndexOf(needle), Is.EqualTo(-1), $"Texto UTF-16 encontrado em claro no arquivo {Path.GetFileName(file)}.");
        }
    }
}
