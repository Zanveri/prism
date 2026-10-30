using CSharpFunctionalExtensions;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Journal.Clients;

internal sealed class JournalDatabaseClient(IOptions<VaultOptions> options, ILogger logger) : IJournalDatabaseClient
{
    private const int MaxSqlBytes = 256 * 1024;
    private const int MaxErrorBytes = 16 * 1024;
    private const int DefaultRetentionDays = 90;
    private const int SqliteNotADatabaseErrorCode = 26;

    private static readonly CultureInfo PtBr = CultureInfo.GetCultureInfo("pt-BR");

    private readonly ILogger _logger = logger.ForContext<JournalDatabaseClient>();
    private readonly string _directory = Path.Combine(options.Value.DataDirectory, "journal");

    public Result<JournalOpenOutcome, EJournalError> Open(string userName, ReadOnlySpan<byte> key, DateTimeOffset now)
    {
        if (!VaultFileName.IsAllowed(userName))
            return EJournalError.Unavailable;

        var keyCopy = key.ToArray();
        try
        {
            return Send(nameof(Open), () => OpenCore(userName, keyCopy, now));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(keyCopy);
        }
    }

    public UnitResult<EJournalError> WriteBatch(IJournalConnection connection, IReadOnlyList<JournalBatchItem> items)
    {
        if (items.Count == 0)
            return UnitResult.Success<EJournalError>();

        var result = Send(nameof(WriteBatch), () =>
        {
            WriteBatchCore(((SqliteJournalConnection)connection).Connection, items);

            return true;
        });

        return result.IsSuccess ? UnitResult.Success<EJournalError>() : UnitResult.Failure(result.Error);
    }

    public Result<JournalPage, EJournalError> Query(IJournalConnection connection, JournalQuery query)
        => Send(nameof(Query), () => QueryCore(((SqliteJournalConnection)connection).Connection, query));

    public Result<JournalEntry, EJournalError> Get(IJournalConnection connection, long id)
    {
        var found = Send(nameof(Get), () => GetCore(((SqliteJournalConnection)connection).Connection, id));
        if (found.IsFailure)
            return found.Error;

        return found.Value is { } entry ? entry : EJournalError.NotFound;
    }

    public UnitResult<EJournalError> Hide(IJournalConnection connection, long id)
    {
        var changed = Send(nameof(Hide), () => HideCore(((SqliteJournalConnection)connection).Connection, id));
        if (changed.IsFailure)
            return changed.Error;

        return changed.Value > 0 ? UnitResult.Success<EJournalError>() : EJournalError.NotFound;
    }

    public Result<long, EJournalError> HideConnection(IJournalConnection connection, Guid connectionId)
        => Send(nameof(HideConnection), () => HideConnectionCore(((SqliteJournalConnection)connection).Connection, connectionId));

    public Result<JournalFacets, EJournalError> Facets(IJournalConnection connection)
        => Send(nameof(Facets), () => FacetsCore((SqliteJournalConnection)connection));

    public Result<int?, EJournalError> GetRetention(IJournalConnection connection)
        => Send(nameof(GetRetention), () => ReadRetention(((SqliteJournalConnection)connection).Connection));

    public UnitResult<EJournalError> SetRetention(IJournalConnection connection, int? days, DateTimeOffset now)
    {
        var updated = Send(nameof(SetRetention), () =>
        {
            WriteRetention(((SqliteJournalConnection)connection).Connection, days, now);

            return true;
        });

        return updated.IsSuccess ? UnitResult.Success<EJournalError>() : UnitResult.Failure(updated.Error);
    }

    public Result<long, EJournalError> PurgeBefore(IJournalConnection connection, DateTimeOffset before)
        => Send(nameof(PurgeBefore), () => PurgeBeforeCore(((SqliteJournalConnection)connection).Connection, before.UtcTicks));

    public UnitResult<EJournalError> Rekey(IJournalConnection connection, ReadOnlySpan<byte> newKey)
    {
        var keyCopy = newKey.ToArray();
        try
        {
            var rekeyed = Send(nameof(Rekey), () =>
            {
                RekeyCore(((SqliteJournalConnection)connection).Connection, keyCopy);

                return true;
            });

            return rekeyed.IsSuccess ? UnitResult.Success<EJournalError>() : UnitResult.Failure(rekeyed.Error);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(keyCopy);
        }
    }

