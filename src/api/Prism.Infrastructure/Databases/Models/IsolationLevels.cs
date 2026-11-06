using System.Data;

namespace Prism.Infrastructure.Databases.Models;

public static class IsolationLevels
{
    public const string Default = "default";
    public const string ReadCommitted = "readCommitted";
    public const string RepeatableRead = "repeatableRead";
    public const string Serializable = "serializable";
    public const string UncommittedRead = "uncommittedRead";
    public const string CursorStability = "cursorStability";
    public const string ReadStability = "readStability";
    public const string DirtyRead = "dirtyRead";
    public const string CommittedRead = "committedRead";

    public static bool IsKnown(string? level) => level is
        Default or
        ReadCommitted or
        RepeatableRead or
        Serializable or
        UncommittedRead or
        CursorStability or
        ReadStability or
        DirtyRead or
        CommittedRead;

    public static bool IsSupportedBy(EDatabaseEngine engine, string level)
    {
        if (level == Default)
        {
            return true;
        }

        return engine switch
        {
            EDatabaseEngine.PostgreSql => level is ReadCommitted or RepeatableRead or Serializable,
            EDatabaseEngine.Db2 => level is UncommittedRead or CursorStability or ReadStability or RepeatableRead,
            EDatabaseEngine.Informix => level is DirtyRead or CommittedRead or CursorStability or RepeatableRead,
            _ => false,
        };
    }

    public static bool IsSupportedByInformixLogging(string? loggingMode, string level) =>
        loggingMode != "noLogging" || level is Default or DirtyRead;

    public static IsolationLevel? ToAdoIsolationLevel(EDatabaseEngine engine, string level) => (engine, level) switch
    {
        (_, Default) => null,
        (EDatabaseEngine.PostgreSql, ReadCommitted) => IsolationLevel.ReadCommitted,
        (EDatabaseEngine.PostgreSql, RepeatableRead) => IsolationLevel.RepeatableRead,
        (EDatabaseEngine.PostgreSql, Serializable) => IsolationLevel.Serializable,
        (EDatabaseEngine.Db2, UncommittedRead) => IsolationLevel.ReadUncommitted,
        (EDatabaseEngine.Db2, CursorStability) => IsolationLevel.ReadCommitted,
        (EDatabaseEngine.Db2, ReadStability) => IsolationLevel.RepeatableRead,
        (EDatabaseEngine.Db2, RepeatableRead) => IsolationLevel.Serializable,
        (EDatabaseEngine.Informix, DirtyRead) => IsolationLevel.ReadUncommitted,
        (EDatabaseEngine.Informix, CommittedRead) => IsolationLevel.ReadCommitted,
        (EDatabaseEngine.Informix, CursorStability) => IsolationLevel.ReadCommitted,
        (EDatabaseEngine.Informix, RepeatableRead) => IsolationLevel.Serializable,
        _ => null,
    };

    public static string PostgresBeginReadOnlySql(string level) => level switch
    {
        ReadCommitted => "BEGIN TRANSACTION READ ONLY ISOLATION LEVEL READ COMMITTED",
        RepeatableRead => "BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ",
        Serializable => "BEGIN TRANSACTION READ ONLY ISOLATION LEVEL SERIALIZABLE",
        _ => "BEGIN TRANSACTION READ ONLY",
    };

    public static string? PostgresSessionSql(string level) => level switch
    {
        ReadCommitted => "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED",
        RepeatableRead => "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ",
        Serializable => "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL SERIALIZABLE",
        _ => null,
    };

    public static string Db2SessionSql(string level) => level switch
    {
        UncommittedRead => "SET CURRENT ISOLATION UR",
        CursorStability => "SET CURRENT ISOLATION CS",
        ReadStability => "SET CURRENT ISOLATION RS",
        RepeatableRead => "SET CURRENT ISOLATION RR",
        _ => "SET CURRENT ISOLATION RESET",
    };

    public static string InformixSessionSql(string level, string? loggingMode) => level switch
    {
        DirtyRead => "SET ISOLATION TO DIRTY READ",
        CommittedRead => "SET ISOLATION TO COMMITTED READ",
        CursorStability => "SET ISOLATION TO CURSOR STABILITY",
        RepeatableRead => "SET ISOLATION TO REPEATABLE READ",
        _ => loggingMode switch
        {
            "ansi" => "SET ISOLATION TO REPEATABLE READ",
            "bufferedLogging" or "unbufferedLogging" => "SET ISOLATION TO COMMITTED READ",
            _ => "SET ISOLATION TO DIRTY READ",
        },
    };
}
