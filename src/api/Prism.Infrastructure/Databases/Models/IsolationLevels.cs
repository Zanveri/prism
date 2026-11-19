using System.Data;

namespace Prism.Infrastructure.Databases.Models;

public static class IsolationLevels
{
    public const string Default = "default";
    public const string ReadUncommitted = "readUncommitted";
    public const string ReadCommitted = "readCommitted";
    public const string CommittedReadLastCommitted = "committedReadLastCommitted";
    public const string CursorStability = "cursorStability";
    public const string RepeatableRead = "repeatableRead";
    public const string ReadStability = "readStability";
    public const string Serializable = "serializable";

    // Apelidos legados aceitos na entrada e normalizados para o contrato da interface.
    public const string UncommittedRead = "uncommittedRead";
    public const string DirtyRead = "dirtyRead";
    public const string CommittedRead = "committedRead";

    public static bool IsKnown(string? level) => level is
        Default or
        ReadUncommitted or
        ReadCommitted or
        CommittedReadLastCommitted or
        CursorStability or
        RepeatableRead or
        ReadStability or
        Serializable or
        UncommittedRead or
        DirtyRead or
        CommittedRead;

    public static string Normalize(string? level) => level switch
    {
        null or "" => Default,
        UncommittedRead or DirtyRead => ReadUncommitted,
        CommittedRead => ReadCommitted,
        _ => level,
    };

    public static bool IsSupportedBy(EDatabaseEngine engine, string level)
    {
        var normalized = Normalize(level);
        if (normalized == Default)
            return true;

        return engine switch
        {
            EDatabaseEngine.PostgreSql => normalized is ReadUncommitted or ReadCommitted or RepeatableRead or Serializable,
            EDatabaseEngine.Db2 => normalized is ReadUncommitted or CursorStability or ReadStability or RepeatableRead,
            EDatabaseEngine.Informix => normalized is ReadUncommitted or ReadCommitted or CommittedReadLastCommitted or CursorStability or RepeatableRead,
            EDatabaseEngine.Sqlite or EDatabaseEngine.MySql or EDatabaseEngine.MariaDb or EDatabaseEngine.SqlServer or EDatabaseEngine.Oracle or EDatabaseEngine.Firebird or EDatabaseEngine.DuckDb
                => normalized is ReadUncommitted or ReadCommitted or RepeatableRead or Serializable,
            _ => false,
        };
    }

    public static bool IsSupportedByInformixLogging(string? loggingMode, string level) =>
        loggingMode != "noLogging" || Normalize(level) is Default or ReadUncommitted;

    public static IsolationLevel? ToAdoIsolationLevel(EDatabaseEngine engine, string level) => (engine, Normalize(level)) switch
    {
        (_, Default) => null,
        (EDatabaseEngine.PostgreSql, ReadUncommitted) => IsolationLevel.ReadUncommitted,
        (EDatabaseEngine.PostgreSql, ReadCommitted) => IsolationLevel.ReadCommitted,
        (EDatabaseEngine.PostgreSql, RepeatableRead) => IsolationLevel.RepeatableRead,
        (EDatabaseEngine.PostgreSql, Serializable) => IsolationLevel.Serializable,
        (EDatabaseEngine.Db2, ReadUncommitted) => IsolationLevel.ReadUncommitted,
        (EDatabaseEngine.Db2, CursorStability) => IsolationLevel.ReadCommitted,
        (EDatabaseEngine.Db2, ReadStability) => IsolationLevel.RepeatableRead,
        (EDatabaseEngine.Db2, RepeatableRead) => IsolationLevel.Serializable,
        (EDatabaseEngine.Informix, ReadUncommitted) => IsolationLevel.ReadUncommitted,
        (EDatabaseEngine.Informix, ReadCommitted or CommittedReadLastCommitted) => IsolationLevel.ReadCommitted,
        (EDatabaseEngine.Informix, CursorStability) => IsolationLevel.RepeatableRead,
        (EDatabaseEngine.Informix, RepeatableRead) => IsolationLevel.Serializable,
        (EDatabaseEngine.Sqlite or EDatabaseEngine.MySql or EDatabaseEngine.MariaDb or EDatabaseEngine.SqlServer or EDatabaseEngine.Oracle or EDatabaseEngine.Firebird or EDatabaseEngine.DuckDb, ReadUncommitted)
            => IsolationLevel.ReadUncommitted,
        (EDatabaseEngine.Sqlite or EDatabaseEngine.MySql or EDatabaseEngine.MariaDb or EDatabaseEngine.SqlServer or EDatabaseEngine.Oracle or EDatabaseEngine.Firebird or EDatabaseEngine.DuckDb, ReadCommitted)
            => IsolationLevel.ReadCommitted,
        (EDatabaseEngine.Sqlite or EDatabaseEngine.MySql or EDatabaseEngine.MariaDb or EDatabaseEngine.SqlServer or EDatabaseEngine.Oracle or EDatabaseEngine.Firebird or EDatabaseEngine.DuckDb, RepeatableRead)
            => IsolationLevel.RepeatableRead,
        (EDatabaseEngine.Sqlite or EDatabaseEngine.MySql or EDatabaseEngine.MariaDb or EDatabaseEngine.SqlServer or EDatabaseEngine.Oracle or EDatabaseEngine.Firebird or EDatabaseEngine.DuckDb, Serializable)
            => IsolationLevel.Serializable,
        _ => null,
    };