    public void Close(IJournalConnection connection)
    {
        Send(nameof(Close), () =>
        {
            var sqlite = ((SqliteJournalConnection)connection).Connection;
            ExecuteNonQuery(sqlite, "PRAGMA wal_checkpoint(TRUNCATE);");
            sqlite.Close();
            SqliteConnection.ClearPool(sqlite);
            sqlite.Dispose();

            return true;
        });
    }

    internal static string NormalizeSearchText(params string?[] parts)
    {
        var builder = new StringBuilder();
        foreach (var part in parts)
        {
            if (string.IsNullOrWhiteSpace(part))
                continue;

            if (builder.Length > 0)
                builder.Append(' ');

            var decomposed = part.Normalize(NormalizationForm.FormD);
            foreach (var ch in decomposed)
            {
                if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
                    builder.Append(char.ToLowerInvariant(ch));
            }
        }

        return builder.ToString().Normalize(NormalizationForm.FormC);
    }

    internal static string? TruncateSql(string? sql)
    {
        if (string.IsNullOrEmpty(sql))
            return sql;

        var totalBytes = Encoding.UTF8.GetByteCount(sql);
        if (totalBytes <= MaxSqlBytes)
            return sql;

        var prefix = TruncateUtf8Prefix(sql, MaxSqlBytes);
        var formattedTotal = FormatByteSize(totalBytes);

        return $"{prefix}… (cortado: {formattedTotal} no total)";
    }

    internal static string? TruncateErrorMessage(string? message)
    {
        if (string.IsNullOrEmpty(message))
            return message;

        var totalBytes = Encoding.UTF8.GetByteCount(message);
        if (totalBytes <= MaxErrorBytes)
            return message;

        return $"{TruncateUtf8Prefix(message, MaxErrorBytes)}…";
    }

    private static string TruncateUtf8Prefix(string text, int maxBytes)
    {
        var bytes = 0;
        var index = 0;

        while (index < text.Length)
        {
            var runeLength = char.IsHighSurrogate(text[index]) && index + 1 < text.Length && char.IsLowSurrogate(text[index + 1]) ? 2 : 1;
            var runeBytes = Encoding.UTF8.GetByteCount(text.AsSpan(index, runeLength));
            if (bytes + runeBytes > maxBytes)
                break;

            bytes += runeBytes;
            index += runeLength;
        }

        return text[..index];
    }

    private static string FormatByteSize(int totalBytes)
    {
        if (totalBytes >= 1024 * 1024)
            return $"{(totalBytes / (1024.0 * 1024.0)).ToString("0.0", PtBr)} MB";

        return $"{(totalBytes / 1024.0).ToString("0.#", PtBr)} KB";
    }

    private Result<T, EJournalError> Send<T>(string operation, Func<T> action)
    {
        var stopwatch = Stopwatch.StartNew();
        try
        {
            return action();
        }
        catch (Exception exception)
        {
            _logger.Warning("Operação {Operation} do diário falhou após {ElapsedMs} ms com {ErrorType}.", operation, stopwatch.ElapsedMilliseconds, exception.GetType().Name);

            return EJournalError.Unavailable;
        }
    }

    private JournalOpenOutcome OpenCore(string userName, byte[] key, DateTimeOffset now)
    {
        Directory.CreateDirectory(_directory);
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(_directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);

        var path = Path.Combine(_directory, $"{userName}.journal.db");
        var replacedDamaged = false;
        SqliteConnection? sqlite = null;

        if (File.Exists(path))
        {
            if (TryOpenAndVerify(path, key, out sqlite))
                replacedDamaged = false;
            else
            {
                MoveDamagedFiles(userName, path, now);
                replacedDamaged = true;
            }
        }

        sqlite ??= OpenConnectionWithKey(path, key);
        ConfigureAndMigrate(sqlite);

        var retentionDays = EnsureRetentionSetting(sqlite);
        if (retentionDays.HasValue)
            PurgeBeforeCore(sqlite, now.AddDays(-retentionDays.Value).UtcTicks);

        var maxId = ExecuteScalarLong(sqlite, "SELECT COALESCE(MAX(id), 0) FROM entries;");

        return new JournalOpenOutcome(new SqliteJournalConnection(sqlite, path), maxId, replacedDamaged, retentionDays);
    }

