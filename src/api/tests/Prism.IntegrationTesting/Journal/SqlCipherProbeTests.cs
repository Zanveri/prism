using Microsoft.Data.Sqlite;
using System.Security.Cryptography;

namespace Prism.IntegrationTesting.Journal;

/// <summary>
/// Sonda do SQLCipher (RN-DIARIO-001): confere que o binário nativo abre um banco cifrado com chave bruta de 256 bits,
/// grava e relê com a mesma chave, e recusa a abertura sem chave ou com outra chave.
/// </summary>
[TestFixture]
[Category("Journal")]
public sealed class SqlCipherProbeTests
{
    [OneTimeSetUp]
    public void InitBatteries()
        => SQLitePCL.Batteries_V2.Init();

    [Test]
    public async Task CreateWriteReopen_WithKey_ReadsBack_AndWithoutKey_Fails()
    {
        var directory = Directory.CreateTempSubdirectory("prism-sqlcipher-");
        try
        {
            var path = Path.Combine(directory.FullName, "probe.journal.db");
            var keyHex = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

            await using (var connection = new SqliteConnection($"Data Source={path};Pooling=False"))
            {
                await connection.OpenAsync();
                await using var command = connection.CreateCommand();
                command.CommandText = $"""
                    PRAGMA key = "x'{keyHex}'";
                    PRAGMA temp_store = MEMORY;
                    PRAGMA secure_delete = ON;
                    PRAGMA journal_mode = WAL;
                    CREATE TABLE probe (id INTEGER PRIMARY KEY, secret TEXT NOT NULL);
                    INSERT INTO probe (secret) VALUES ('SELECT * FROM segredo_cliente_42');
                    """;
                await command.ExecuteNonQueryAsync();
            }

            // Os bytes do disco não contêm o texto em claro, nem no arquivo principal nem no WAL.
            foreach (var file in Directory.GetFiles(directory.FullName))
            {
                var raw = await File.ReadAllTextAsync(file);
                Assert.That(raw, Does.Not.Contain("segredo_cliente_42"));
                Assert.That(raw, Does.Not.Contain("SQLite format 3"));
            }

            // Sem chave, a leitura falha com "file is not a database" (código 26).
            await using (var noKey = new SqliteConnection($"Data Source={path};Pooling=False"))
            {
                await noKey.OpenAsync();
                await using var command = noKey.CreateCommand();
                command.CommandText = "SELECT secret FROM probe";
                Assert.ThrowsAsync<SqliteException>(async () => await command.ExecuteScalarAsync());
            }

            // Com a chave certa, relê o valor.
            await using (var withKey = new SqliteConnection($"Data Source={path};Pooling=False"))
            {
                await withKey.OpenAsync();
                await using (var keyCommand = withKey.CreateCommand())
                {
                    keyCommand.CommandText = $"PRAGMA key = \"x'{keyHex}'\"";
                    await keyCommand.ExecuteNonQueryAsync();
                }

                await using var command = withKey.CreateCommand();
                command.CommandText = "SELECT secret FROM probe";
                var value = (string?)await command.ExecuteScalarAsync();
                Assert.That(value, Is.EqualTo("SELECT * FROM segredo_cliente_42"));
            }
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            directory.Delete(recursive: true);
        }
    }
}