    /// <summary>
    /// RN-ISOL-004: pela porta DRDA (`IBM.Data.Db2`), o `SET ISOLATION` não altera o isolamento dos pacotes seguintes (e falha em banco ANSI).
    /// O nível chega ao servidor pelas propriedades da conexão DRDA na abertura (ou reabertura) da conexão.
    /// </summary>
    public static (string? IsolationLevel, string? ConcurrentAccessResolution) InformixConnectionOptions(string level) => Normalize(level) switch
    {
        ReadUncommitted => ("ReadUncommitted", null),
        ReadCommitted => ("ReadCommitted", null),
        CommittedReadLastCommitted => ("ReadCommitted", "CurrentlyCommitted"),
        CursorStability => ("RepeatableRead", null),
        RepeatableRead => ("Serializable", null),
        _ => (null, null),
    };

    public static string PostgresBeginReadOnlySql(string level) => Normalize(level) switch
    {
        ReadUncommitted => "BEGIN TRANSACTION READ ONLY ISOLATION LEVEL READ UNCOMMITTED",
        ReadCommitted => "BEGIN TRANSACTION READ ONLY ISOLATION LEVEL READ COMMITTED",
        RepeatableRead => "BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ",
        Serializable => "BEGIN TRANSACTION READ ONLY ISOLATION LEVEL SERIALIZABLE",
        _ => "BEGIN TRANSACTION READ ONLY",
    };

    public static string? PostgresSessionSql(string level) => Normalize(level) switch
    {
        ReadUncommitted => "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ UNCOMMITTED",
        ReadCommitted => "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED",
        RepeatableRead => "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ",
        Serializable => "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL SERIALIZABLE",
        Default => "RESET default_transaction_isolation",
        _ => null,
    };

    public static string Db2SessionSql(string level) => Normalize(level) switch
    {
        ReadUncommitted => "SET CURRENT ISOLATION UR",
        CursorStability => "SET CURRENT ISOLATION CS",
        ReadStability => "SET CURRENT ISOLATION RS",
        RepeatableRead => "SET CURRENT ISOLATION RR",
        _ => "SET CURRENT ISOLATION RESET",
    };

    public static string InformixSessionSql(string level, string? loggingMode) => Normalize(level) switch
    {
        ReadUncommitted => "SET ISOLATION TO DIRTY READ",
        ReadCommitted => "SET ISOLATION TO COMMITTED READ",
        CommittedReadLastCommitted => "SET ISOLATION TO COMMITTED READ LAST COMMITTED",
        CursorStability => "SET ISOLATION TO CURSOR STABILITY",
        RepeatableRead => "SET ISOLATION TO REPEATABLE READ",
        _ => loggingMode switch
        {
            "ansi" => "SET ISOLATION TO REPEATABLE READ",
            "bufferedLogging" or "unbufferedLogging" => "SET ISOLATION TO COMMITTED READ",
            _ => "SET ISOLATION TO DIRTY READ",
        },
    };

    public static string? ManagedSessionSql(EDatabaseEngine engine, string level)
    {
        var normalized = Normalize(level);
        return engine switch
        {
            EDatabaseEngine.Sqlite => normalized == ReadUncommitted ? "PRAGMA read_uncommitted = 1" : "PRAGMA read_uncommitted = 0",
            EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => normalized switch
            {
                ReadUncommitted => "SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED",
                ReadCommitted => "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED",
                RepeatableRead => "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ",
                Serializable => "SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE",
                _ => "SET SESSION transaction_isolation = @@GLOBAL.transaction_isolation",
            },
            EDatabaseEngine.SqlServer => normalized switch
            {
                ReadUncommitted => "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED",
                ReadCommitted => "SET TRANSACTION ISOLATION LEVEL READ COMMITTED",
                RepeatableRead => "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
                Serializable => "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
                _ => "SET TRANSACTION ISOLATION LEVEL READ COMMITTED",
            },
            _ => null,
        };
    }
}