    private static bool TryOpenAndVerify(string path, byte[] key, out SqliteConnection? connection)
    {
        SqliteConnection? candidate = null;
        try
        {
            candidate = OpenConnectionWithKey(path, key);
            ExecuteScalarLong(candidate, "SELECT count(*) FROM sqlite_master;");
            connection = candidate;

            return true;
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == SqliteNotADatabaseErrorCode)
        {
            if (candidate is not null)
            {
                candidate.Close();
                SqliteConnection.ClearPool(candidate);
                candidate.Dispose();
            }

            connection = null;

            return false;
        }
    }

    private void MoveDamagedFiles(string userName, string path, DateTimeOffset now)
    {
        var stamp = now.ToUniversalTime().ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);
        var damagedPath = Path.Combine(_directory, $"{userName}.journal.damaged-{stamp}.db");
        if (File.Exists(damagedPath))
            damagedPath = Path.Combine(_directory, $"{userName}.journal.damaged-{stamp}-{Guid.NewGuid():N}.db");

        File.Move(path, damagedPath);
        DeleteIfExists($"{path}-wal");
        DeleteIfExists($"{path}-shm");
    }

    private static void DeleteIfExists(string path)
    {
        if (File.Exists(path))
            File.Delete(path);
    }

    private static SqliteConnection OpenConnectionWithKey(string path, byte[] key)
    {
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false
        }.ToString();

        var connection = new SqliteConnection(connectionString);
        connection.Open();
        ApplyKeyPragma(connection, "key", key);

        return connection;
    }

    private static void ApplyKeyPragma(SqliteConnection connection, string pragmaName, byte[] key)
    {
        var hex = Convert.ToHexString(key);
        using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA {pragmaName} = \"x'{hex}'\";";
        command.ExecuteNonQuery();
    }

    private static void ConfigureAndMigrate(SqliteConnection connection)
    {
        ExecuteNonQuery(connection, """
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            PRAGMA secure_delete = ON;
            CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL,
                started_at_ticks INTEGER NOT NULL,
                ended_at TEXT NULL,
                duration_ms INTEGER NULL,
                kind INTEGER NOT NULL,
                action TEXT NOT NULL,
                level INTEGER NOT NULL,
                reason TEXT NOT NULL,
                outcome INTEGER NOT NULL,
                origin TEXT NOT NULL,
                connection_id TEXT NULL,
                connection_name TEXT NULL,
                engine TEXT NULL,
                folder_path TEXT NULL,
                environment_name TEXT NULL,
                environment_color TEXT NULL,
                database_name TEXT NULL,
                session_id TEXT NULL,
                script_run_id TEXT NULL,
                sql_text TEXT NULL,
                history_text TEXT NULL,
                row_count INTEGER NULL,
                error_code TEXT NULL,
                error_message TEXT NULL,
                confirmed INTEGER NOT NULL DEFAULT 0,
                protections TEXT NULL,
                hidden_in_history INTEGER NOT NULL DEFAULT 0,
                history_search_text TEXT NOT NULL DEFAULT '',
                search_text TEXT NOT NULL DEFAULT '',
                sql_state TEXT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_entries_started_at ON entries (started_at_ticks DESC, id DESC);
            CREATE INDEX IF NOT EXISTS ix_entries_connection_started_at ON entries (connection_id, started_at_ticks DESC, id DESC);
            CREATE INDEX IF NOT EXISTS ix_entries_connection_id ON entries (connection_id, id DESC);
            CREATE INDEX IF NOT EXISTS ix_entries_environment ON entries (environment_name);
            CREATE INDEX IF NOT EXISTS ix_entries_level ON entries (level);
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            PRAGMA user_version = 1;
            UPDATE entries SET outcome = 5 WHERE outcome = 0;
            """);
    }

    private static int? EnsureRetentionSetting(SqliteConnection connection)
    {
        using var check = connection.CreateCommand();
        check.CommandText = "SELECT value FROM settings WHERE key = 'retention_days';";
        var raw = check.ExecuteScalar() as string;
        if (raw is null)
        {
            using var insert = connection.CreateCommand();
            insert.CommandText = "INSERT INTO settings (key, value) VALUES ('retention_days', @value);";
            insert.Parameters.AddWithValue("@value", DefaultRetentionDays.ToString(CultureInfo.InvariantCulture));
            insert.ExecuteNonQuery();

            return DefaultRetentionDays;
        }

        return ParseRetention(raw);
    }

    private static int? ReadRetention(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM settings WHERE key = 'retention_days';";
        var raw = command.ExecuteScalar() as string;

        return raw is null ? DefaultRetentionDays : ParseRetention(raw);
    }

    private static void WriteRetention(SqliteConnection connection, int? days, DateTimeOffset now)
    {
        var value = days.HasValue ? days.Value.ToString(CultureInfo.InvariantCulture) : "always";
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO settings (key, value) VALUES ('retention_days', @value)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value;
            """;
        command.Parameters.AddWithValue("@value", value);
        command.ExecuteNonQuery();

        if (days.HasValue)
            PurgeBeforeCore(connection, now.AddDays(-days.Value).UtcTicks);
    }

    private static int? ParseRetention(string raw)
        => string.Equals(raw, "always", StringComparison.OrdinalIgnoreCase)
            ? null
            : int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) && parsed > 0
                ? parsed
                : DefaultRetentionDays;

    private static long PurgeBeforeCore(SqliteConnection connection, long cutoffTicks)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM entries WHERE started_at_ticks < @cutoff;";
        command.Parameters.AddWithValue("@cutoff", cutoffTicks);

        return command.ExecuteNonQuery();
    }

    private static void RekeyCore(SqliteConnection connection, byte[] newKey)
    {
        ExecuteNonQuery(connection, "PRAGMA wal_checkpoint(TRUNCATE);");
        ApplyKeyPragma(connection, "rekey", newKey);
        ExecuteNonQuery(connection, "PRAGMA wal_checkpoint(TRUNCATE);");
        ExecuteScalarLong(connection, "SELECT count(*) FROM sqlite_master;");
    }

    private static void WriteBatchCore(SqliteConnection connection, IReadOnlyList<JournalBatchItem> items)
    {
        using var transaction = connection.BeginTransaction();
        foreach (var item in items)
        {
            switch (item)
            {
                case JournalBatchItem.Insert insert:
                    ExecuteInsert(connection, transaction, insert.Id, insert.Start, null);
                    break;
                case JournalBatchItem.InsertCompleted completed:
                    ExecuteInsert(connection, transaction, completed.Id, completed.Start, completed.End);
                    break;
                case JournalBatchItem.Update update:
                    ExecuteUpdate(connection, transaction, update.Id, update.End);
                    break;
            }
        }

        transaction.Commit();
    }

    private static void ExecuteInsert(SqliteConnection connection, SqliteTransaction transaction, long id, JournalEntryStart start, JournalEntryEnd? end)
    {
        var snapshot = start.Connection ?? JournalConnectionSnapshot.None;
        var sqlText = TruncateSql(start.SqlText);
        var historyText = TruncateSql(start.HistoryText);
        var errorMessage = TruncateErrorMessage(end?.ErrorMessage);
        var outcome = end?.Outcome ?? EJournalOutcome.InProgress;
        var historySearch = NormalizeSearchText(historyText ?? sqlText ?? start.Action);
        var distinctHistoryText = string.Equals(sqlText, historyText, StringComparison.Ordinal) ? null : historyText;
        var fullSearch = NormalizeSearchText(start.Action, start.Reason, snapshot.Name, snapshot.Database, sqlText, distinctHistoryText, end?.ErrorCode, end?.SqlState, errorMessage);

        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO entries (
                id, started_at, started_at_ticks, ended_at, duration_ms, kind, action, level, reason, outcome, origin,
                connection_id, connection_name, engine, folder_path, environment_name, environment_color, database_name,
                session_id, script_run_id, sql_text, history_text, row_count, error_code, error_message,
                confirmed, protections, hidden_in_history, history_search_text, search_text, sql_state
            ) VALUES (
                @id, @startedAt, @startedAtTicks, @endedAt, @durationMs, @kind, @action, @level, @reason, @outcome, @origin,
                @connectionId, @connectionName, @engine, @folderPath, @environmentName, @environmentColor, @databaseName,
                @sessionId, @scriptRunId, @sqlText, @historyText, @rowCount, @errorCode, @errorMessage,
                @confirmed, @protections, 0, @historySearch, @search, @sqlState
            );
            """;
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@startedAt", start.StartedAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));
        command.Parameters.AddWithValue("@startedAtTicks", start.StartedAt.UtcTicks);
        command.Parameters.AddWithValue("@endedAt", (object?)end?.EndedAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture) ?? DBNull.Value);
        command.Parameters.AddWithValue("@durationMs", (object?)end?.DurationMs ?? DBNull.Value);
        command.Parameters.AddWithValue("@kind", (int)start.Kind);
        command.Parameters.AddWithValue("@action", start.Action);
        command.Parameters.AddWithValue("@level", (int)start.Level);
        command.Parameters.AddWithValue("@reason", start.Reason);
        command.Parameters.AddWithValue("@outcome", (int)outcome);
        command.Parameters.AddWithValue("@origin", start.Origin);
        command.Parameters.AddWithValue("@connectionId", (object?)snapshot.ConnectionId?.ToString("D") ?? DBNull.Value);
        command.Parameters.AddWithValue("@connectionName", (object?)snapshot.Name ?? DBNull.Value);
        command.Parameters.AddWithValue("@engine", (object?)snapshot.Engine ?? DBNull.Value);
        command.Parameters.AddWithValue("@folderPath", (object?)snapshot.FolderPath ?? DBNull.Value);
        var environmentName = string.IsNullOrWhiteSpace(snapshot.EnvironmentName) ? null : snapshot.EnvironmentName.Trim();
        var environmentColor = environmentName is null || string.IsNullOrWhiteSpace(snapshot.EnvironmentColor) ? null : snapshot.EnvironmentColor.Trim();
        command.Parameters.AddWithValue("@environmentName", (object?)environmentName ?? DBNull.Value);
        command.Parameters.AddWithValue("@environmentColor", (object?)environmentColor ?? DBNull.Value);
        command.Parameters.AddWithValue("@databaseName", (object?)snapshot.Database ?? DBNull.Value);
        command.Parameters.AddWithValue("@sessionId", (object?)start.SessionId?.ToString("D") ?? DBNull.Value);
        command.Parameters.AddWithValue("@scriptRunId", (object?)start.ScriptRunId?.ToString("D") ?? DBNull.Value);
        command.Parameters.AddWithValue("@sqlText", (object?)sqlText ?? DBNull.Value);
        command.Parameters.AddWithValue("@historyText", (object?)historyText ?? DBNull.Value);
        command.Parameters.AddWithValue("@rowCount", (object?)end?.RowCount ?? DBNull.Value);
        command.Parameters.AddWithValue("@errorCode", (object?)end?.ErrorCode ?? DBNull.Value);
        command.Parameters.AddWithValue("@errorMessage", (object?)errorMessage ?? DBNull.Value);
        command.Parameters.AddWithValue("@confirmed", start.Confirmed ? 1 : 0);
        command.Parameters.AddWithValue("@protections", (object?)start.Protections ?? DBNull.Value);
        command.Parameters.AddWithValue("@historySearch", historySearch);
        command.Parameters.AddWithValue("@search", fullSearch);
        command.Parameters.AddWithValue("@sqlState", (object?)end?.SqlState ?? DBNull.Value);
        command.ExecuteNonQuery();
    }

    private static void ExecuteUpdate(SqliteConnection connection, SqliteTransaction transaction, long id, JournalEntryEnd end)
    {
        var errorMessage = TruncateErrorMessage(end.ErrorMessage);
        var extraSearch = NormalizeSearchText(end.ErrorCode, end.SqlState, errorMessage);

        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE entries
            SET ended_at = @endedAt,
                duration_ms = @durationMs,
                outcome = @outcome,
                row_count = @rowCount,
                error_code = @errorCode,
                error_message = @errorMessage,
                sql_state = @sqlState,
                search_text = CASE WHEN @extraSearch = '' THEN search_text ELSE search_text || ' ' || @extraSearch END
            WHERE id = @id;
            """;
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@endedAt", end.EndedAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));
        command.Parameters.AddWithValue("@durationMs", (object?)end.DurationMs ?? DBNull.Value);
        command.Parameters.AddWithValue("@outcome", (int)end.Outcome);
        command.Parameters.AddWithValue("@rowCount", (object?)end.RowCount ?? DBNull.Value);
        command.Parameters.AddWithValue("@errorCode", (object?)end.ErrorCode ?? DBNull.Value);
        command.Parameters.AddWithValue("@errorMessage", (object?)errorMessage ?? DBNull.Value);
        command.Parameters.AddWithValue("@sqlState", (object?)end.SqlState ?? DBNull.Value);
        command.Parameters.AddWithValue("@extraSearch", extraSearch);
        command.ExecuteNonQuery();
    }

    private static JournalPage QueryCore(SqliteConnection connection, JournalQuery query)
    {
        var limit = Math.Clamp(query.Limit, 1, 500);
        var total = 0L;

        if (!query.HistoryOnly)
        {
            using var countCommand = connection.CreateCommand();
            var where = BuildWhereClause(query, countCommand, includeBeforeCursor: false);
            countCommand.CommandText = $"SELECT COUNT(*) FROM entries {where};";
            total = Convert.ToInt64(countCommand.ExecuteScalar(), CultureInfo.InvariantCulture);
        }

        using var pageCommand = connection.CreateCommand();
        var pageWhere = BuildWhereClause(query, pageCommand, includeBeforeCursor: true);
        pageCommand.CommandText = $"""
            SELECT id, started_at, ended_at, duration_ms, kind, action, level, reason, outcome, origin,
                   connection_id, connection_name, engine, folder_path, environment_name, environment_color, database_name,
                   session_id, script_run_id, sql_text, history_text, row_count, error_code, error_message,
                   confirmed, protections, hidden_in_history, sql_state
            FROM entries
            {pageWhere}
            ORDER BY id DESC
            LIMIT @limit;
            """;
        pageCommand.Parameters.AddWithValue("@limit", limit);

        var items = new List<JournalEntry>();
        using var reader = pageCommand.ExecuteReader();
        while (reader.Read())
            items.Add(ReadEntry(reader));

        long? nextBefore = items.Count == limit ? items[^1].Id : null;

        return new JournalPage(items, nextBefore, total);
    }

    private static string BuildWhereClause(JournalQuery query, SqliteCommand command, bool includeBeforeCursor)
    {
        var clauses = new List<string>();

        if (query.HistoryOnly)
        {
            clauses.Add("kind = 0");
            clauses.Add("hidden_in_history = 0");
            clauses.Add("origin IN ('editor', 'script', 'values', 'statement')");
        }

        if (query.From.HasValue)
        {
            clauses.Add("started_at_ticks >= @fromTicks");
            command.Parameters.AddWithValue("@fromTicks", query.From.Value.UtcTicks);
        }

        if (query.To.HasValue)
        {
            clauses.Add("started_at_ticks <= @toTicks");
            command.Parameters.AddWithValue("@toTicks", query.To.Value.UtcTicks);
        }

        if (query.ConnectionIds.Count > 0)
        {
            var names = new List<string>(query.ConnectionIds.Count);
            for (var index = 0; index < query.ConnectionIds.Count; index++)
            {
                var paramName = $"@conn{index}";
                names.Add(paramName);
                command.Parameters.AddWithValue(paramName, query.ConnectionIds[index].ToString("D"));
            }

            clauses.Add($"connection_id IN ({string.Join(", ", names)})");
        }

        if (query.Environments.Count > 0)
        {
            var envParts = new List<string>();
            var hasNull = false;
            var nonNullIndex = 0;

            foreach (var env in query.Environments)
            {
                if (string.IsNullOrEmpty(env))
                    hasNull = true;
                else
                {
                    var paramName = $"@env{nonNullIndex++}";
                    envParts.Add(paramName);
                    command.Parameters.AddWithValue(paramName, env);
                }
            }

            if (hasNull && envParts.Count > 0)
                clauses.Add($"(environment_name IS NULL OR TRIM(environment_name) = '' OR environment_name IN ({string.Join(", ", envParts)}))");
            else if (hasNull)
                clauses.Add("(environment_name IS NULL OR TRIM(environment_name) = '')");
            else if (envParts.Count > 0)
                clauses.Add($"environment_name IN ({string.Join(", ", envParts)})");
        }

        if (query.Levels.Count > 0)
            clauses.Add($"level IN ({string.Join(", ", query.Levels.Select(level => ((int)level).ToString(CultureInfo.InvariantCulture)))})");

        if (query.Kinds.Count > 0)
            clauses.Add($"kind IN ({string.Join(", ", query.Kinds.Select(kind => ((int)kind).ToString(CultureInfo.InvariantCulture)))})");

        if (query.Outcomes.Count > 0)
            clauses.Add($"outcome IN ({string.Join(", ", query.Outcomes.Select(outcome => ((int)outcome).ToString(CultureInfo.InvariantCulture)))})");

        if (query.ScriptRunId.HasValue)
        {
            clauses.Add("script_run_id = @scriptRunId");
            command.Parameters.AddWithValue("@scriptRunId", query.ScriptRunId.Value.ToString("D"));
        }

        if (!string.IsNullOrWhiteSpace(query.Text))
        {
            var normalized = NormalizeSearchText(query.Text);
            if (!string.IsNullOrEmpty(normalized))
            {
                var escaped = EscapeLike(normalized);
                var column = query.HistoryOnly ? "history_search_text" : "search_text";
                clauses.Add($"{column} LIKE @searchPattern ESCAPE '\\'");
                command.Parameters.AddWithValue("@searchPattern", $"%{escaped}%");
            }
        }

        if (includeBeforeCursor && query.Before.HasValue)
        {
            clauses.Add("id < @beforeId");
            command.Parameters.AddWithValue("@beforeId", query.Before.Value);
        }

        return clauses.Count == 0 ? string.Empty : $"WHERE {string.Join(" AND ", clauses)}";
    }

    private static string EscapeLike(string value)
        => value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);

    private static JournalEntry? GetCore(SqliteConnection connection, long id)
    {
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, started_at, ended_at, duration_ms, kind, action, level, reason, outcome, origin,
                   connection_id, connection_name, engine, folder_path, environment_name, environment_color, database_name,
                   session_id, script_run_id, sql_text, history_text, row_count, error_code, error_message,
                   confirmed, protections, hidden_in_history, sql_state
            FROM entries
            WHERE id = @id;
            """;
        command.Parameters.AddWithValue("@id", id);

        using var reader = command.ExecuteReader();

        return reader.Read() ? ReadEntry(reader) : null;
    }

    private static int HideCore(SqliteConnection connection, long id)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE entries SET hidden_in_history = 1 WHERE id = @id;";
        command.Parameters.AddWithValue("@id", id);

        return command.ExecuteNonQuery();
    }

    private static long HideConnectionCore(SqliteConnection connection, Guid connectionId)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE entries SET hidden_in_history = 1 WHERE connection_id = @connectionId AND hidden_in_history = 0;";
        command.Parameters.AddWithValue("@connectionId", connectionId.ToString("D"));

        return command.ExecuteNonQuery();
    }

    private static JournalFacets FacetsCore(SqliteJournalConnection journalConnection)
    {
        var connection = journalConnection.Connection;
        var totalEntries = ExecuteScalarLong(connection, "SELECT COUNT(*) FROM entries;");

        DateTimeOffset? oldestAt = null;
        using (var oldestCmd = connection.CreateCommand())
        {
            oldestCmd.CommandText = "SELECT started_at FROM entries ORDER BY started_at_ticks ASC, id ASC LIMIT 1;";
            if (oldestCmd.ExecuteScalar() is string rawOldest && DateTimeOffset.TryParse(rawOldest, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsedOldest))
                oldestAt = parsedOldest;
        }

        var connections = new List<JournalConnectionFacet>();
        using (var connCmd = connection.CreateCommand())
        {
            connCmd.CommandText = """
                SELECT connection_id, COALESCE(connection_name, ''), engine, environment_name, environment_color
                FROM entries
                WHERE connection_id IS NOT NULL
                GROUP BY connection_id
                HAVING MAX(id)
                ORDER BY connection_name COLLATE NOCASE;
                """;
            using var reader = connCmd.ExecuteReader();
            while (reader.Read())
            {
                if (Guid.TryParse(reader.GetString(0), out var connId))
                    connections.Add(new JournalConnectionFacet(connId, reader.GetString(1), GetNullableString(reader, 2), GetNullableString(reader, 3), GetNullableString(reader, 4)));
            }
        }

        var environments = new List<JournalEnvironmentFacet>();
        using (var envCmd = connection.CreateCommand())
        {
            envCmd.CommandText = """
                SELECT environment_name, environment_color
                FROM entries
                WHERE environment_name IS NOT NULL AND TRIM(environment_name) <> ''
                GROUP BY environment_name
                HAVING MAX(id)
                ORDER BY environment_name COLLATE NOCASE;
                """;
            using var reader = envCmd.ExecuteReader();
            while (reader.Read())
                environments.Add(new JournalEnvironmentFacet(GetNullableString(reader, 0), GetNullableString(reader, 1)));
        }

        var fileSizeBytes = GetJournalFileSize(journalConnection.FilePath);
        var retentionDays = ReadRetention(connection);

        return new JournalFacets(connections, environments, totalEntries, oldestAt, fileSizeBytes, retentionDays);
    }

    private static long GetJournalFileSize(string path)
    {
        var total = 0L;
        if (File.Exists(path))
            total += new FileInfo(path).Length;

        var walPath = $"{path}-wal";
        if (File.Exists(walPath))
            total += new FileInfo(walPath).Length;

        return total;
    }

    private static JournalEntry ReadEntry(SqliteDataReader reader)
    {
        var id = reader.GetInt64(0);
        var startedAt = DateTimeOffset.Parse(reader.GetString(1), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
        var endedAtRaw = GetNullableString(reader, 2);
        DateTimeOffset? endedAt = endedAtRaw is not null ? DateTimeOffset.Parse(endedAtRaw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind) : null;
        var durationMs = reader.IsDBNull(3) ? (long?)null : reader.GetInt64(3);
        var kind = (EJournalKind)reader.GetInt32(4);
        var action = reader.GetString(5);
        var level = (EJournalLevel)reader.GetInt32(6);
        var reason = reader.GetString(7);
        var outcome = (EJournalOutcome)reader.GetInt32(8);
        var origin = reader.GetString(9);

        var connectionIdRaw = GetNullableString(reader, 10);
        Guid? connectionId = connectionIdRaw is not null && Guid.TryParse(connectionIdRaw, out var parsedConnId) ? parsedConnId : null;
        var snapshot = new JournalConnectionSnapshot(connectionId, GetNullableString(reader, 11), GetNullableString(reader, 12), GetNullableString(reader, 13), GetNullableString(reader, 14), GetNullableString(reader, 15), GetNullableString(reader, 16));

        var sessionIdRaw = GetNullableString(reader, 17);
        Guid? sessionId = sessionIdRaw is not null && Guid.TryParse(sessionIdRaw, out var parsedSessionId) ? parsedSessionId : null;

        var scriptRunIdRaw = GetNullableString(reader, 18);
        Guid? scriptRunId = scriptRunIdRaw is not null && Guid.TryParse(scriptRunIdRaw, out var parsedScriptRunId) ? parsedScriptRunId : null;

        var sqlText = GetNullableString(reader, 19);
        var historyText = GetNullableString(reader, 20);
        var rowCount = reader.IsDBNull(21) ? (long?)null : reader.GetInt64(21);
        var errorCode = GetNullableString(reader, 22);
        var errorMessage = GetNullableString(reader, 23);
        var confirmed = reader.GetInt32(24) != 0;
        var protections = GetNullableString(reader, 25);
        var hiddenInHistory = reader.GetInt32(26) != 0;
        var sqlState = GetNullableString(reader, 27);

        return new JournalEntry(id, startedAt, endedAt, durationMs, kind, action, level, reason, outcome, origin, snapshot, sessionId, scriptRunId, sqlText, historyText, rowCount, errorCode, errorMessage, confirmed, protections, hiddenInHistory, sqlState);
    }

    private static string? GetNullableString(SqliteDataReader reader, int ordinal)
        => reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    private static void ExecuteNonQuery(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private static long ExecuteScalarLong(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;

        return Convert.ToInt64(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    private sealed class SqliteJournalConnection(SqliteConnection connection, string filePath) : IJournalConnection
    {
        public SqliteConnection Connection { get; } = connection;

        public string FilePath { get; } = filePath;

        public void Dispose()
            => Connection.Dispose();
    }
}
